#!/usr/bin/env node
// The wake host: the entrypoint the deployment manager puts in front of a
// container agent (docs/container-agents-plan.md, "Wake on message"), so the
// agent sleeps at no cost and runs only while the platform has woken it.
//
// A container agent is a program from somebody's repository that holds its
// own key and speaks the mesh itself (a ring member written with CrewAI, a
// board worker that drives Codex, the input converter). Its code is not ours
// and is not changed. The deployment manager builds the folder's own
// Dockerfile exactly as before, then builds one more layer on top of it: this
// file, a node to run it with, and the image's own command written down
// (command.json). The service then scales to zero: min 0, max 1, CPU billed
// only while a request is open.
//
// THE WAKE. Cloud Run lets through only a request signed for an account that
// may invoke the service, and the one such account is the platform's waker
// (WAKE_BY; this file checks the name again). POST /wake is the session: the
// agent's own command starts, connects to the mesh with its own key, takes the
// mail that waited in its mailbox and does its work. The request is held
// open, with a line every fifteen seconds, until nothing has happened for
// WAKE_IDLE_SECONDS; then the agent is stopped (its registration and mailbox
// stay on the mesh) and the last line says how the session went, for the
// platform's run accounting. A second wake while one runs joins it.
//
// WHAT COUNTS AS SOMETHING HAPPENING, since the agent's code cannot be asked:
// a line it writes to its log, a process it started that is still running (a
// harness working an item), a new wake or a touch (the platform touches a
// woken agent whenever more mail reaches it). The agent's own ready line, when
// the install named one, is passed on as soon as it appears, so a caller
// waiting for the agent knows when it is on the mesh.
//
// The agent's own HTTP answer on $PORT (a health check) is not needed any
// more: this file answers Cloud Run, and the agent is started without PORT.
//
//   environment: WAKE_BY (the waker's address), WAKE_IDLE_SECONDS,
//     WAKE_MAX_SECONDS, WAKE_READY_LINE, PORT; and whatever the agent's own
//     settings are, passed to it unchanged.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The line the deployment manager waits for: the container started and
 *  waits to be woken. */
export const ASLEEP_LINE = "wake host: asleep";
/** The line a wake prints once the agent's own ready line appeared. */
export const SERVING_LINE = "wake host: serving";
export const DEFAULT_IDLE_SECONDS = 120;
export const DEFAULT_MAX_SECONDS = 3300;
export const COMMAND_FILE = join(here, "command.json");
const BEAT_MS = 15_000;
/** The settings this file reads, which the agent is not given. */
const OWN = new Set(["WAKE_BY", "WAKE_IDLE_SECONDS", "WAKE_MAX_SECONDS", "WAKE_READY_LINE", "PORT", "LD_LIBRARY_PATH"]);

const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

// ── what the image says ───────────────────────────────────────────────────

/** The agent's own command, as the image it was built from said it
 *  (ENTRYPOINT then CMD, the way a container starts), and its folder. */
export function readCommand(text) {
  let d;
  try { d = JSON.parse(String(text ?? "")); } catch { throw new Error("command.json is not JSON"); }
  const list = (v) => (Array.isArray(v) ? v.map(String) : []);
  const argv = [...list(d?.entrypoint), ...list(d?.cmd)];
  if (!argv.length || !argv[0]) throw new Error("the image names no command to start the agent with");
  const cwd = typeof d?.workdir === "string" && d.workdir.startsWith("/") ? d.workdir : null;
  // The image's own library path, if it set one: the entrypoint sets this
  // file's for its node, and the agent gets its own back.
  const ld = (Array.isArray(d?.env) ? d.env : []).map(String).find((e) => e.startsWith("LD_LIBRARY_PATH="));
  return { argv, cwd, ldLibraryPath: ld ? ld.slice("LD_LIBRARY_PATH=".length) : null };
}

/** The agent's environment: everything it was given, less this file's own
 *  settings and the library path this file's node needs (the image's own
 *  put back, when it had one). */
export function agentEnv(env, ldLibraryPath = null) {
  const out = {};
  for (const [k, v] of Object.entries(env ?? {})) if (!OWN.has(k)) out[k] = v;
  if (ldLibraryPath) out.LD_LIBRARY_PATH = ldLibraryPath;
  return out;
}

/** The two windows, from the environment, held to sane bounds. */
export function wakeWindows(env = process.env) {
  const n = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
  return {
    idleMs: n(env.WAKE_IDLE_SECONDS, DEFAULT_IDLE_SECONDS, 30, 900) * 1000,
    maxMs: n(env.WAKE_MAX_SECONDS, DEFAULT_MAX_SECONDS, 120, 3300) * 1000,
  };
}

// ── the wake ──────────────────────────────────────────────────────────────

/** Whether a request came from the platform's waker. Cloud Run has already
 *  refused anything not signed for an account allowed to call this service,
 *  and passes the token on with its signature taken off; this reads whose it
 *  was, so no other account that may call it (a project owner) can wake it. */
export function wakeCaller(authorization, waker) {
  const want = String(waker ?? "").trim().toLowerCase();
  if (!want) return { ok: false, why: "this agent names no waker, so no wake is taken" };
  const m = /^Bearer\s+[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*$/.exec(String(authorization ?? "").trim());
  if (!m) return { ok: false, why: "a wake is a signed request from the platform" };
  let claims = null;
  try { claims = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); } catch { /* said below */ }
  if (String(claims?.email ?? "").trim().toLowerCase() !== want) return { ok: false, why: "only the platform's waker may wake this agent" };
  return { ok: true };
}

/** Why a session ends now, or null. */
export function sessionEnd({ busy, sinceChangeMs, sinceStartMs, idleMs, maxMs }) {
  if (sinceStartMs >= maxMs) return "limit";
  if (!busy && sinceChangeMs >= idleMs) return "idle";
  return null;
}

/** The processes under one process, from /proc (a harness a board worker
 *  started, a CLI a ring member runs for a line). */
export function descendantsOf(pid, procRoot = "/proc", read = (p) => readFileSync(p, "utf8"), list = (p) => readdirSync(p)) {
  const parent = new Map();
  let names = [];
  try { names = list(procRoot); } catch { return []; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = read(`${procRoot}/${name}/stat`);
      // pid (comm) state ppid ...: comm may hold spaces and parentheses.
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      parent.set(Number(name), ppid);
    } catch { /* gone already */ }
  }
  const out = [];
  const want = new Set([pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [p, pp] of parent) if (want.has(pp) && !want.has(p)) { want.add(p); out.push(p); grew = true; }
  }
  return out;
}

/**
 * One session: the agent started, watched every tick, stopped when it ends.
 * `start` answers { died (a promise of why it stopped), busy(), stop() } and
 * calls `onOutput(line)` for every line the agent writes. `touched()` answers
 * the last time the platform touched or joined the session.
 */
export async function runSession({ start, readyLine = null, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), idleMs, maxMs, tickMs = 2000, beatMs = BEAT_MS, beat = () => {}, ready = () => {}, touched = () => 0, abandoned = () => false }) {
  const t0 = now();
  let changed = t0;
  let readyMs = null;
  let lines = 0;
  const onOutput = (line) => {
    lines += 1;
    changed = now();
    if (readyMs === null && readyLine && String(line).includes(readyLine)) {
      readyMs = now() - t0;
      try { ready({ ready: true, ready_ms: readyMs }); } catch { /* a listener gone */ }
    }
  };
  let s;
  try {
    s = await start(onOutput);
  } catch (err) {
    return { ok: false, ended: "could not start", error: String(err?.message ?? err).slice(0, 300), ready_ms: null, session_ms: now() - t0, jobs: [] };
  }
  let died = null;
  s.died.then((why) => { died = why ?? "it stopped"; }, () => { died = "it stopped"; });
  let lastBeat = t0;
  let ended = null;
  for (;;) {
    await sleep(tickMs);
    if (died) { ended = `the agent stopped (${died})`; break; }
    const busy = s.busy();
    if (busy) changed = Math.max(changed, now() - 1);
    changed = Math.max(changed, touched());
    ended = sessionEnd({ busy, sinceChangeMs: abandoned() && !busy ? Infinity : now() - changed, sinceStartMs: now() - t0, idleMs, maxMs });
    if (ended) break;
    if (now() - lastBeat >= beatMs) {
      lastBeat = now();
      try { beat({ beat: Math.round((now() - t0) / 1000), busy }); } catch { /* a listener gone */ }
    }
  }
  const failed = died !== null;
  try { await s.stop(); } catch { /* the session is over either way */ }
  const sessionMs = now() - t0;
  // The session itself is the one piece of work a container agent reports:
  // how long it ran, which is what Cloud Run bills. The platform counts it
  // under the wake's run accounting record.
  const jobs = [{ kind: "wake", started_at: new Date(t0).toISOString(), finished_at: new Date(t0 + sessionMs).toISOString(), ms: sessionMs, ok: !failed, lines }];
  return { ok: !failed, ended, ready_ms: readyMs, session_ms: sessionMs, jobs };
}

/**
 * The wake door on $PORT: GET answers the state (Cloud Run's own checks),
 * POST /wake from the waker joins the session in progress or starts one and
 * is answered in lines (x-ndjson): one when it is taken, one when the agent is
 * ready, one every beat, and the last with what the session did. POST
 * /wake?touch=1 says more mail reached a woken agent: it keeps the session up
 * and never starts one. Anything else is refused.
 */
export function wakeServer({ waker, session, state = () => "asleep", log: say = log }) {
  let current = null;
  let touchedAt = 0;
  let readyLine = null;
  const listeners = new Set();
  const server = createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/healthz")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`${state()}\n`);
      return;
    }
    if (req.method !== "POST" || !/^\/wake(\?|$)/.test(req.url ?? "")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "nothing here but the wake" }));
      return;
    }
    const who = wakeCaller(req.headers.authorization, waker);
    if (!who.ok) {
      say(`wake host: a wake was refused: ${who.why}`);
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: who.why }));
      return;
    }
    req.resume();
    if (/[?&]touch=1(&|$)/.test(req.url ?? "")) {
      if (current) touchedAt = Date.now();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, touched: !!current, state: state() }));
      return;
    }
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const line = (o) => { try { res.write(`${JSON.stringify(o)}\n`); } catch { /* gone */ } };
    const joined = !!current;
    touchedAt = Date.now();
    line({ taken: true, joined, at: new Date().toISOString() });
    if (joined && readyLine) line(readyLine);
    const me = { line };
    listeners.add(me);
    res.on("close", () => { listeners.delete(me); });
    current ??= (readyLine = null, session({
      beat: (o) => { for (const l of listeners) l.line(o); },
      ready: (o) => { readyLine = o; for (const l of listeners) l.line(o); },
      touched: () => touchedAt,
      abandoned: () => listeners.size === 0,
    }).finally(() => { current = null; readyLine = null; }));
    current.then((r) => { line({ done: true, ...r }); res.end(); }, (err) => { line({ done: true, ok: false, error: String(err?.message ?? err).slice(0, 300), jobs: [] }); res.end(); });
  });
  return server;
}

/** Start the agent's own command, its output passed through line by line. */
export function startAgent({ argv, cwd, env, onOutput, spawnImpl = spawn, descendants = descendantsOf }) {
  const child = spawnImpl(argv[0], argv.slice(1), { cwd: cwd ?? undefined, env, stdio: ["ignore", "pipe", "pipe"] });
  const died = new Promise((resolve) => {
    child.on("error", (e) => resolve(`it could not be started: ${e?.message ?? e}`));
    child.on("exit", (code, signal) => resolve(String(signal ?? code)));
  });
  const pipe = (stream, out) => {
    let buf = "";
    stream?.setEncoding?.("utf8");
    stream?.on("data", (d) => {
      out.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { onOutput(buf.slice(0, i)); buf = buf.slice(i + 1); }
      if (buf.length > 64_000) { onOutput(buf); buf = ""; }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  let exited = false;
  died.then(() => { exited = true; });
  return {
    died,
    busy: () => !exited && child.pid !== undefined && descendants(child.pid).length > 0,
    stop: async () => {
      if (exited) return;
      try { child.kill("SIGTERM"); } catch { /* gone */ }
      const done = await Promise.race([died.then(() => true), new Promise((r) => setTimeout(() => r(false), 10_000))]);
      if (!done) { try { child.kill("SIGKILL"); } catch { /* gone */ } await died; }
    },
  };
}

// ── start ─────────────────────────────────────────────────────────────────

async function main() {
  const waker = String(process.env.WAKE_BY ?? "").trim();
  if (!waker) throw new Error("WAKE_BY is the deployment manager's to set, and is not set, so nothing could wake this agent");
  if (!existsSync(COMMAND_FILE)) throw new Error(`${COMMAND_FILE} is missing: the image's own command was not written down when it was built`);
  const command = readCommand(readFileSync(COMMAND_FILE, "utf8"));
  const windows = wakeWindows(process.env);
  const readyLine = String(process.env.WAKE_READY_LINE ?? "").trim() || null;
  const bornAt = Date.now();
  let wakes = 0;
  let state = "asleep";
  let running = null;

  const server = wakeServer({
    waker,
    state: () => state,
    session: ({ beat, ready, touched, abandoned }) => {
      wakes += 1;
      const cold = wakes === 1;
      state = "waking";
      return runSession({
        readyLine, ...windows, beat, touched, abandoned,
        ready: (o) => { state = "serving"; log(`${SERVING_LINE} (${cold ? `cold, ${Date.now() - bornAt} ms since the container started` : "warm"}; ready in ${o.ready_ms} ms)`); ready(o); },
        start: async (onOutput) => {
          running = startAgent({ argv: command.argv, cwd: command.cwd, env: agentEnv(process.env, command.ldLibraryPath), onOutput });
          if (!readyLine) state = "serving";
          return running;
        },
      }).then((r) => {
        state = "asleep";
        running = null;
        log(`${ASLEEP_LINE} (${r.ended}; ${Math.round(r.session_ms / 1000)} s awake)`);
        return { ...r, cold, container_ms: Date.now() - bornAt };
      });
    },
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.listen(Number(process.env.PORT || 8080), "0.0.0.0");
  log(`${ASLEEP_LINE}: waiting to be woken by ${waker}`);
  const bye = async () => { try { await running?.stop(); } catch { /* gone */ } process.exit(0); };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log(`the wake host could not start: ${String(err?.message ?? err).slice(0, 400)}`);
    process.exit(1);
  });
}
