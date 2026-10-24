#!/usr/bin/env node
// The install guard: installed on the fleet host as /opt/fleet/deploymgr-guard.mjs.
//
// Two questions the deployment manager did not ask before 2026-09-29, when
// ride-maker became the thirtieth agent on mesh-node-platform. The node
// connects with ONE credential listing every hosted agent's subjects, so each
// agent makes its NATS CONNECT line longer; the thirtieth took it past the
// broker's max_control_line (then 65536), the broker dropped the connection,
// pm2 restarted the node every 26 seconds, and all 29 platform agents were
// unreachable for 18 minutes. will-it-install had passed and deploymgr had
// said "deployed" (docs/technical-debt.md item 93).
//
// 1. BEFORE: what would the node and the host look like with this install on
//    them? The node's CONNECT size against the broker's max_control_line, the
//    agents on the node against what one node is built for, the host's disk
//    and its memory. Any of them past 80% refuses the install with a sentence
//    naming the limit and the numbers. `precheck` and the exported `precheck()`.
//
// 2. AFTER: watch the node for two minutes before anything says "deployed".
//    Its pm2 restart count must not climb, its log must not show a failed
//    connect, and the new agent and three others on the node must answer a
//    probe that wakes no model (GET /version on the node's local socket).
//    `watch`. Taking the install back out is steps.py's, which placed it.
//
// Nothing here prints a credential: the node's JWT is measured and decoded
// for its subject list, and only byte counts leave this file.
//
//   node guard.mjs survey   [--fleet /opt/fleet]
//   node guard.mjs precheck --agent <name> --package-bytes <n> [--node-root <dir> --proc <pm2 name>] [--fleet <dir>]
//   node guard.mjs mark     --proc <pm2 name> --log <file>
//   node guard.mjs watch    --proc <pm2 name> --log <file> [--agent <name>] [--node-root <dir> | --session-file <file>]
//                           [--seconds 120] [--sample 3] [--restarts-before <n>] [--log-from <byte offset>]
//
// Each prints one JSON object on one line.
import { existsSync, readFileSync, readdirSync, statSync, statfsSync, openSync, readSync, closeSync } from "node:fs";
import { posix } from "node:path";
const { join } = posix; // the fleet host is linux, and the tests run anywhere
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";

/** The share of any limit an install may take the node or the host to. */
export const THRESHOLD = 0.8;
/** CONNECT carries the JWT plus the nonce signature (86 bytes), the client's
 *  name, version and flags, and the verb itself. 512 is above what nats.js
 *  sends around a JWT, so the estimate errs toward refusing. */
export const CONNECT_OVERHEAD = 512;
/** What one more agent adds to the node's JWT when the credential on disk
 *  cannot be read: measured 2026-09-29 across the three nodes on the fleet host
 *  (19528 bytes for 8 agents, 67370 for 30), rounded up. */
export const FALLBACK_PER_AGENT = 2300;
/** Disk a new install may take beyond its package: the dependency tree npm
 *  places in ~/.deps and the logs. The package itself is counted twice (the
 *  staging copy and the installed one). */
export const DEPS_ALLOWANCE = 256 * 1024 * 1024;
/** The broker's max_control_line and the node's designed size, when nothing
 *  on the host records them. 262144 is the live nats-mesh config since
 *  2026-09-29 (docs/nats-server-config.md); 500 is the adapter's declared
 *  node capacity (NODE_MAX_AGENTS in mesh-adapter.mjs). */
export const DEFAULT_LIMITS = {
  max_control_line: 262144,
  max_control_line_source: "the broker's config as docs/nats-server-config.md records it",
  max_agents: 500,
  max_agents_source: "the adapter node's declared capacity",
};
/** Log lines that mean the node could not hold its connection. */
export const CONNECT_FAILURES = /maximum control line|Failed to connect to NATS|Authorization Violation|could not mint a node credential/i;

const KEY = /U[A-Z2-7]{55}/;

// ── the credential, measured ─────────────────────────────────────────────

/** The JWT out of a .creds file's text, or null. */
export function jwtOfCreds(text) {
  const m = /-+BEGIN NATS USER JWT-+\s*(\S+?)\s*-+END NATS USER JWT-+/.exec(String(text ?? ""));
  return m ? m[1] : null;
}

/** The claims a JWT carries (its middle part), or null. */
export function claimsOf(jwt) {
  const part = String(jwt ?? "").split(".")[1];
  if (!part) return null;
  try { return JSON.parse(Buffer.from(part, "base64url").toString("utf8")); } catch { return null; }
}

/** What one more agent adds to the JWT, in encoded bytes, read off the
 *  credential itself: every subject naming an agent key belongs to that agent
 *  (cred-template.ts nodePermissions enumerates them per agent), so the
 *  largest agent's share of the claims, base64-encoded, is what the next one
 *  costs. Null when the claims name no agent. */
export function perAgentGrowth(claims) {
  const nats = claims?.nats ?? {};
  const lists = [nats.pub?.allow, nats.sub?.allow].filter(Array.isArray);
  const byKey = new Map();
  for (const list of lists) {
    for (const s of list) {
      const k = KEY.exec(String(s))?.[0];
      if (!k) continue;
      // The subject as it sits in the JSON array: quoted, with its comma.
      byKey.set(k, (byKey.get(k) ?? 0) + JSON.stringify(String(s)).length + 1);
    }
  }
  if (!byKey.size) return null;
  const most = Math.max(...byKey.values());
  return { agents: byKey.size, bytes: Math.ceil((most * 4) / 3) };
}

// ── the projection ───────────────────────────────────────────────────────

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const gib = (n) => (n / 1024 ** 3).toFixed(1);
const mib = (n) => Math.round(n / 1024 ** 2);
const num = (n) => Number(n).toLocaleString("en-US");

/** What the node and the host would look like after this install, and each
 *  number against its limit. `facts` is a survey; `install` names the agent,
 *  the package's size, and the node root it lands on (null for an agent that
 *  runs its own adapter). An agent already in the node's folder list is an
 *  update or a reinstall and adds nothing to the node. */
export function project(facts, install) {
  const limits = { ...DEFAULT_LIMITS, ...(facts?.limits ?? {}) };
  const node = install.node_root ? (facts?.nodes ?? []).find((n) => n.root === install.node_root) ?? null : null;
  const adding = node ? !(node.names ?? []).includes(install.agent) : !install.update;
  const checks = [];
  if (node) {
    const growth = adding ? (node.per_agent_bytes ?? FALLBACK_PER_AGENT) : 0;
    const now = node.connect_bytes ?? ((node.jwt_bytes ?? 0) + CONNECT_OVERHEAD);
    checks.push({
      what: "connect", node: node.proc, limit: limits.max_control_line, now, after: now + growth,
      measured: node.jwt_bytes != null,
      words: (after, p) => `${node.proc}'s NATS CONNECT would be ${num(after)} bytes${adding ? ` with ${install.agent} on it` : ""}, ${p}% of the broker's max_control_line of ${num(limits.max_control_line)} (${limits.max_control_line_source})`,
    });
    checks.push({
      what: "agents", node: node.proc, limit: limits.max_agents, now: node.agents, after: node.agents + (adding ? 1 : 0),
      words: (after, p) => `${node.proc} would hold ${after} agents, ${p}% of the ${limits.max_agents} one node is built for (${limits.max_agents_source})`,
    });
  }
  const disk = facts?.host?.disk;
  if (disk?.size > 0) {
    const pkg = Math.max(0, Number(install.package_bytes) || 0);
    const adds = pkg * 2 + (adding ? DEPS_ALLOWANCE : 0);
    const used = disk.size - disk.avail;
    checks.push({
      what: "disk", limit: disk.size, now: used, after: used + adds,
      words: (after, p) => `the host's disk would be ${p}% full (${gib(after)} of ${gib(disk.size)} GiB, counting this package twice${adding ? " and 256 MiB for its dependencies" : ""})`,
    });
  }
  const mem = facts?.host?.memory;
  if (mem?.total > 0) {
    const per = adding && node && node.agents > 0 && node.rss > 0 ? Math.ceil(node.rss / node.agents) : 0;
    const used = mem.total - mem.available;
    checks.push({
      what: "memory", limit: mem.total, now: used, after: used + per,
      words: (after, p) => `the host's memory would be ${p}% in use (${gib(after)} of ${gib(mem.total)} GiB${per ? `, counting ${mib(per)} MiB for one more agent on ${node.proc}` : ""})`,
    });
  }
  return { adding, node: node?.proc ?? null, checks };
}

/** Refuse past THRESHOLD of any limit, with a sentence naming it. */
export function precheck(facts, install, threshold = THRESHOLD) {
  const { adding, node, checks } = project(facts, install);
  const rows = checks.map((c) => ({
    what: c.what, ...(c.node ? { node: c.node } : {}), limit: c.limit, now: c.now, after: c.after,
    now_pct: pct(c.now, c.limit), after_pct: pct(c.after, c.limit),
    ...(c.measured === false ? { estimated: "the node's credential could not be read; its size is a floor" } : {}),
  }));
  const over = checks.filter((c) => c.after > c.limit * threshold);
  const said = over.map((c) => c.words(c.after, pct(c.after, c.limit)));
  const limitPct = Math.round(threshold * 100);
  return {
    ok: over.length === 0, act: "precheck", agent: install.agent, adding, node, threshold: limitPct, checks: rows,
    ...(over.length ? {
      refusal: `Refused before anything was placed: ${said.join("; and ")}. An install may take a node or the host to ${limitPct}% of a limit and no further.`,
    } : {}),
  };
}

// ── the survey, on the host ──────────────────────────────────────────────

/** The host's real answers. Every one is a seam the tests replace. */
export const hostIO = {
  exists: existsSync,
  read: (p) => readFileSync(p, "utf8"),
  list: (p) => readdirSync(p),
  size: (p) => statSync(p).size,
  disk: (p) => { const s = statfsSync(p); return { avail: s.bavail * s.bsize, size: s.blocks * s.bsize }; },
  pm2: () => {
    try { return JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })); } catch { return null; }
  },
};

function memoryOf(io) {
  try {
    const t = io.read("/proc/meminfo");
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(t)?.[1] ?? 0) * 1024;
    return { total: kb("MemTotal"), available: kb("MemAvailable") };
  } catch { return null; }
}

/** The nodes on this host: the default root and every root node-roots.json
 *  names, each with an agents/ folder. */
function nodeRoots(io, fleet) {
  const roots = new Map([[join(fleet, "node"), "mesh-node"]]);
  try {
    const table = JSON.parse(io.read(join(fleet, "node-roots.json")));
    for (const row of Object.values(table ?? {})) if (row?.root) roots.set(row.root, row.proc || "mesh-node");
  } catch { /* none recorded: the default stands */ }
  return [...roots].filter(([root]) => io.exists(join(root, "agents"))).map(([root, proc]) => ({ root, proc }));
}

export function survey(io = hostIO, fleet = "/opt/fleet") {
  let limits = { ...DEFAULT_LIMITS };
  const file = join(fleet, "deploymgr-limits.json");
  try {
    const rec = JSON.parse(io.read(file));
    if (Number.isInteger(rec?.max_control_line) && rec.max_control_line > 0) {
      limits.max_control_line = rec.max_control_line;
      limits.max_control_line_source = rec.source ? `recorded in ${file}: ${rec.source}` : `recorded in ${file}`;
    }
    if (Number.isInteger(rec?.max_agents) && rec.max_agents > 0) {
      limits.max_agents = rec.max_agents;
      limits.max_agents_source = `recorded in ${file}`;
    }
  } catch { /* no record: the defaults, which say where they come from */ }
  const procs = io.pm2() ?? [];
  const nodes = nodeRoots(io, fleet).map(({ root, proc }) => {
    let names = [];
    try { names = io.list(join(root, "agents")).sort(); } catch { /* an unreadable folder counts none */ }
    let jwt = null;
    try { jwt = jwtOfCreds(io.read(join(root, "mesh.creds"))); } catch { /* not minted yet */ }
    const growth = jwt ? perAgentGrowth(claimsOf(jwt)) : null;
    const p = procs.find((x) => x?.name === proc);
    return {
      root, proc, agents: names.length, names,
      ...(jwt ? { jwt_bytes: jwt.length, connect_bytes: jwt.length + CONNECT_OVERHEAD } : {}),
      per_agent_bytes: growth?.bytes ?? FALLBACK_PER_AGENT,
      ...(growth ? { credential_covers: growth.agents } : {}),
      ...(p ? { rss: p.monit?.memory ?? 0, status: p.pm2_env?.status, restarts: p.pm2_env?.restart_time } : {}),
    };
  });
  let disk = null;
  try { disk = io.disk("/"); } catch { /* unknown, and then unchecked */ }
  return { at: new Date().toISOString(), limits, host: { disk, memory: memoryOf(io) }, nodes };
}

// ── the watch ────────────────────────────────────────────────────────────

/** pm2's word on one process: status and restart count, or null. */
export function pm2State(rows, proc) {
  const p = (rows ?? []).find((x) => x?.name === proc);
  return p ? { status: p.pm2_env?.status ?? "unknown", restarts: Number(p.pm2_env?.restart_time ?? 0) } : null;
}

/** Up to n other agents on the node, spread across the sorted list so the
 *  same three are not always the ones asked. */
export function sampleOf(names, except, n = 3) {
  const others = [...names].filter((x) => x !== except).sort();
  if (others.length <= n) return others;
  const step = others.length / n;
  return Array.from({ length: n }, (_, i) => others[Math.floor(i * step)]);
}

/** The node's session-API discovery file, read for the socket and token. */
function sessionOf(io, file) {
  try {
    const d = JSON.parse(io.read(file));
    if (typeof d?.token !== "string") return null;
    return { socketPath: d.socket_path || null, port: Number.isInteger(d.port) ? d.port : null, token: d.token };
  } catch { return null; }
}

/** GET /version for one agent, over the node's socket. It is answered from
 *  the adapter's own state and wakes no model. */
function probeVersion(api, path) {
  return new Promise((resolve) => {
    const opts = api.socketPath ? { socketPath: api.socketPath } : { host: "127.0.0.1", port: api.port };
    const req = httpRequest({ ...opts, path, method: "GET", timeout: 10_000,
      headers: { authorization: `Bearer ${api.token}` } }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => {
        let ok = false;
        try { ok = res.statusCode === 200 && JSON.parse(body)?.ok === true; } catch { /* not an answer */ }
        resolve(ok ? { ok: true } : { ok: false, why: `answered ${res.statusCode}` });
      });
    });
    req.on("timeout", () => req.destroy(new Error("no answer in 10 seconds")));
    req.on("error", (e) => resolve({ ok: false, why: e.message }));
    req.end();
  });
}

/** The watch's real seams on the host. */
export function watchIO(io = hostIO, opts = {}) {
  const sessionFile = opts.node_root ? join(opts.node_root, "session_api.json") : opts.session_file;
  return {
    pm2: io.pm2,
    names: () => { try { return opts.node_root ? io.list(join(opts.node_root, "agents")) : []; } catch { return []; } },
    logSize: (f) => { try { return io.size(f); } catch { return 0; } },
    logSince: (f, from) => {
      try {
        const size = io.size(f);
        const start = size < from ? 0 : from; // a rotated log starts again
        const len = Math.min(size - start, 4 * 1024 * 1024);
        if (len <= 0) return "";
        const fd = openSync(f, "r");
        try { const b = Buffer.alloc(len); readSync(fd, b, 0, len, size - len); return b.toString("utf8"); } finally { closeSync(fd); }
      } catch { return ""; }
    },
    probe: async (agent) => {
      const api = sessionFile ? sessionOf(io, sessionFile) : null;
      if (!api) return { ok: false, why: "the node's session file names no socket" };
      return probeVersion(api, opts.node_root ? `/agents/${encodeURIComponent(agent)}/version` : "/version");
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  };
}

/** Where the pm2 process and its log stand now, so the watch can compare. */
export function mark(w, opts) {
  const s = pm2State(w.pm2(), opts.proc);
  return { ok: !!s, act: "mark", proc: opts.proc, status: s?.status ?? "absent", restarts: s?.restarts ?? null, log_offset: w.logSize(opts.log) };
}

/**
 * Watch the process that holds the agent for `seconds`, then ask the agent and
 * a sample of its neighbours to answer.
 *
 *  - pm2's restart count may not climb during the window, nor by more than one
 *    since `restarts_before` (the one restart `pm2 start` of the config gives
 *    a running node);
 *  - the process stays online;
 *  - nothing in its log since `log_from` says the connect failed;
 *  - the new agent and `sample` others answer GET /version, three tries each.
 *
 * Returns at the first failure with the reason, in a sentence.
 */
export async function watch(w, opts) {
  const seconds = Number(opts.seconds ?? 120);
  const interval = Math.min(Number(opts.interval ?? 10), seconds || 1) * 1000;
  const first = pm2State(w.pm2(), opts.proc);
  const out = (ok, reason, extra = {}) => ({ ok, act: "watch", proc: opts.proc, agent: opts.agent ?? null, seconds, ...(reason ? { reason } : {}), ...extra });
  if (!first) return out(false, `${opts.proc} is not in pm2`);
  const before = Number.isInteger(opts.restarts_before) ? opts.restarts_before : first.restarts;
  const logFrom = Number.isInteger(opts.log_from) ? opts.log_from : w.logSize(opts.log);
  const check = () => {
    const s = pm2State(w.pm2(), opts.proc);
    if (!s) return `${opts.proc} left pm2`;
    if (s.restarts > first.restarts) return `${opts.proc} restarted ${s.restarts - first.restarts} time${s.restarts - first.restarts === 1 ? "" : "s"} during the watch (pm2 count ${first.restarts} to ${s.restarts})`;
    if (s.restarts > before + 1) return `${opts.proc} restarted ${s.restarts - before} times since the install began (pm2 count ${before} to ${s.restarts})`;
    if (s.status !== "online") return `${opts.proc} is ${s.status} in pm2`;
    const hit = w.logSince(opts.log, logFrom).split("\n").find((l) => CONNECT_FAILURES.test(l));
    if (hit) return `${opts.proc}'s log says its connection failed: "${hit.trim().slice(0, 200)}"`;
    return null;
  };
  const end = w.now() + seconds * 1000;
  for (;;) {
    const bad = check();
    if (bad) return out(false, bad, { restarts: { before, at_start: first.restarts } });
    if (w.now() >= end) break;
    await w.sleep(Math.min(interval, Math.max(0, end - w.now())));
  }
  const asked = [...(opts.agent ? [opts.agent] : []), ...(opts.probe_sample === false ? [] : sampleOf(w.names(), opts.agent, opts.sample ?? 3))];
  const probes = {};
  for (const a of asked) {
    let r = { ok: false, why: "not asked" };
    for (let i = 0; i < 3; i++) {
      r = await w.probe(a);
      if (r.ok) break;
      await w.sleep(5000);
    }
    probes[a] = r.ok ? "answered" : `no answer: ${r.why}`;
  }
  const silent = asked.filter((a) => probes[a] !== "answered");
  const last = check();
  if (last) return out(false, last, { probes });
  if (silent.length) return out(false, `${silent.join(", ")} did not answer a health probe (GET /version on ${opts.proc}'s socket, no model woken): ${silent.map((a) => probes[a]).join("; ")}`, { probes });
  const s = pm2State(w.pm2(), opts.proc);
  return out(true, null, { probes, restarts: { before, at_start: first.restarts, at_end: s?.restarts } });
}

// ── the command line ─────────────────────────────────────────────────────

function flags(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    o[k.slice(2).replace(/-/g, "_")] = argv[i + 1];
    i++;
  }
  return o;
}
const int = (v) => (v === undefined || v === "" ? undefined : Number.parseInt(v, 10));

async function main(argv) {
  const [verb, ...rest] = argv;
  const f = flags(rest);
  const fleet = f.fleet || process.env.DM_FLEET || "/opt/fleet";
  if (verb === "survey") return survey(hostIO, fleet);
  if (verb === "precheck") {
    if (!f.agent) return { ok: false, error: "precheck needs --agent" };
    const facts = survey(hostIO, fleet);
    return { ...precheck(facts, { agent: f.agent, node_root: f.node_root || null, package_bytes: int(f.package_bytes) ?? 0, update: f.update === "1" }), limits: facts.limits };
  }
  if (verb === "mark") return mark(watchIO(hostIO, {}), { proc: f.proc, log: f.log });
  if (verb === "watch") {
    if (!f.proc || !f.log) return { ok: false, error: "watch needs --proc and --log" };
    const w = watchIO(hostIO, { node_root: f.node_root, session_file: f.session_file });
    return watch(w, {
      proc: f.proc, log: f.log, agent: f.agent && f.agent !== "-" ? f.agent : null,
      seconds: int(f.seconds) ?? 120, sample: int(f.sample) ?? 3, interval: int(f.interval) ?? 10,
      restarts_before: int(f.restarts_before), log_from: int(f.log_from),
      probe_sample: !!f.node_root,
    });
  }
  return { ok: false, error: "usage: guard.mjs survey | precheck | mark | watch" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (r) => { console.log(JSON.stringify(r)); },
    (e) => { console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 400) })); },
  );
}
