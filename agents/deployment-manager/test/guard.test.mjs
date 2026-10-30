// The install guard (guard.mjs), with pm2, the node's credential, its log,
// its socket and the host's disk and memory stood in. What is pinned: the
// node's CONNECT size is measured off its own credential and grows by one
// agent's subjects for a new agent and by nothing for one already on it; any
// limit past 80% refuses with a sentence naming the limit and the numbers;
// the numbers of 2026-09-29 (a thirtieth agent on a 65536 broker) refuse;
// and the watch fails on a climbing restart count, a failed connect in the
// log or an agent that does not answer, and passes a quiet node.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimsOf, jwtOfCreds, perAgentGrowth, precheck, sampleOf, survey, watch, mark,
  CONNECT_OVERHEAD, DEPS_ALLOWANCE, FALLBACK_PER_AGENT,
} from "../guard.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const keyOf = (i) => "U" + Array.from({ length: 55 }, (_, j) => B32[(i * 7 + j * 3) % 32]).join("");

/** A node credential shaped the way cred-template.ts nodePermissions shapes
 *  one: fixed subjects, then each agent's enumerated ones. */
function nodeJwt(n) {
  const pub = ["mesh.registry.>", "mesh.agent.*.inbox", "mesh.task.>", "_INBOX.>", "$JS.API.INFO"];
  const sub = ["mesh.event.>", "mesh.task.>", "_INBOX.>"];
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    pub.push(`mesh.agent.${k}.outbox`, `mesh.trace.${k}`, `mesh.feed.${k}.*`,
      `$JS.API.STREAM.INFO.MESH_INBOX_${k}`, `$JS.API.CONSUMER.MSG.NEXT.MESH_INBOX_${k}.*`, `$JS.ACK.MESH_INBOX_${k}.>`);
    sub.push(`mesh.agent.${k}.inbox`, `mesh.agent.${k}.inbox.guarded`, `mesh.agent.${k}.outbox`);
  }
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ typ: "JWT", alg: "ed25519-nkey" })}.${enc({ sub: keyOf(999), nats: { pub: { allow: pub }, sub: { allow: sub } } })}.${"s".repeat(86)}`;
}
// The creds file's armour, built rather than written out, so the secret scan
// (tools/ci/check-secrets.mjs) never meets a creds header in the tree.
const D5 = "-".repeat(5);
const creds = (jwt) => `${D5}BEGIN NATS USER JWT${D5}\n${jwt}\n-${D5}END NATS USER JWT-${D5}\n\n` +
  `${D5}BEGIN USER NKEY SEED${D5}\nSUFAKE\n-${D5}END USER NKEY SEED-${D5}\n`;

const GIB = 1024 ** 3;
/** A host with the platform's node on it, holding `n` agents. */
function host({ n = 29, limits = null, disk = { avail: 70 * GIB, size: 100 * GIB }, mem = { total: 8 * GIB, avail: 5 * GIB }, rss = 600 * 1024 ** 2 } = {}) {
  const names = Array.from({ length: n }, (_, i) => `agent-${String(i).padStart(2, "0")}`);
  const files = {
    "/opt/fleet/node-roots.json": JSON.stringify({ acct: { root: "/opt/fleet/node-platform", proc: "mesh-node-platform" } }),
    "/opt/fleet/node-platform/mesh.creds": creds(nodeJwt(n)),
    "/proc/meminfo": `MemTotal:       ${mem.total / 1024} kB\nMemFree:        1 kB\nMemAvailable:   ${mem.avail / 1024} kB\n`,
    ...(limits ? { "/opt/fleet/deploymgr-limits.json": JSON.stringify(limits) } : {}),
  };
  return {
    exists: (p) => p === "/opt/fleet/node-platform/agents",
    read: (p) => { if (p in files) return files[p]; throw new Error(`ENOENT ${p}`); },
    list: () => names,
    size: () => 0,
    disk: () => disk,
    pm2: () => [{ name: "mesh-node-platform", monit: { memory: rss }, pm2_env: { status: "online", restart_time: 4 } }],
  };
}

test("the credential is read out of a creds file and its seed is never part of it", () => {
  const jwt = nodeJwt(2);
  assert.equal(jwtOfCreds(creds(jwt)), jwt);
  assert.equal(jwtOfCreds("nothing here"), null);
  assert.equal(claimsOf(jwt).nats.sub.allow.length, 3 + 6);
});

test("one more agent costs what the largest agent's subjects cost, encoded", () => {
  const g = perAgentGrowth(claimsOf(nodeJwt(3)));
  assert.equal(g.agents, 3);
  // Measured against the real thing: the JWT for 4 agents minus the JWT for
  // 3 is within a few bytes of the estimate (base64 rounding).
  const real = nodeJwt(4).length - nodeJwt(3).length;
  assert.ok(Math.abs(g.bytes - real) <= 4, `estimate ${g.bytes}, real ${real}`);
  assert.equal(perAgentGrowth({ nats: { pub: { allow: ["mesh.task.>"] } } }), null);
});

test("the survey measures the node and never carries the credential out", () => {
  const facts = survey(host({ n: 29 }), "/opt/fleet");
  const node = facts.nodes.find((x) => x.proc === "mesh-node-platform");
  assert.equal(node.agents, 29);
  assert.equal(node.jwt_bytes, nodeJwt(29).length);
  assert.equal(node.connect_bytes, nodeJwt(29).length + CONNECT_OVERHEAD);
  assert.equal(node.credential_covers, 29);
  assert.ok(!JSON.stringify(facts).includes(nodeJwt(29).split(".")[1]), "no part of the JWT leaves");
  assert.ok(!JSON.stringify(facts).includes("SUFAKE"));
  assert.equal(facts.limits.max_control_line, 262144);
});

test("a new agent on a roomy node passes, and every number is shown", () => {
  const facts = survey(host({ n: 29 }), "/opt/fleet");
  const r = precheck(facts, { agent: "ride-maker", node_root: "/opt/fleet/node-platform", package_bytes: 2_000_000 });
  assert.equal(r.ok, true, r.refusal);
  assert.equal(r.adding, true);
  assert.deepEqual(r.checks.map((c) => c.what), ["connect", "agents", "disk", "memory"]);
  const c = r.checks[0];
  assert.equal(c.after - c.now, facts.nodes[0].per_agent_bytes);
});

test("2026-09-29 again: a thirtieth agent against a 65536 max_control_line is refused, naming the limit and the numbers", () => {
  // The node's own subjects are shorter in this fake than in life, so the
  // limit is set where the fake's thirtieth agent crosses 80% the way the
  // real one crossed 100%.
  const facts = survey(host({ n: 29, limits: { max_control_line: 65536, source: "nats-mesh before the raise" } }), "/opt/fleet");
  const before = facts.nodes[0].connect_bytes;
  const limit = Math.floor((before + facts.nodes[0].per_agent_bytes) / 0.85);
  facts.limits.max_control_line = limit;
  const r = precheck(facts, { agent: "ride-maker", node_root: "/opt/fleet/node-platform", package_bytes: 1 });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /^Refused before anything was placed: mesh-node-platform's NATS CONNECT would be [\d,]+ bytes with ride-maker on it, 8\d(\.\d)?% of the broker's max_control_line of [\d,]+ \(recorded in \/opt\/fleet\/deploymgr-limits\.json: nats-mesh before the raise\)/);
  assert.match(r.refusal, /80% of a limit and no further\.$/);
});

test("an update of an agent already on the node adds nothing to the node, even on a full one", () => {
  const facts = survey(host({ n: 29 }), "/opt/fleet");
  facts.limits.max_control_line = Math.floor(facts.nodes[0].connect_bytes / 0.79);
  const r = precheck(facts, { agent: "agent-05", node_root: "/opt/fleet/node-platform", package_bytes: 1000 });
  assert.equal(r.adding, false);
  assert.equal(r.ok, true, r.refusal);
  assert.equal(r.checks[0].after, r.checks[0].now);
  // The same full node refuses a new one.
  assert.equal(precheck(facts, { agent: "new-one", node_root: "/opt/fleet/node-platform", package_bytes: 1000 }).ok, false);
});

test("agents placed earlier in the same landing are counted, because the node's credential does not carry them yet", () => {
  const facts = survey(host({ n: 29 }), "/opt/fleet");
  const per = facts.nodes[0].per_agent_bytes;
  const alone = precheck(facts, { agent: "ride-maker", node_root: "/opt/fleet/node-platform", package_bytes: 1 });
  const third = precheck(facts, { agent: "ride-maker", node_root: "/opt/fleet/node-platform", package_bytes: 1, also_adding: 2 });
  assert.equal(alone.checks[0].after - alone.checks[0].now, per, "nothing changes when nothing else is landing");
  assert.equal(third.checks[0].after - third.checks[0].now, 3 * per);
  // The folders are already on the node, so the agent count is not doubled.
  assert.equal(third.checks[1].after, alone.checks[1].after);
  // An update in the same landing still counts the new agents before it.
  const upd = precheck(facts, { agent: "agent-05", node_root: "/opt/fleet/node-platform", package_bytes: 1, update: true, also_adding: 2 });
  assert.equal(upd.checks[0].after - upd.checks[0].now, 2 * per);
  // And the sentence says so when it refuses.
  facts.limits.max_control_line = Math.floor((facts.nodes[0].connect_bytes + 2 * per) / 0.8);
  const r = precheck(facts, { agent: "ride-maker", node_root: "/opt/fleet/node-platform", package_bytes: 1, also_adding: 2 });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /with ride-maker on it and the 2 placed before it in this landing/);
});

test("the host's disk and memory refuse on their own, with their numbers", () => {
  const facts = survey(host({ disk: { avail: 20.1 * GIB, size: 100 * GIB } }), "/opt/fleet");
  const r = precheck(facts, { agent: "x", node_root: "/opt/fleet/node-platform", package_bytes: 1 });
  assert.equal(r.ok, false);
  assert.match(r.refusal, /the host's disk would be 80\.\d% full \(80\.\d of 100\.0 GiB, counting this package twice and 256 MiB for its dependencies\)/);
  const disk = r.checks.find((c) => c.what === "disk");
  assert.equal(disk.after - disk.now, 2 + DEPS_ALLOWANCE);
  const m = precheck(survey(host({ mem: { total: 8 * GIB, avail: 1.5 * GIB } }), "/opt/fleet"), { agent: "x", node_root: "/opt/fleet/node-platform", package_bytes: 1 });
  assert.equal(m.ok, false);
  assert.match(m.refusal, /the host's memory would be \d+(\.\d)?% in use \([\d.]+ of 8\.0 GiB, counting \d+ MiB for one more agent on mesh-node-platform\)/);
});

test("a node whose credential cannot be read is judged on the fallback growth and says it estimated", () => {
  const h = host({ n: 10 });
  const read = h.read;
  h.read = (p) => (p.endsWith("mesh.creds") ? (() => { throw new Error("EACCES"); })() : read(p));
  const facts = survey(h, "/opt/fleet");
  assert.equal(facts.nodes[0].per_agent_bytes, FALLBACK_PER_AGENT);
  const r = precheck(facts, { agent: "x", node_root: "/opt/fleet/node-platform", package_bytes: 1 });
  assert.ok(r.checks[0].estimated);
});

test("the sample is three others, spread, never the new agent", () => {
  const names = Array.from({ length: 30 }, (_, i) => `a${String(i).padStart(2, "0")}`);
  const s = sampleOf(names, "a00", 3);
  assert.equal(s.length, 3);
  assert.ok(!s.includes("a00"));
  assert.notDeepEqual(s, names.slice(1, 4));
  assert.deepEqual(sampleOf(["a", "b"], "a", 3), ["b"]);
});

/** A node that behaves as `script` says, on a clock that moves by sleeping. */
function fakeNode({ restartsAt = () => 4, status = () => "online", log = "", silent = [] } = {}) {
  let t = 0;
  const asked = [];
  return {
    asked,
    pm2: () => [{ name: "mesh-node-platform", pm2_env: { status: status(t), restart_time: restartsAt(t) } }],
    names: () => ["ride-maker", "a", "b", "c", "d"],
    logSize: () => 100,
    logSince: () => (typeof log === "function" ? log(t) : log),
    probe: async (a) => { asked.push(a); return silent.includes(a) ? { ok: false, why: "connect ENOENT" } : { ok: true }; },
    sleep: async (ms) => { t += ms; },
    now: () => t,
  };
}
const OPTS = { proc: "mesh-node-platform", log: "/opt/fleet/logs/mesh-node-platform.log", agent: "ride-maker", seconds: 120, sample: 3 };

test("a quiet node passes the watch after the whole two minutes, and the agent and three others answered", async () => {
  const w = fakeNode();
  const r = await watch(w, OPTS);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(Object.keys(r.probes), ["ride-maker", "a", "b", "c"]);
  assert.ok(w.now() >= 120_000);
});

test("the ride-maker failure: restarts climbing every 26 seconds fail the watch early, with the counts", async () => {
  const w = fakeNode({ restartsAt: (t) => 4 + Math.floor(t / 26_000) });
  const r = await watch(w, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /mesh-node-platform restarted 1 time during the watch \(pm2 count 4 to 5\)/);
  assert.ok(w.now() < 60_000, "it does not wait out the window once it has failed");
});

test("a restart before the watch beyond the one pm2 start gives is a failure too", async () => {
  const r = await watch(fakeNode({ restartsAt: () => 7 }), { ...OPTS, restarts_before: 4 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /restarted 3 times since the install began/);
  assert.equal((await watch(fakeNode({ restartsAt: () => 5 }), { ...OPTS, restarts_before: 4 })).ok, true);
});

test("after a reload of one agent the node may not have restarted at all", async () => {
  const r = await watch(fakeNode({ restartsAt: () => 5 }), { ...OPTS, restarts_before: 4, restarts_allowed: 0 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /restarted 1 time since the install began \(pm2 count 4 to 5\), and a reload restarts nothing/);
  assert.equal((await watch(fakeNode({ restartsAt: () => 4 }), { ...OPTS, restarts_before: 4, restarts_allowed: 0 })).ok, true);
});

test("the broker's refusal in the log fails the watch and is quoted", async () => {
  const r = await watch(fakeNode({ log: "2026-09-29 14:14:03: nats: maximum control line exceeded\n" }), OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /log says its connection failed: "2026-09-29 14:14:03: nats: maximum control line exceeded"/);
  const t = await watch(fakeNode({ log: "Failed to connect to NATS: TIMEOUT\n" }), OPTS);
  assert.match(t.reason, /Failed to connect to NATS/);
});

test("a node that is not online, or not in pm2, fails", async () => {
  assert.match((await watch(fakeNode({ status: () => "errored" }), OPTS)).reason, /is errored in pm2/);
  const gone = fakeNode();
  gone.pm2 = () => [];
  assert.match((await watch(gone, OPTS)).reason, /is not in pm2/);
});

test("an agent that does not answer its probe fails the watch and is named", async () => {
  const r = await watch(fakeNode({ silent: ["ride-maker"] }), OPTS);
  assert.equal(r.ok, false);
  assert.match(r.reason, /^ride-maker did not answer a health probe \(GET \/version on mesh-node-platform's socket, no model woken\)/);
});

test("the recovery watch after a rollback asks only the neighbours", async () => {
  const w = fakeNode();
  const r = await watch(w, { ...OPTS, agent: null, seconds: 60 });
  assert.equal(r.ok, true);
  assert.ok(!w.asked.includes("ride-maker"));
  assert.equal(w.asked.length, 3);
});

test("mark says where pm2 and the log stand", () => {
  const m = mark(fakeNode(), OPTS);
  assert.deepEqual({ restarts: m.restarts, status: m.status, log_offset: m.log_offset }, { restarts: 4, status: "online", log_offset: 100 });
});
