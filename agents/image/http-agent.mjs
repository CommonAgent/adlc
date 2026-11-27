#!/usr/bin/env node
// Answer ONE message by handing it to an agent that answers over HTTP, and
// exit. The one-message entrypoint of an outside agent tried on the mesh
// (docs/try-mode-plan.md, "The adapter on it"), copied into the image as
// /opt/agent/entrypoint.mjs by the deployment manager's adapter layer, beside
// answers.json and command.json.
//
// WHAT IT IS FOR. A person tries an outside agent: its own repository, its own
// Dockerfile, its own HTTP server, unchanged. The tenant host holds the key,
// the fleet supervisor runs this file once per message as the work's user,
// and this file is the only part that knows the agent speaks HTTP. It keeps
// one-message.mjs's contract exactly, so the supervisor and the adapter treat
// it as any other package's work:
//
//   in   MESH_JOB_DIR, MESH_MESSAGE_FILE (one inbox entry as JSON: id, text,
//        files[{path, media_type, name}], task_id, ...), MESH_REPLY_FILE
//        (default <MESH_JOB_DIR>/reply.txt), AGENT_DIR (default /opt/agent),
//        AGENT_JOB_SECONDS (the supervisor's cap), AGENT_DIRECTORY_WORK (the
//        agent's state folder, kept as long as the container lives), and the
//        model door: ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, AGENTMESH_MODEL_URL
//   out  the words for the sender in MESH_REPLY_FILE; each file the agent
//        delivered under <job>/out/, listed in <job>/pieces.json; a status
//        line per update in <job>/updates.jsonl, which the adapter streams to
//        the sender while the job runs; <job>/outcome.json, written last
//   exit 0 answered, 2 refused before any work ran, 3 no answer, 4 stopped at
//        the cap. The sender is told in words on 3 and 4.
//
// PER MESSAGE it reads answers.json (the try's `answers` block: how this
// agent is spoken to) and command.json (the folder image's own command, from
// `docker inspect`), makes sure the agent's own server is up, sends the
// message's files and then its words, waits while the agent says it is still
// working, and leaves the reply and the delivered files in the job folder.
//
// THE AGENT'S SERVER is started the first time a message finds it down: the
// image's own command (or answers.start), in the image's own working folder,
// with the image's own environment, the try's settings, and the model door.
// Nothing of this container's own environment is passed on, so the agent's
// PATH and LD_LIBRARY_PATH are its own. It is started DETACHED, with its
// output in a log under the state folder and none of this process's pipes, so
// it outlives this message and the supervisor sees this process end.
//
// THE TOKEN the agent's API asks for is made here, once per container: 32
// random bytes, kept 0600 under the state folder, put in the server's
// environment by the try's template and sent on every call. It is never
// printed, and it is taken out of anything this file writes or logs.
//
//   needs: node >= 22 and nothing else.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync, closeSync, createWriteStream, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/** How often a turn that is still working is asked for its updates. */
export const POLL_MS = 10_000;
/** The longest the agent's own server is given to answer its health check. */
export const START_WAIT_MS = 240_000;
/** Time kept back at the end of the job's cap, to write what came. */
export const MARGIN_MS = 15_000;
export const DEFAULT_JOB_SECONDS = 240;
/** The supervisor sends the last 4000 characters of the reply file. */
export const REPLY_LIMIT = 4000;
const UPDATE_TEXT_MAX = 60_000;
const ATTACH_MAX_BYTES = 100 * 1024 * 1024;
const LOG_TAIL_LINES = 12;
const LOG_TAIL_BYTES = 4096;
/** The model door's variables, passed on to the agent's server as this
 *  process was given them. */
export const MODEL_VARS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "AGENTMESH_MODEL_URL"];
/** Docker's PATH for an image that names none. */
const DOCKER_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
export const REDACTED = "[redacted]";

export class Refusal extends Error {}
/** A job that ends with words for the sender and no answer from the agent. */
export class NoAnswer extends Error {
  constructor(message, status = "no answer") { super(message); this.status = status; }
}
const refuse = (m) => { throw new Refusal(m); };

/** One failure line for the container's log, at ERROR severity, as
 *  one-message.mjs writes them. */
export function errorLine(message, kind = "failed", write = (s) => process.stderr.write(s)) {
  write(`${JSON.stringify({ severity: "ERROR", message: `[http-agent] ${message}`, component: "http-agent", kind })}\n`);
}

// ── secrets out of everything written ─────────────────────────────────────

const SECRET_NAME = /KEY|TOKEN|SECRET|JWT|SEED|PASSWORD|PASSWD|CREDENTIAL|AUTH|PRIVATE|COOKIE|SESSION/i;
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{20,}/g, /AIza[0-9A-Za-z_-]{35}/g, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g,
  /\bS[UAOCN][A-Z2-7]{56}\b/g, /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];

/** Text with the token, every value given under a secret-sounding name, and
 *  the common key shapes taken out. */
export function redact(text, { token = "", env = {} } = {}) {
  let out = String(text ?? "");
  const known = [token, ...Object.entries(env ?? {}).filter(([k, v]) => SECRET_NAME.test(k) && typeof v === "string" && v.trim().length >= 8).map(([, v]) => v.trim())]
    .filter((v) => typeof v === "string" && v.length >= 8).sort((a, b) => b.length - a.length);
  for (const v of known) out = out.split(v).join(REDACTED);
  for (const shape of SECRET_SHAPES) out = out.replace(shape, (m, scheme) => (typeof scheme === "string" && /^(bearer|basic)$/i.test(scheme) ? `${scheme} ${REDACTED}` : REDACTED));
  return out;
}

// ── where everything is ───────────────────────────────────────────────────

/** The paths and limits for this one message, refused plainly when the
 *  environment does not give them: a job folder guessed wrong is a delivery
 *  filed where nobody collects it. */
export function readEnvironment(env) {
  const jobDir = env.MESH_JOB_DIR;
  if (!jobDir) refuse("MESH_JOB_DIR is not set, so there is nowhere to file what this message produces.");
  const messageFile = env.MESH_MESSAGE_FILE;
  if (!messageFile) refuse("MESH_MESSAGE_FILE is not set, so there is no message to answer.");
  if (!existsSync(messageFile)) refuse(`MESH_MESSAGE_FILE names ${messageFile} and there is no file there.`);
  const agentDir = env.AGENT_DIR || "/opt/agent";
  const cap = Number(env.AGENT_JOB_SECONDS);
  return {
    jobDir, jobOut: join(jobDir, "out"), messageFile,
    replyFile: env.MESH_REPLY_FILE || join(jobDir, "reply.txt"),
    agentDir,
    stateDir: join(env.AGENT_DIRECTORY_WORK || "/var/agent-state/work", "http-agent"),
    capSeconds: Number.isFinite(cap) && cap > 0 ? cap : null,
  };
}

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** answers.json, as the deployment manager wrote it after checking it by rule
 *  (service.mjs readAnswers). Read again here only for its shape, so a file
 *  that is not one is refused in words rather than half used. */
export function readAnswers(text) {
  let a;
  try { a = JSON.parse(String(text ?? "")); } catch { refuse("answers.json is not JSON, so there is no way to speak to this agent."); }
  if (!a || typeof a !== "object" || a.over !== "http") refuse("answers.json does not say the agent answers over http.");
  if (!Number.isInteger(a.port) || a.port < 1024 || a.port > 65535) refuse("answers.json names no port for the agent's server.");
  for (const [what, p] of [["health", a.health], ["ask.path", a.ask?.path]]) {
    if (typeof p !== "string" || !p.startsWith("/")) refuse(`answers.json names no ${what}.`);
  }
  if (!FIELD_RE.test(String(a.reply ?? ""))) refuse("answers.json names no field for the reply.");
  return a;
}

/** command.json: the folder image's own entrypoint, command, working folder,
 *  environment and user, as `docker inspect` read them at build. */
export function readCommand(text) {
  let c;
  try { c = JSON.parse(String(text ?? "")); } catch { refuse("command.json is not JSON, so the agent's own command is not known."); }
  const list = (v) => (Array.isArray(v) ? v.map(String) : []);
  return { entrypoint: list(c?.entrypoint), cmd: list(c?.cmd), workdir: typeof c?.workdir === "string" ? c.workdir : "", env: list(c?.env), user: typeof c?.user === "string" ? c.user : "" };
}

/** The one inbox entry, a byte order mark stripped, refused when not JSON. */
export function readMessage(path) {
  try { return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")); } catch (err) {
    refuse(`the message file at ${path} is not JSON this can read (${err.message}).`);
  }
  return null;
}

// ── the agent's own server ────────────────────────────────────────────────

/** The argv that starts the agent's server: answers.start when the try names
 *  one, the image's own entrypoint and command otherwise, as Docker would run
 *  them. */
export function commandArgv(answers, command) {
  const argv = Array.isArray(answers?.start) && answers.start.length ? answers.start.map(String) : [...(command.entrypoint ?? []), ...(command.cmd ?? [])];
  if (!argv.length || !argv[0]) {
    throw new NoAnswer("the agent's image names no command to start its server with, and the try names none (start), so there was nothing to run");
  }
  return argv;
}

/** A template's placeholders filled: `{token}`, `{text}`, `{thread}`,
 *  `{name}`, `{after}`. One that has no value here is left as written. */
export function fill(s, values) {
  return String(s).replace(/\{(token|text|thread|name|after)\}/g, (m, k) => (values[k] === undefined ? m : String(values[k])));
}

/** A path with its placeholders filled and each value escaped for a URL. */
export function fillPath(path, values) {
  const esc = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) esc[k] = encodeURIComponent(String(v));
  return fill(path, esc);
}

/** A JSON body with `{text}` filled in each string, at any depth. */
export function fillBody(body, values) {
  if (typeof body === "string") return fill(body, { text: values.text });
  if (Array.isArray(body)) return body.map((b) => fillBody(b, values));
  if (body && typeof body === "object") return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, fillBody(v, values)]));
  return body;
}

/** The thread an agent keeps for this job: the job's own id (the task the
 *  message belongs to, or the message), in letters, digits, dot, dash and
 *  underscore. */
export function threadOf(entry) {
  const raw = String(entry?.task_id || entry?.id || "job");
  return raw.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128) || "job";
}

/** A user's home folder from /etc/passwd, as Docker gives HOME to an image
 *  that sets none. */
export function homeOf(uid, passwd) {
  for (const line of String(passwd ?? "").split("\n")) {
    const f = line.split(":");
    if (f.length >= 7 && Number(f[2]) === uid && f[5]) return f[5];
  }
  return null;
}

/** The environment the agent's server is started with: the image's own, the
 *  try's settings with the token filled in, the token's own variable, and the
 *  model door. Nothing else from this process. */
export function serverEnv({ command, answers, token, model = {}, home = null }) {
  const env = {};
  for (const kv of command.env ?? []) {
    const i = kv.indexOf("=");
    if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
  }
  if (!env.PATH) env.PATH = DOCKER_PATH;
  if (!env.HOME) env.HOME = home || "/";
  for (const [k, v] of Object.entries(answers.env ?? {})) env[k] = fill(v, { token });
  if (answers.token?.env) env[answers.token.env] = fill(answers.token.value ?? "{token}", { token });
  for (const k of MODEL_VARS) if (typeof model[k] === "string" && model[k]) env[k] = model[k];
  return env;
}

/** The token for this container, made once: 32 random bytes, hex, 0600. */
export function ensureToken(stateDir) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = join(stateDir, "token");
  const read = () => {
    const t = readFileSync(file, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(t)) throw new NoAnswer("the agent's token file under its state folder is not one this file made");
    return t;
  };
  if (existsSync(file)) return read();
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
  }
  return read();
}

/** One call to the agent's server on loopback. Node's own fetch stops waiting
 *  for an answer's headers after five minutes, and an agent's turn can take
 *  longer, so this uses node:http, whose only limit is the one given. The
 *  answer's body is kept, or written to `toFile`. */
export function call({ port, method = "GET", path, headers = {}, body = null, timeoutMs, toFile = null }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: { ...headers, ...(body !== null ? { "content-length": Buffer.byteLength(body) } : {}) } }, (res) => {
      if (toFile && res.statusCode >= 200 && res.statusCode < 300) {
        const out = createWriteStream(toFile, { mode: 0o644 });
        res.pipe(out);
        out.on("finish", () => { clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) }); });
        out.on("error", (e) => { clearTimeout(timer); reject(e); });
        res.on("error", (e) => { clearTimeout(timer); reject(e); });
        return;
      }
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }); });
      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    const timer = setTimeout(() => { const e = new Error("timed out"); e.code = "TIMEOUT"; req.destroy(e); }, Math.max(1, timeoutMs ?? 30_000));
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    if (body !== null) req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (r) => r.status >= 200 && r.status < 300;
const jsonOf = (buf) => { try { return JSON.parse(buf.toString("utf8")); } catch { return null; } };

/** Whether the agent's server answers its health check. */
export async function healthy({ port, health, headers = {} }) {
  try { return ok(await call({ port, path: health, headers, timeoutMs: 3000 })); } catch { return false; }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; }
}

/** The lock that lets only one message at a time start the server. True when
 *  taken; false when another living process holds it. */
function takeLock(file) {
  for (let i = 0; i < 2; i++) {
    try { writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 }); return true; } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      let holder = 0;
      try { holder = Number(readFileSync(file, "utf8").trim()); } catch { /* gone already */ }
      if (alive(holder)) return false;
      try { unlinkSync(file); } catch { /* someone else cleared it */ }
    }
  }
  return false;
}

/** The last lines of a log, with no secret in them. */
export function logTail(file, secrets) {
  let text = "";
  try {
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(size, LOG_TAIL_BYTES);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      text = buf.toString("utf8");
    } finally { closeSync(fd); }
  } catch { return "it wrote nothing"; }
  const lines = text.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-LOG_TAIL_LINES);
  return lines.length ? redact(lines.join("\n"), secrets) : "it wrote nothing";
}

/**
 * The agent's server, up: answering its health check already, or started now
 * and waited for. Started detached, its output appended to server.log in the
 * state folder, so it outlives this message and holds none of this process's
 * pipes (the supervisor waits for this process's stderr to close). A server
 * that stops, or does not answer in START_WAIT_MS, ends the job with the tail
 * of its log in words.
 */
export async function ensureServer({ answers, command, token, stateDir, model, home, deadline, note = () => {}, spawnImpl = spawn, startWaitMs = START_WAIT_MS }) {
  const headers = authHeaders(answers, token);
  const probe = { port: answers.port, health: answers.health, headers };
  if (await healthy(probe)) return { started: false };
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lockFile = join(stateDir, "server.lock");
  const logFile = join(stateDir, "server.log");
  const env = serverEnv({ command, answers, token, model, home });
  const secrets = { token, env };
  const began = Date.now();
  const until = Math.min(deadline, began + startWaitMs);
  if (!takeLock(lockFile)) {
    // Another message is starting it: wait for it with that message.
    while (Date.now() < until) {
      if (await healthy(probe)) return { started: false };
      await sleep(1000);
    }
    throw new NoAnswer(`the agent's own server did not answer ${answers.health} on port ${answers.port} within ${Math.round(startWaitMs / 1000)} seconds while another message was starting it. The last lines it wrote:\n${logTail(logFile, secrets)}`);
  }
  try {
    const argv = commandArgv(answers, command);
    note("Starting the agent's own server; the first message after it wakes takes longer.");
    const fd = openSync(logFile, "a", 0o600);
    let child;
    let stopped = null;
    try {
      child = spawnImpl(argv[0], argv.slice(1), { cwd: command.workdir || "/", env, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
    } catch (err) {
      throw new NoAnswer(`the agent's own server could not be started (${argv[0]}): ${err?.message ?? err}`);
    } finally {
      closeSync(fd);
    }
    child.on("error", (e) => { stopped = `it could not be started: ${e?.message ?? e}`; });
    child.on("exit", (code, signal) => { stopped = signal ? `it was stopped by ${signal}` : `it exited with code ${code}`; });
    child.unref();
    try { writeFileSync(join(stateDir, "server.pid"), String(child.pid ?? ""), { mode: 0o600 }); } catch { /* only for whoever looks */ }
    while (Date.now() < until) {
      if (stopped) break;
      if (await healthy(probe)) return { started: true, pid: child.pid };
      await sleep(1000);
    }
    const why = stopped
      ? `the agent's own server stopped before it answered ${answers.health} on port ${answers.port} (${stopped})`
      : `the agent's own server did not answer ${answers.health} on port ${answers.port} within ${Math.round((until - began) / 1000)} seconds`;
    throw new NoAnswer(`${why}. The last lines it wrote:\n${logTail(logFile, secrets)}`);
  } finally {
    try { unlinkSync(lockFile); } catch { /* gone already */ }
  }
}

function authHeaders(answers, token) {
  const t = answers.token;
  return t && typeof t.header === "string" && t.header ? { [t.header.toLowerCase()]: `${t.prefix ?? ""}${token}` } : {};
}

// ── what goes in and what comes out ───────────────────────────────────────

const safeName = (s) => String(s ?? "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 100) || "file";

/** The files the message carries that are on this machine, and the ones that
 *  are not, by name. */
export function messageFiles(entry) {
  const got = [];
  const missing = [];
  for (const f of Array.isArray(entry?.files) ? entry.files : []) {
    const name = typeof f?.name === "string" && f.name ? f.name : basename(String(f?.path ?? "attachment")).replace(/^\d+-/, "");
    if (f?.path && !f.error && existsSync(f.path)) got.push({ path: f.path, name, media_type: typeof f.media_type === "string" && f.media_type ? f.media_type : "application/octet-stream" });
    else missing.push({ name, why: f?.error || "it was not on this machine" });
  }
  const seen = new Set();
  for (const f of got) {
    let n = safeName(f.name);
    for (let i = 2; seen.has(n); i++) n = `${i}-${safeName(f.name)}`;
    seen.add(n);
    f.upload = n;
  }
  return { got, missing };
}

/** One multipart body: each file under the named field. */
export function multipartBody(field, files, boundary = `agentmesh-${randomBytes(12).toString("hex")}`) {
  const parts = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${f.upload}"\r\nContent-Type: ${String(f.media_type).replace(/[\r\n"]/g, "")}\r\n\r\n`));
    parts.push(readFileSync(f.path), Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

const MEDIA = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
  html: "text/html", htm: "text/html", md: "text/markdown", txt: "text/plain", json: "application/json", csv: "text/csv", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", zip: "application/zip", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };

/** A delivered file's media type: what the server said, else its extension's. */
export function mediaTypeOf(name, header) {
  const said = String(header ?? "").split(";")[0].trim().toLowerCase();
  if (/^[a-z]+\/[a-z0-9.+-]+$/.test(said) && said !== "application/octet-stream") return said;
  return MEDIA[String(name).split(".").pop()?.toLowerCase()] ?? (said || "application/octet-stream");
}

/** Words an update carries: a string as it is, an object's text. */
export function updateText(item) {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    for (const k of ["text", "message", "content"]) if (typeof item[k] === "string" && item[k].trim()) return item[k].trim();
    try { return JSON.stringify(item); } catch { return ""; }
  }
  return item === null || item === undefined ? "" : String(item);
}

/** A status line the adapter streams to the sender (its updates file). */
function progress(jobDir, words, secrets) {
  const text = redact(String(words ?? ""), secrets).slice(0, UPDATE_TEXT_MAX).trim();
  if (!text) return;
  try { appendFileSync(join(jobDir, "updates.jsonl"), `${JSON.stringify({ progress: text })}\n`); } catch (err) {
    errorLine(`a status line could not be written: ${err?.message ?? err}`);
  }
}

// ── one message ───────────────────────────────────────────────────────────

/**
 * One message in, one reply out. Returns what one-message.mjs's runOne
 * returns: the outcome, with the reply. Refuses (Refusal) only before any
 * work ran; every later failure is words for the sender.
 */
export async function answerOne(env = process.env, { pollMs = POLL_MS, startWaitMs = START_WAIT_MS, now = Date.now, passwd = null, spawnImpl = spawn } = {}) {
  const where = readEnvironment(env);
  const answersFile = join(where.agentDir, "answers.json");
  const commandFile = join(where.agentDir, "command.json");
  if (!existsSync(answersFile)) refuse(`there is no answers.json in ${where.agentDir}, so there is no way to speak to this agent.`);
  if (!existsSync(commandFile)) refuse(`there is no command.json in ${where.agentDir}, so the agent's own command is not known.`);
  const answers = readAnswers(readFileSync(answersFile, "utf8"));
  const command = readCommand(readFileSync(commandFile, "utf8"));
  const entry = readMessage(where.messageFile);
  mkdirSync(where.jobOut, { recursive: true });

  const t0 = now();
  const jobSeconds = Math.min(Number.isInteger(answers.job_seconds) ? answers.job_seconds : DEFAULT_JOB_SECONDS, where.capSeconds ?? Infinity);
  const deadline = t0 + Math.max(10_000, jobSeconds * 1000 - MARGIN_MS);
  const thread = threadOf(entry);
  let token = "";
  let secrets = { token: "", env: {} };
  const pieces = [];
  let status = "answered";
  let reply = "";
  let httpStatus = 0;
  let answerFrom = null;
  const notes = [];
  try {
    token = ensureToken(where.stateDir);
    secrets = { token, env: { ...env, ...(answers.env ?? {}) } };
    const note = (w) => progress(where.jobDir, w, secrets);
    const model = Object.fromEntries(MODEL_VARS.map((k) => [k, env[k]]));
    let home = null;
    try { home = homeOf(process.getuid?.() ?? -1, passwd ?? readFileSync("/etc/passwd", "utf8")); } catch { /* no passwd: Docker's HOME is / */ }
    const auth = authHeaders(answers, token);

    // The words, and the files the message carries.
    let text = String(entry?.text ?? "").trim();
    const { got, missing } = messageFiles(entry);
    if (got.length && !answers.attach) {
      throw new NoAnswer(`This agent takes no files, so nothing was sent to it: ${got.map((f) => f.name).join(", ")} ${got.length === 1 ? "was" : "were"} attached. Send the request again without ${got.length === 1 ? "it" : "them"}, or say in words what ${got.length === 1 ? "it holds" : "they hold"}.`);
    }
    if (!text && !got.length) throw new NoAnswer("The message has no words and no files, so there was nothing to ask the agent.");

    await ensureServer({ answers, command, token, stateDir: where.stateDir, model, home, deadline, note, spawnImpl, startWaitMs });

    if (got.length) {
      const size = got.reduce((n, f) => n + statSync(f.path).size, 0);
      if (size > ATTACH_MAX_BYTES) throw new NoAnswer(`The files come to ${size} bytes, more than the ${ATTACH_MAX_BYTES} one message may hand this agent; nothing was sent.`);
      const mp = multipartBody(answers.attach.field, got);
      let r;
      try {
        r = await call({ port: answers.port, method: "POST", path: fillPath(answers.attach.path, { thread }), headers: { ...auth, "content-type": mp.type, accept: "application/json" }, body: mp.body, timeoutMs: Math.max(1000, deadline - now()) });
      } catch (err) {
        throw new NoAnswer(`The files could not be handed to the agent: ${err?.code === "TIMEOUT" ? "it did not answer in time" : err?.message ?? err}.`, err?.code === "TIMEOUT" ? "stopped" : "no answer");
      }
      if (!ok(r)) throw new NoAnswer(`The agent refused the files (HTTP ${r.status}): ${redact(r.body.toString("utf8"), secrets).slice(0, 300)}`);
      // Named in the words as the agent placed them, when it said; by name otherwise.
      const placed = Object.values(jsonOf(r.body) ?? {}).find((v) => Array.isArray(v) && v.length === got.length && v.every((x) => typeof x === "string"));
      const names = placed ?? got.map((f) => f.upload);
      text = `${text}${text ? "\n\n" : ""}${names.length === 1 ? "Attached file" : "Attached files"}: ${names.join(", ")}`;
    }
    if (missing.length) notes.push(`These files did not reach the agent: ${missing.map((m) => `${m.name} (${m.why})`).join("; ")}.`);

    // The ask, waiting as long as the job may.
    let r;
    try {
      r = await call({
        port: answers.port, method: String(answers.ask.method || "POST").toUpperCase(), path: fillPath(answers.ask.path, { thread }),
        headers: { ...auth, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(fillBody(answers.ask.body ?? { text: "{text}" }, { text })), timeoutMs: Math.max(1000, deadline - now()),
      });
    } catch (err) {
      if (err?.code === "TIMEOUT") {
        throw new NoAnswer(`I could not finish this job. The agent was still working on it when the ${jobSeconds} second limit for one job here was reached, and nothing was delivered. You can ask again, or ask for a smaller job.`, "stopped");
      }
      throw new NoAnswer(`The agent's own server could not be reached: ${err?.message ?? err}.`);
    }
    httpStatus = r.status;
    if (!ok(r)) throw new NoAnswer(`The agent's own server refused the request (HTTP ${r.status}): ${redact(r.body.toString("utf8"), secrets).slice(0, 300)}`);
    const first = jsonOf(r.body);
    if (!first || typeof first !== "object") throw new NoAnswer("The agent's own server answered with something that is not JSON, so there is no reply to read.");
    reply = typeof first[answers.reply] === "string" ? first[answers.reply].trim() : "";
    let listed = answers.files && Array.isArray(first[answers.files.list]) ? first[answers.files.list] : [];

    // While it says it is still working, its updates, every POLL_MS. The flag
    // is read from every answer that carries it. A poll whose answer carries
    // none cannot say whether the work goes on, so the updates it brings are
    // taken as the work reporting back, and the waiting ends with them.
    const w = answers.working;
    let working = !!w && first[w.field] === true;
    let after = w && first[w.next] !== undefined ? first[w.next] : 0;
    const said = [];
    let cut = false;
    let failures = 0;
    while (working) {
      if (now() + pollMs > deadline) { cut = true; break; }
      await sleep(pollMs);
      let p;
      try {
        const got2 = await call({ port: answers.port, path: fillPath(w.poll, { thread, after }), headers: { ...auth, accept: "application/json" }, timeoutMs: Math.max(1000, Math.min(60_000, deadline - now())) });
        p = ok(got2) ? jsonOf(got2.body) : null;
        if (!p) throw new Error(`HTTP ${got2.status}`);
        failures = 0;
      } catch (err) {
        if (++failures >= 3) { notes.push(`Its updates could not be read three times running (${err?.message ?? err}), so the waiting stopped there.`); break; }
        continue;
      }
      const items = Array.isArray(p[w.items]) ? p[w.items] : [];
      for (const item of items) {
        const words = updateText(item);
        if (!words) continue;
        said.push(words);
        note(words);
      }
      if (p[w.next] !== undefined) after = p[w.next];
      if (answers.files && Array.isArray(p[answers.files.list])) listed = p[answers.files.list];
      if (typeof p[w.field] === "boolean") working = p[w.field];
      else if (items.length) working = false;
    }

    // The files it delivered, into the job's out/, listed as pieces.
    const failed = [];
    const used = new Set();
    for (const name of listed.filter((n) => typeof n === "string" && n).slice(0, 64)) {
      let file = safeName(name);
      for (let i = 2; used.has(file); i++) file = `${i}-${safeName(name)}`;
      used.add(file);
      const to = join(where.jobOut, file);
      try {
        const d = await call({ port: answers.port, path: fillPath(answers.files.get, { thread, name }), headers: auth, timeoutMs: Math.max(1000, Math.min(300_000, deadline + MARGIN_MS / 2 - now())), toFile: to });
        if (!ok(d)) throw new Error(`HTTP ${d.status}`);
        pieces.push({ name: file, step: "answer", path: `out/${file}`, media_type: mediaTypeOf(name, d.headers["content-type"]), about: `${name}, a file the agent delivered.` });
      } catch (err) {
        try { unlinkSync(to); } catch { /* never written */ }
        failed.push(`${name} (${err?.message ?? err})`);
      }
    }
    if (failed.length) notes.push(`These files it delivered could not be fetched: ${failed.join("; ")}.`);

    const body = [reply, ...said].filter(Boolean).join("\n\n");
    if (!body && !pieces.length) throw new NoAnswer(cut
      ? `I could not finish this job. The agent was still working on it when the ${jobSeconds} second limit for one job here was reached, and it had said nothing. You can ask again, or ask for a smaller job.`
      : "The agent answered with no words and no files, so there is nothing to hand over. You can ask again.", cut ? "stopped" : "no answer");
    reply = body || `The agent delivered ${pieces.length === 1 ? "a file" : `${pieces.length} files`}: ${pieces.map((p) => p.name).join(", ")}.`;
    answerFrom = "the agent's reply";
    if (cut) notes.push(`It was still working when the time for one job here (${jobSeconds} seconds) ran out; anything it says after this is not part of this answer.`);
  } catch (err) {
    if (err instanceof Refusal) throw err;
    status = err instanceof NoAnswer ? err.status : "no answer";
    reply = err instanceof NoAnswer ? err.message : `I could not finish this job: ${String(err?.message ?? err).slice(0, 300)}`;
    errorLine(redact(reply, secrets), status === "stopped" ? "stopped" : "failed");
  }

  // The words, whole in a piece when they are longer than a reply carries.
  let words = redact([reply, ...notes].filter(Boolean).join("\n\n"), secrets);
  if (status === "answered" && words.length > REPLY_LIMIT) {
    writeFileSync(join(where.jobOut, "reply.md"), `${words}\n`);
    pieces.unshift({ name: "reply.md", step: "answer", path: "out/reply.md", media_type: "text/markdown", about: "The agent's whole reply." });
    words = `${words.slice(0, REPLY_LIMIT - 120).trimEnd()}\n\n(The reply goes on; the whole of it is the piece reply.md.)`;
  }
  if (pieces.length) writeFileSync(join(where.jobDir, "pieces.json"), `${JSON.stringify(pieces, null, 2)}\n`);
  writeFileSync(where.replyFile, words.endsWith("\n") ? words : `${words}\n`);
  const outcome = {
    status, by: "http", exit_code: httpStatus, job_seconds: jobSeconds, message: entry?.id ?? null,
    pieces: pieces.map((p) => p.name), reply_file: where.replyFile, answer_from: status === "answered" ? answerFrom : null,
  };
  writeFileSync(join(where.jobDir, "outcome.json"), `${JSON.stringify(outcome, null, 2)}\n`);
  return { ...outcome, reply: words };
}

export const exitCodeOf = (status) => (status === "answered" ? 0 : status === "stopped" ? 4 : 3);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  answerOne(process.env).then((r) => {
    process.stdout.write(r.reply.endsWith("\n") ? r.reply : `${r.reply}\n`);
    process.exit(exitCodeOf(r.status));
  }, (err) => {
    if (err instanceof Refusal) { errorLine(err.message, "refused"); process.exit(2); }
    errorLine(`the job could not be answered: ${String(err?.message ?? err).slice(0, 400)}`);
    process.exit(3);
  });
}
