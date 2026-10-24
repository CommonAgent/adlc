#!/usr/bin/env node
// The tenant host: the entrypoint of a person's own agent in the tenant
// project (docs/tenant-isolation-plan.md, "A person's own agent in the tenant
// project"; technical debt 95). Copied into the image as
// /opt/tenant/tenant-host.mjs by the deployment manager's install-package,
// beside the fleet supervisor, on top of the package's one-message image.
//
// ONE CONTAINER, THREE PARTS, THREE USERS.
//
//   root   this file and the fleet supervisor it runs in-process, with a
//          roster of one: it takes each message from the adapter and runs the
//          package's one-message entrypoint for it, here, as a local child.
//   mesh   the mesh adapter (`agentmesh start --inbox`), which holds the
//          agent's own key in a state folder only it may read, registers the
//          agent, keeps its inbox and signs its replies.
//   agent  the package's work. It is handed the message and the job folder
//          and nothing else, never the key: the adapter's own rule, that
//          whatever runs the work can never sign as the agent.
//
// THE KEY arrives once, as AGENTMESH_CREDENTIALS_JSON, the agent's own secret
// in the tenant project, which only the agent's own service account may read.
// It is taken out of this process's environment before anything is started,
// so no child inherits it, and written only into the adapter's state folder.
//
// THE MODEL. The tenant network reaches the mesh and nothing else, so the
// work's model comes through the mesh: this file serves a door on
// http://127.0.0.1:8790 and names it to the work as AGENTMESH_MODEL_URL and
// ANTHROPIC_BASE_URL. Each call is carried whole, through the agent's own
// adapter, as the agent, to the model gateway's model.relay
// (models.platform@agentmesh.ai), which checks whose agent it is, counts the
// account's day, and answers. No model key is in here, and none is needed.
//
// WAKE ON MESSAGE (docs/tenant-isolation-plan.md, "Wake on message"). The
// service scales to zero and costs nothing while nobody writes to the agent:
// the platform holds its mail in its mailbox on the mesh meanwhile. When mail
// waits, the platform, and only the platform (Cloud Run lets through nothing
// but a request signed for the waker's account, TENANT_WAKER, and this checks
// the name again), sends POST /wake. That request is the session: the adapter
// starts, connects, takes its mail, the supervisor runs the work, and the
// request is held open, with a line every fifteen seconds, until nothing has
// happened for TENANT_WAKE_IDLE_SECONDS. Then the adapter is stopped (its
// registration and mailbox stay on the mesh) and the answer names every job
// the session ran, for the platform's run accounting. Cloud Run bills only
// while a request is open, and takes the idle instance away on its own.
//
//   needs: node >= 22, the mesh adapter on the path, the supervisor beside
//          this file, and the users mesh and agent the image made.
//   environment: AGENTMESH_CREDENTIALS_JSON, TENANT_AGENT_NAME,
//     TENANT_AGENT_HANDLE, TENANT_WAKER (the one account whose wake is
//     taken), optionally TENANT_ADMIT (handles, comma separated),
//     TENANT_MODEL_GATEWAY, TENANT_JOBS_AT_ONCE, TENANT_WAKE_IDLE_SECONDS,
//     TENANT_WAKE_MAX_SECONDS, PORT; and what the package's image already set
//     (AGENT_HOME, AGENT_PACKAGE, AGENT_DIR, ...).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { createRequire as amCreateRequire } from "node:module";
import { existsSync as amExists } from "node:fs";
import { dirname as amDirname, join as amJoin } from "node:path";
import { fileURLToPath as amFileURLToPath } from "node:url";

// The AgentMesh environment (env/<AGENTMESH_ENV>.json, default prod) through
// env/load.cjs. This file is copied flat onto hosts, so the loader is looked
// for in AGENTMESH_ENV_DIR, in the repository, beside this file, in
// /opt/fleet/env or /opt/agentmesh/env, then in an env/ above the working
// directory; not finding it is an error that names every place looked.
let amEnvLib;
function amEnv(key) {
  if (!amEnvLib) {
    const here = amDirname(amFileURLToPath(import.meta.url));
    const dirs = [process.env.AGENTMESH_ENV_DIR, amJoin(here, "../../env"), amJoin(here, "env"), "/opt/fleet/env", "/opt/agentmesh/env"].filter(Boolean);
    for (let d = process.cwd(); ; d = amDirname(d)) { dirs.push(amJoin(d, "env")); if (amDirname(d) === d) break; }
    const dir = dirs.find((d) => amExists(amJoin(d, "load.cjs")));
    if (!dir) throw new Error(`the AgentMesh environment loader (env/load.cjs) was not found; looked in ${dirs.join(", ")}`);
    amEnvLib = amCreateRequire(import.meta.url)(amJoin(dir, "load.cjs"));
  }
  return amEnvLib.get(key);
}

const here = dirname(fileURLToPath(import.meta.url));

export const MESH_USER = { name: "mesh", uid: 10002, gid: 10002, home: "/home/mesh" };
export const AGENT_USER = { name: "agent", uid: 10001, gid: 10001 };
export const STATE_DIR = `${MESH_USER.home}/.agentmesh/adapter`;
export const JOBS_ROOT = "/tmp/mesh";
export const DIRECTORIES_ROOT = "/var/agent-state";
export const MODEL_PORT = 8790;
export const MODEL_URL = `http://127.0.0.1:${MODEL_PORT}`;
export const DEFAULT_GATEWAY = "models.platform@agentmesh.ai";
export const MODEL_RELAY = "model.relay";
/** What ordinary Anthropic clients are given as a key. They insist on one;
 *  the door needs none and passes nothing of it on. */
export const PLACEHOLDER_KEY = "not-a-key-agentmesh-model-door";
/** The line a wake prints once the adapter serves the agent. */
export const READY_LINE = "tenant host: serving";
/** The line the deployment manager waits for in the service's log: the
 *  container started, read its own key, and waits to be woken. */
export const ASLEEP_LINE = "tenant host: asleep";
/** How long a session stays up after the last thing happened, and the most
 *  one session may last (Cloud Run's request limit is an hour). */
export const DEFAULT_IDLE_SECONDS = 120;
export const DEFAULT_MAX_SECONDS = 3300;
const BEAT_MS = 15_000;
export const TENANT_FILE = join(here, "tenant.json");
export const DESCRIPTOR_TAG = "descriptor-statement-v1";
const RELAY_HEADERS = ["anthropic-version", "anthropic-beta", "accept", "content-type"];
const NKEY_SEED = /^SU[A-Z2-7]{56}$/;

const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

// ── what arrives ──────────────────────────────────────────────────────────

/** The credential bundle, checked. It carries the agent's seed, the mesh
 *  credential, the mesh's addresses and the API's; nothing is printed. */
export function readBundle(text) {
  let d;
  try { d = JSON.parse(String(text ?? "")); } catch { throw new Error("AGENTMESH_CREDENTIALS_JSON is not JSON"); }
  const seed = String(d?.agent_seed ?? "").trim();
  if (!NKEY_SEED.test(seed)) throw new Error("the credential bundle carries no agent seed");
  const creds = String(d?.mesh_creds ?? "");
  if (!/BEGIN NATS USER JWT/.test(creds) || !/BEGIN USER NKEY SEED/.test(creds)) throw new Error("the credential bundle carries no mesh credential");
  const servers = (Array.isArray(d?.servers) ? d.servers : []).map(String).filter(Boolean);
  return { seed, creds, servers, apiBase: String(d?.api_base || amEnv("urls.api")).replace(/\/+$/, "") };
}

/** The mesh address the adapter dials: the WebSocket one, over 443, which
 *  the tenant network allows; the first address otherwise. */
export function meshUrlOf(servers) {
  return servers.find((s) => /^wss:\/\//.test(s)) ?? servers.find((s) => /^wss?:\/\//.test(s)) ?? servers[0] ?? amEnv("broker.wss");
}

/** The facts about the package the deployment manager wrote at build time. */
export function readTenantFile(text) {
  const t = JSON.parse(String(text ?? "{}"));
  return {
    descriptor: typeof t.descriptor === "string" ? t.descriptor : null,
    answer_piece: typeof t.answer_piece === "string" && t.answer_piece ? t.answer_piece : null,
    verify: typeof t.verify === "string" && t.verify ? t.verify : null,
    wants_replies: t.wants_replies === true,
    job_seconds: Number.isInteger(t.job_seconds) && t.job_seconds > 0 ? t.job_seconds : null,
    directories: (() => {
      const d = (Array.isArray(t.directories) ? t.directories : []).filter((n) => typeof n === "string" && /^[a-z][a-z0-9_-]{0,40}$/.test(n));
      return d.length ? d : ["records", "work"];
    })(),
    kind: typeof t.kind === "string" && t.kind ? t.kind : "program",
  };
}

export const directoryVar = (name) => "AGENT_DIRECTORY_" + name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

// ── the descriptor ────────────────────────────────────────────────────────

/** Canonical JSON: sorted keys, no whitespace (the form the deployment
 *  manager's records and bound descriptors are signed over). */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** The package's draft descriptor bound to this agent, as the host install
 *  binds it (deploymgr steps.py bind_descriptor, Common Agent 0.28.0-draft
 *  4.9, 6.2, 6.6): the subject filled in, what the install decides stated
 *  (interaction, acts_for, fleet), and signed by the agent's own key. Every
 *  agent serves a bound, signed Descriptor, so a binding that cannot be
 *  signed is no binding: null, and the caller installs nothing. `shape` was
 *  removed from the format in 0.28.0-draft and is never written, a draft's
 *  own included; what it said about how this runs goes to data use through
 *  bindingRecord below. `actsFor` is person: every agent this host serves is
 *  a person's own package, installed for the account that approved it, and
 *  that person is its owner (Common Agent 6.2, 6.9). The adapter is told the
 *  same through actsForRecord below, because it starts --unattended, which
 *  its default would otherwise read as organization. */
export function bindDescriptor(draft, { key, handle, version, interaction = "service", actsFor = "person" }, sign) {
  if (!draft || draft.format !== "agent-descriptor-v1") return null;
  const d = JSON.parse(JSON.stringify(draft));
  delete d.signatures;
  delete d.shape;
  d.subject = { id: key, ...(handle ? { handle } : {}) };
  if (!String(d.agent_version ?? "").trim()) d.agent_version = String(version ?? "");
  d.interaction = interaction;
  d.acts_for = actsFor;
  if (actsFor !== "organization") delete d.organization_name;
  if (typeof d.fleet !== "boolean") d.fleet = false;
  let sig = null;
  try { sig = sign ? sign(`${DESCRIPTOR_TAG}\n${canonical(d)}`) : null; } catch { sig = null; }
  if (typeof sig !== "string" || !sig) return null;
  d.signatures = [{ tag: DESCRIPTOR_TAG, by: key, sig, alg: "ed25519" }];
  return d;
}

/** The adapter's acts-for.json for this agent (mesh-adapter actsForDecide:
 *  the agent's own file is read first), so the Descriptor the adapter serves
 *  and rebinds at start says the same as the one bound here: person. */
export function actsForRecord({ at = new Date().toISOString() } = {}) {
  return { acts_for: "person", set_at: at, by: "tenant-host" };
}

/** What the former shape said about how this runs, carried to data use
 *  (Common Agent 6.12) the way the adapter reads it: descriptor-binding.json
 *  beside descriptor.json, keyed by the digest of the bytes written, so the
 *  adapter carries it onto the registration's data use while that is the
 *  descriptor it serves. One container job per message: memory starts clean. */
export function bindingRecord(bytes, { at = new Date().toISOString() } = {}) {
  return {
    format: "descriptor-binding-v1", at, by: "tenant-host",
    digest: createHash("sha256").update(bytes).digest("hex"),
    changed: [], carried: { memory: "starts-clean-each-job" },
  };
}

// ── the model door ────────────────────────────────────────────────────────

/** One call to the door, as model.relay carries it. */
export function relayRequestOf(method, path, headers, body) {
  const kept = {};
  for (const k of RELAY_HEADERS) {
    const v = headers?.[k];
    if (typeof v === "string" && v.length < 300) kept[k] = v;
  }
  return { relay: "v1", api: "anthropic", method: method === "GET" ? "GET" : "POST", path: String(path || "/"), headers: kept, body_gz_b64: gzipSync(Buffer.from(body ?? "", "utf8")).toString("base64") };
}

/** An answer in Anthropic's error shape, so an ordinary client reads it. */
export function doorError(status, message) {
  return { status, content_type: "application/json", body: JSON.stringify({ type: "error", error: { type: status === 429 ? "rate_limit_error" : "api_error", message } }) };
}

/** What the gateway's answer, as the adapter's /send gives it back, becomes
 *  for the client: its status, its type and its body, or a refusal in words. */
export function doorAnswer(sent) {
  const pay = sent?.payload;
  if (sent?.ok === false || !pay) {
    const why = String(sent?.error ?? sent?.message ?? "the model gateway did not answer").slice(0, 300);
    return doorError(sent?.code === "AGENT_UNAVAILABLE" ? 503 : 502, `The model door could not reach AgentMesh's model gateway: ${why}.`);
  }
  if (pay.queued) return doorError(503, "The model gateway is not answering right now. Try again in a minute.");
  if (typeof pay.body_gz_b64 !== "string" || !Number.isInteger(pay.status)) {
    const why = pay.refused ?? pay.error?.message ?? pay.message ?? "it answered in a shape the door does not read";
    return doorError(502, `The model gateway refused the call: ${String(why).slice(0, 300)}`);
  }
  let body;
  try { body = gunzipSync(Buffer.from(pay.body_gz_b64, "base64")).toString("utf8"); } catch { return doorError(502, "The model gateway's answer could not be unpacked."); }
  return { status: pay.status, content_type: typeof pay.content_type === "string" ? pay.content_type : "application/json", body };
}

/** The door: an HTTP server on loopback that carries each call through `send`
 *  (the adapter's /send, as the agent) and writes back what came. */
/** The gateway's key, from its handle, kept ten minutes. The adapter's /send
 *  takes a key and not a handle, so the handle is resolved first (through the
 *  adapter, which checks the naming service's signature); a key is used as it
 *  is. Null when it does not resolve. */
export function gatewayKey(resolve, gateway = DEFAULT_GATEWAY, { ttlMs = 600_000, now = Date.now } = {}) {
  let kept = null;
  return async () => {
    if (/^U[A-Z2-7]{55}$/.test(gateway)) return gateway;
    if (kept && now() - kept.at < ttlMs) return kept.key;
    const key = await resolve(gateway).catch(() => null);
    if (key) kept = { key, at: now() };
    return key ?? null;
  };
}

export function modelDoor({ send, to, timeoutMs = 200_000 }) {
  return createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (d) => { body += d; if (body.length > 1_000_000) req.destroy(); });
    req.on("end", async () => {
      let out;
      try {
        const relay = relayRequestOf(req.method, req.url, req.headers, body);
        const key = await to();
        out = key
          ? doorAnswer(await send({ to: key, kind: MODEL_RELAY, text: JSON.stringify(relay), timeout_ms: timeoutMs }))
          : doorError(503, "The model door could not find AgentMesh's model gateway on the mesh just now. Try again in a minute.");
      } catch (err) {
        out = doorError(502, `The model door could not reach AgentMesh's model gateway: ${String(err?.message ?? err).slice(0, 200)}.`);
      }
      res.writeHead(out.status, { "content-type": out.content_type });
      res.end(out.body);
    });
  });
}

// ── the work, here ────────────────────────────────────────────────────────

/** The environment the work is given: the image's own settings with nothing
 *  secret in them, the model door, the directories, and what the supervisor
 *  set for this one message. Never the credential bundle. */
export function workEnv(base, spec, tenant) {
  const env = {};
  for (const [k, v] of Object.entries(base ?? {})) {
    if (k === "AGENTMESH_CREDENTIALS_JSON" || /^(K_|TENANT_)/.test(k)) continue;
    env[k] = v;
  }
  return {
    ...env,
    HOME: base?.AGENT_HOME ?? "/home/agent",
    AGENTMESH_MODEL_URL: MODEL_URL,
    ANTHROPIC_BASE_URL: MODEL_URL,
    ANTHROPIC_API_KEY: PLACEHOLDER_KEY,
    ...Object.fromEntries((tenant?.directories ?? []).map((d) => [directoryVar(d), `${DIRECTORIES_ROOT}/${d}`])),
    ...(spec?.env ?? {}),
  };
}

/** Everything under a folder, handed to the agent's user. */
export function chownTree(path, uid, gid, chown = chownSync) {
  chown(path, uid, gid);
  let st;
  try { st = lstatSync(path); } catch { return; }
  if (!st.isDirectory()) return;
  for (const e of readdirSync(path)) {
    const p = join(path, e);
    if (lstatSync(p).isSymbolicLink()) continue;
    chownTree(p, uid, gid, chown);
  }
}

/** The supervisor's launcher, for work that runs in this container: the
 *  package's one-message entrypoint as a child, as the agent's user, in the
 *  job folder the supervisor staged. Same handle as a container execution:
 *  { finished, kill }. */
export function localExecution({ entrypoint, baseEnv, tenant, spawnImpl = spawn, chown = chownSync, user = AGENT_USER }) {
  return (spec) => {
    try {
      chownTree(spec.hostDir, user.uid, user.gid, chown);
    } catch (err) {
      return { finished: Promise.resolve({ code: 127, error: `the job folder could not be handed to the work: ${err?.message ?? err}` }), kill() {} };
    }
    let child;
    try {
      child = spawnImpl(process.execPath, [entrypoint], {
        cwd: spec.hostDir, env: workEnv(baseEnv, spec, tenant), stdio: ["ignore", "inherit", "pipe"],
        ...(process.getuid?.() === 0 ? { uid: user.uid, gid: user.gid } : {}),
      });
    } catch (err) {
      return { finished: Promise.resolve({ code: 127, error: `the work could not be started: ${err?.message ?? err}` }), kill() {} };
    }
    let err = "";
    child.stderr?.on("data", (d) => { err = (err + d).slice(-4000); process.stderr.write(d); });
    const finished = new Promise((resolve) => {
      child.on("error", (e) => resolve({ code: 127, error: `the work could not be started: ${e?.message ?? e}` }));
      child.on("close", (code) => resolve({ code: code ?? 0, error: err.trim().slice(-2000) }));
    });
    return { finished, kill() { try { child.kill("SIGTERM"); } catch { /* already gone */ } } };
  };
}

/** The supervisor's worker, with the adapter's own job folder handed back to
 *  the adapter's user once the work's pieces are copied into it (the copy is
 *  made by this process, as root, before `finished` resolves), so the adapter
 *  can write the delivery's manifest beside them. */
export function handBackToAdapter(startWorker, { chown = chownSync, user = MESH_USER } = {}) {
  return (agent, entry, ctx) => {
    const h = startWorker(agent, entry, ctx);
    const dir = entry?.job?.dir;
    return {
      kind: h.kind, pid: h.pid, kill: () => h.kill(),
      finished: h.finished.then((r) => {
        try { if (dir && existsSync(dir)) chownTree(dir, user.uid, user.gid, chown); } catch { /* the reply still goes; the adapter reads what it can */ }
        return r;
      }),
    };
  };
}

/** The roster of one the supervisor is given. */
export function rosterRow({ name, handle, key, tenant, jobsAtOnce = 2 }) {
  return {
    name, home: MESH_USER.home, brain: "/bin/false", agent_key: key, handle,
    // The user the work runs as. The supervisor, running as root, refuses a
    // row with no uid rather than run anything as root; the launcher below
    // runs the work as this user in any case.
    uid: AGENT_USER.uid, gid: AGENT_USER.gid,
    job_seconds: tenant.job_seconds ?? undefined,
    ...(tenant.wants_replies ? { wants_replies: true } : {}),
    ...(tenant.answer_piece ? { answer_piece: tenant.answer_piece } : {}),
    ...(tenant.verify ? { verify: tenant.verify } : {}),
    // Work runs in this container and nowhere else: marked, with a "job" that
    // is only this file's launcher, never a Cloud Run execution.
    container: { job: "this-container" },
    container_only: true,
    jobs_at_once: jobsAtOnce,
  };
}

// ── the wake ──────────────────────────────────────────────────────────────

/** Whether a wake came from the platform's waker. Cloud Run has already
 *  refused anything not signed for an account allowed to call this service,
 *  and passes the token on with its signature taken off; this reads whose it
 *  was, so no other account that may someday be allowed to call can wake it.
 *  With no waker named, nothing is taken. */
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

/** What the supervisor is doing, as one string: it changes whenever a job
 *  starts or ends, a reply is settled, or the adapter's inbox changes. */
export function activityOf(a) {
  if (!a) return "";
  return [a.jobs?.size ?? 0, a.replying?.size ?? 0, a.startRetries?.size ?? 0, a.started ?? 0, a.finished ?? 0, (a.pendingIds ?? []).join(",")].join("|");
}

/** Whether work is under way: a job running, a reply being settled, or a
 *  start waiting to be tried again. A session never ends on one of these. */
export function busyOf(a) {
  return !!a && ((a.jobs?.size ?? 0) > 0 || (a.replying?.size ?? 0) > 0 || (a.startRetries?.size ?? 0) > 0);
}

/** Why a session ends now, or null: nothing has happened for the idle
 *  window and nothing is under way, or it has run as long as one may. */
export function sessionEnd({ busy, sinceChangeMs, sinceStartMs, idleMs, maxMs }) {
  if (sinceStartMs >= maxMs) return "limit";
  if (!busy && sinceChangeMs >= idleMs) return "idle";
  return null;
}

/** The two windows, from the environment, held to sane bounds. */
export function wakeWindows(env = process.env) {
  const n = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
  return {
    idleMs: n(env.TENANT_WAKE_IDLE_SECONDS, DEFAULT_IDLE_SECONDS, 30, 900) * 1000,
    maxMs: n(env.TENANT_WAKE_MAX_SECONDS, DEFAULT_MAX_SECONDS, 120, 3300) * 1000,
  };
}

/**
 * One session: open (the adapter up, the supervisor watching), then look
 * every tick until the session ends, then close (the job summaries taken,
 * the supervisor stopped, the adapter stopped). `open` answers
 * { agent(), readyMs, died (a promise of why the adapter stopped), close(why) }.
 * `beat` is called every beatMs with where it stands; `abandoned()` says the
 * platform stopped waiting, which ends it as soon as nothing is under way.
 */
export async function runSession({ open, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), idleMs, maxMs, tickMs = 2000, beatMs = BEAT_MS, beat = () => {}, abandoned = () => false }) {
  const t0 = now();
  let s;
  try {
    s = await open();
  } catch (err) {
    return { ok: false, ended: "could not start", error: String(err?.message ?? err).slice(0, 300), session_ms: now() - t0, jobs: [] };
  }
  let died = null;
  s.died?.then((why) => { died = why ?? "it stopped"; }, () => { died = "it stopped"; });
  let sig = activityOf(s.agent());
  let changed = now();
  let lastBeat = now();
  let ended = null;
  for (;;) {
    await sleep(tickMs);
    if (died) { ended = `the adapter stopped (${died})`; break; }
    const a = s.agent();
    const next = activityOf(a);
    if (next !== sig) { sig = next; changed = now(); }
    const busy = busyOf(a);
    ended = sessionEnd({ busy, sinceChangeMs: abandoned() ? Infinity : now() - changed, sinceStartMs: now() - t0, idleMs, maxMs });
    if (ended) break;
    if (now() - lastBeat >= beatMs) {
      lastBeat = now();
      try { beat({ beat: Math.round((now() - t0) / 1000), busy }); } catch { /* a listener gone is not the session's problem */ }
    }
  }
  // Whether the adapter stopped on its own is read before closing: closing
  // stops it too, and that is the session ending as it should.
  const failed = died !== null;
  let jobs = [];
  try { jobs = (await s.close(ended)) ?? []; } catch { /* the session is over either way */ }
  return { ok: !failed, ended, ready_ms: s.readyMs ?? null, session_ms: now() - t0, jobs };
}

/**
 * The wake door on $PORT: GET answers the state (Cloud Run's own checks), POST
 * /wake from the waker joins the session in progress or starts one, and is
 * answered in lines (x-ndjson): one when it is taken, one every beat, and the
 * last with what the session did. Anything else is refused.
 */
export function wakeServer({ waker, session, state = () => "asleep", log: say = log }) {
  let current = null;
  const listeners = new Set();
  return createServer((req, res) => {
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
      say(`tenant host: a wake was refused: ${who.why}`);
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: who.why }));
      return;
    }
    req.resume();
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const line = (o) => { try { res.write(`${JSON.stringify(o)}\n`); } catch { /* gone */ } };
    const joined = !!current;
    line({ taken: true, joined, at: new Date().toISOString() });
    const me = { line, open: true };
    listeners.add(me);
    res.on("close", () => { me.open = false; listeners.delete(me); });
    current ??= session({
      beat: (o) => { for (const l of listeners) l.line(o); },
      abandoned: () => listeners.size === 0,
    }).finally(() => { current = null; });
    current.then((r) => { line({ done: true, ...r }); res.end(); }, (err) => { line({ done: true, ok: false, error: String(err?.message ?? err).slice(0, 300), jobs: [] }); res.end(); });
  });
}

// ── start ─────────────────────────────────────────────────────────────────

function asMesh(args, env) {
  return spawnSync("agentmesh", args, { env, uid: MESH_USER.uid, gid: MESH_USER.gid, encoding: "utf8", timeout: 60_000 });
}

async function main() {
  const raw = process.env.AGENTMESH_CREDENTIALS_JSON ?? "";
  delete process.env.AGENTMESH_CREDENTIALS_JSON;
  const name = String(process.env.TENANT_AGENT_NAME ?? "").trim();
  const handle = String(process.env.TENANT_AGENT_HANDLE ?? "").trim().toLowerCase();
  const gateway = String(process.env.TENANT_MODEL_GATEWAY ?? DEFAULT_GATEWAY).trim();
  const waker = String(process.env.TENANT_WAKER ?? "").trim();
  const windows = wakeWindows(process.env);
  const bornAt = Date.now();
  let state = "starting";
  if (process.getuid?.() !== 0) throw new Error("the tenant host runs as root, so the key and the work can be kept apart");
  if (!name || !handle) throw new Error("TENANT_AGENT_NAME and TENANT_AGENT_HANDLE are the deployment manager's to set, and are not set");
  if (!waker) throw new Error("TENANT_WAKER is the deployment manager's to set, and is not set, so nothing could wake this agent");
  const bundle = readBundle(raw);
  const tenant = readTenantFile(existsSync(TENANT_FILE) ? readFileSync(TENANT_FILE, "utf8") : "{}");

  // The key, into the adapter's folder, which only the mesh user may read.
  const require = createRequire("/usr/local/lib/node_modules/mesh-adapter/node_modules/");
  const nk = (() => { const m = require("nkeys.js"); return m.default ?? m; })();
  const kp = nk.fromSeed(new TextEncoder().encode(bundle.seed));
  const key = kp.getPublicKey();
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(join(STATE_DIR, "identity.json"), JSON.stringify({ public_key: key, seed: bundle.seed, created_at: new Date().toISOString() }), { mode: 0o600 });
  writeFileSync(join(STATE_DIR, "mesh.creds"), bundle.creds, { mode: 0o600 });
  const pkgDir = join(process.env.AGENT_HOME ?? "/home/agent", process.env.AGENT_PACKAGE ?? "");
  const draftPath = tenant.descriptor ? join(pkgDir, tenant.descriptor)
    : (["agent-descriptor.json", "descriptor.json"].map((n) => join(pkgDir, n)).find((p) => existsSync(p)) ?? join(pkgDir, "descriptor.json"));
  if (existsSync(draftPath)) {
    const bound = bindDescriptor(JSON.parse(readFileSync(draftPath, "utf8")),
      { key, handle, version: process.env.AGENT_PACKAGE_VERSION },
      (m) => Buffer.from(kp.sign(new TextEncoder().encode(m))).toString("base64"));
    if (bound) {
      const bytes = Buffer.from(`${JSON.stringify(bound, null, 2)}\n`, "utf8");
      writeFileSync(join(STATE_DIR, "descriptor.json"), bytes, { mode: 0o600 });
      writeFileSync(join(STATE_DIR, "descriptor-binding.json"), `${JSON.stringify(bindingRecord(bytes))}\n`, { mode: 0o600 });
    } else {
      log("the package's descriptor could not be bound and signed with this agent's key, so none is installed; the adapter serves its own minimal one");
    }
  }
  writeFileSync(join(STATE_DIR, "acts-for.json"), `${JSON.stringify(actsForRecord())}
`, { mode: 0o600 });
  chownTree(`${MESH_USER.home}/.agentmesh`, MESH_USER.uid, MESH_USER.gid);
  chmodSync(STATE_DIR, 0o700);

  // Where the work keeps what outlives one message, for as long as this
  // container lives, and where each message's folder goes.
  for (const d of tenant.directories) mkdirSync(`${DIRECTORIES_ROOT}/${d}`, { recursive: true });
  mkdirSync(JOBS_ROOT, { recursive: true });
  chownTree(DIRECTORIES_ROOT, AGENT_USER.uid, AGENT_USER.gid);

  // Who may reach it at first, settled before the adapter ever starts. Its
  // owner's own agents are admitted by the adapter without asking; nobody
  // outside the mesh reaches it.
  const meshEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: MESH_USER.home,
    MESH_ADAPTER_STATE: STATE_DIR, MESH_URL: meshUrlOf(bundle.servers),
  };
  const contacts = [["contacts", "default", "a2a", "block"],
    ...String(process.env.TENANT_ADMIT ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).map((h) => ["contacts", "allow", h])];
  for (const args of contacts) {
    const r = asMesh(args, meshEnv);
    if (r.status !== 0) log(`agentmesh ${args.join(" ")} did not take: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`);
  }

  const sup = await import(pathToFileURL(join(here, "supervisor.mjs")).href);
  const api = async () => {
    const a = sup.readSessionApi(MESH_USER.home);
    if (!a) throw new Error("the adapter has not written its session file yet");
    return a;
  };
  const send = async (body) => {
    const a = await api();
    const r = await sup.fetchLocal(sup.dialOf(a, "/send"), {
      method: "POST", headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return r.json();
  };
  const resolve = async (h) => {
    const a = await api();
    const r = await sup.fetchLocal(sup.dialOf(a, `/diag/resolve?handle=${encodeURIComponent(h)}`), { headers: { authorization: `Bearer ${a.token}` }, signal: AbortSignal.timeout(20_000) });
    const j = await r.json();
    return j?.result?.resolved && typeof j.result.agentId === "string" ? j.result.agentId : null;
  };
  // The model door answers only while the adapter is up; between wakes a
  // call has nothing to go through, and nothing is running to make one.
  modelDoor({ send, to: gatewayKey(resolve, gateway) }).listen(MODEL_PORT, "127.0.0.1");
  const entrypoint = join(process.env.AGENT_DIR ?? "/opt/agent", "entrypoint.mjs");
  const jobsAtOnce = Math.min(10, Math.max(1, Number(process.env.TENANT_JOBS_AT_ONCE) || 2));
  let wakes = 0;

  /** One session's start: the adapter as mesh, answering, then the supervisor
   *  with a roster of one, whose job summaries are kept for the answer. */
  const open = async () => {
    wakes += 1;
    const cold = wakes === 1;
    const t0 = Date.now();
    state = "waking";
    const adapter = spawn("agentmesh", ["start", "--inbox", "--name", name, "--unattended"], {
      env: meshEnv, uid: MESH_USER.uid, gid: MESH_USER.gid, stdio: ["ignore", "inherit", "inherit"],
    });
    let exited = null;
    const died = new Promise((r) => adapter.on("exit", (code, signal) => { exited = String(signal ?? code); r(exited); }));
    const stopAdapter = async () => {
      if (exited !== null) return;
      try { adapter.kill("SIGTERM"); } catch { /* gone */ }
      const done = await Promise.race([died.then(() => true), new Promise((r) => setTimeout(() => r(false), 10_000))]);
      if (!done) { try { adapter.kill("SIGKILL"); } catch { /* gone */ } await died; }
    };
    try {
      for (let i = 0; ; i++) {
        if (exited !== null) throw new Error(`the adapter stopped as it started (${exited})`);
        try {
          const a = await api();
          if (!sup.pidAlive(a.pid)) throw new Error("an earlier adapter's session file");
          const r = await sup.fetchLocal(sup.dialOf(a, "/version"), { headers: { authorization: `Bearer ${a.token}` }, signal: AbortSignal.timeout(5000) });
          if (r.ok) break;
        } catch { /* not yet */ }
        if (i >= 240) throw new Error("the adapter did not answer its session interface in two minutes");
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      await stopAdapter();
      state = "asleep";
      throw err;
    }
    const jobs = [];
    const supervisor = new sup.Supervisor({
      agents: [rosterRow({ name, handle, key, tenant, jobsAtOnce })],
      startWorker: handBackToAdapter(sup.containerWorker({
        execute: localExecution({ entrypoint, baseEnv: process.env, tenant }),
        mount: { hostRoot: JOBS_ROOT, containerRoot: JOBS_ROOT },
        report: async () => ({ ok: true }),
      })),
      fileDeployRequest: async () => ({ ok: false, error: "a person's agent cannot file a deploy request from the tenant sandbox" }),
      fileStepCharge: async () => ({ ok: false, error: "a person's agent files no step charges from the tenant sandbox" }),
      // The job summaries go back in the wake's answer, not over the network.
      fileJobs: async (body) => { jobs.push(...(body?.jobs ?? [])); return { ok: true }; },
      jobsReportMs: 3_600_000,
    }).start();
    const readyMs = Date.now() - t0;
    state = "serving";
    log(`${READY_LINE} ${handle} (${cold ? `cold, ${Date.now() - bornAt} ms since the container started` : "warm"}; the adapter answered in ${readyMs} ms)`);
    return {
      readyMs,
      died,
      agent: () => supervisor.agent(name),
      close: async (why) => {
        try { await supervisor.sendJobReports(); } catch { /* what was kept is what goes */ }
        supervisor.stop();
        await stopAdapter();
        state = "asleep";
        log(`${ASLEEP_LINE} ${handle} (${why}; ${jobs.length} job${jobs.length === 1 ? "" : "s"} this wake)`);
        return jobs;
      },
    };
  };

  const server = wakeServer({
    waker,
    state: () => state,
    session: ({ beat, abandoned }) => {
      const cold = wakes === 0;
      return runSession({ open, ...windows, beat, abandoned }).then((r) => ({ ...r, cold, container_ms: Date.now() - bornAt }));
    },
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.listen(Number(process.env.PORT || 8080), "0.0.0.0");
  state = "asleep";
  log(`${ASLEEP_LINE} ${handle}: waiting to be woken by ${waker}`);
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    log(`the tenant host could not start: ${String(err?.message ?? err).slice(0, 400)}`);
    process.exit(1);
  });
}
