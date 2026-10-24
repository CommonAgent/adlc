// The tenant host (tenant-host.mjs): a person's own agent in the tenant
// project runs its adapter, the fleet supervisor and its work in one
// container, and reaches a model only through the mesh.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  MODEL_URL, PLACEHOLDER_KEY, actsForRecord, bindDescriptor, bindingRecord, gatewayKey, canonical, directoryVar, doorAnswer, handBackToAdapter, localExecution, meshUrlOf,
  modelDoor, readBundle, readTenantFile, relayRequestOf, rosterRow, workEnv,
  activityOf, busyOf, runSession, sessionEnd, wakeCaller, wakeServer, wakeWindows,
} from "../tenant-host.mjs";
// The fleet supervisor is the host's own program, not one of these tools: on
// AgentMesh it is fleet-manager/runtime/fleet/supervisor.mjs. Name it with
// ADLC_FLEET_SUPERVISOR to run the one test that drives a message through it;
// without it that test is skipped.
const SUPERVISOR = process.env.ADLC_FLEET_SUPERVISOR
  || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "fleet", "supervisor.mjs");
const { containerWorker } = existsSync(SUPERVISOR) ? await import(pathToFileURL(SUPERVISOR).href) : {};
import { tmp } from "./helpers.mjs";

const SEED = "SU" + "A".repeat(56);
const D5 = "-".repeat(5);
// A credential file in shape only: the dashes are built, so no line here looks like one.
const CREDS = `${D5}BEGIN NATS USER JWT${D5}
eyJx
-${D5}END NATS USER JWT-${D5}

${D5}BEGIN USER NKEY SEED${D5}
SUBBB
-${D5}END USER NKEY SEED-${D5}
`;

test("the credential bundle is read, and refused when it carries no key or no credential", () => {
  const b = readBundle(JSON.stringify({ agent_seed: SEED, mesh_creds: CREDS, servers: ["nats://203.0.113.10:4222", "wss://mesh.agentmesh.ai"], api_base: "https://api.agentmesh.ai/" }));
  assert.equal(b.seed, SEED);
  assert.equal(b.apiBase, "https://api.agentmesh.ai");
  assert.equal(meshUrlOf(b.servers), "wss://mesh.agentmesh.ai");
  assert.throws(() => readBundle("{}"), /no agent seed/);
  assert.throws(() => readBundle(JSON.stringify({ agent_seed: SEED })), /no mesh credential/);
  assert.throws(() => readBundle("not json"), /not JSON/);
});

test("the draft descriptor is bound to the agent and signed over its canonical form", () => {
  const draft = { format: "agent-descriptor-v1", does: "compares pages", offerings: [{ id: "compare" }], signatures: [{ old: true }] };
  let signed = "";
  const d = bindDescriptor(draft, { key: "UKEY", handle: "helper.person@example.com", version: "0.1.0" }, (m) => { signed = m; return "c2ln"; });
  assert.deepEqual(d.subject, { id: "UKEY", handle: "helper.person@example.com" });
  assert.equal(d.agent_version, "0.1.0");
  assert.equal(d.interaction, "service");
  assert.equal(d.acts_for, "person", "a person's own package acts for its person");
  assert.equal(d.fleet, false);
  assert.ok(!("shape" in d));
  assert.deepEqual(d.signatures, [{ tag: "descriptor-statement-v1", by: "UKEY", sig: "c2ln", alg: "ed25519" }]);
  const unsigned = { ...d };
  delete unsigned.signatures;
  assert.equal(signed, `descriptor-statement-v1\n${canonical(unsigned)}`);
  assert.equal(bindDescriptor({ format: "other" }, { key: "U" }), null);
});

test("the adapter is told the agent acts for its person", () => {
  assert.deepEqual(actsForRecord({ at: "2026-10-18T00:00:00Z" }), { acts_for: "person", set_at: "2026-10-18T00:00:00Z", by: "tenant-host" });
});

test("Common Agent 0.28.0-draft: no shape, acts_for stated, never unsigned", () => {
  const draft = { format: "agent-descriptor-v1", agent_version: "1", does: "x", offerings: [], shape: { kind: "plugin-on-harness", memory: "keeps" }, organization_name: "Stale" };
  let signed = "";
  const d = bindDescriptor(draft, { key: "UKEY", actsFor: "anyone" }, (m) => { signed = m; return "c2ln"; });
  assert.ok(!("shape" in d) && !signed.includes('"shape"'), "a writer never emits shape, a draft's own included");
  assert.equal(d.acts_for, "anyone");
  assert.ok(!("organization_name" in d), "organization_name only beside organization");
  // No signer, a signer that answers nothing, a signer that throws: no binding.
  assert.equal(bindDescriptor(draft, { key: "UKEY" }), null);
  assert.equal(bindDescriptor(draft, { key: "UKEY" }, () => null), null);
  assert.equal(bindDescriptor(draft, { key: "UKEY" }, () => { throw new Error("no key"); }), null);
});

test("the binding record carries memory to data use at the digest of the written bytes", () => {
  const bytes = Buffer.from('{"format":"agent-descriptor-v1"}\n');
  const r = bindingRecord(bytes, { at: "2026-10-17T00:00:00Z" });
  assert.deepEqual(r, {
    format: "descriptor-binding-v1", at: "2026-10-17T00:00:00Z", by: "tenant-host",
    digest: createHash("sha256").update(bytes).digest("hex"), changed: [], carried: { memory: "starts-clean-each-job" },
  });
});

test("the work's environment has the model door and its directories, and never the credential bundle", () => {
  const env = workEnv({ PATH: "/usr/bin", AGENT_HOME: "/home/agent", AGENTMESH_CREDENTIALS_JSON: "{secret}", TENANT_AGENT_NAME: "x", K_SERVICE: "agent-x" },
    { env: { MESH_JOB_DIR: "/tmp/mesh/jobs/x/1" } }, readTenantFile(JSON.stringify({ directories: ["records", "../bad"] })));
  assert.equal(env.AGENTMESH_CREDENTIALS_JSON, undefined);
  assert.equal(env.TENANT_AGENT_NAME, undefined);
  assert.equal(env.K_SERVICE, undefined);
  assert.equal(env.AGENTMESH_MODEL_URL, MODEL_URL);
  assert.equal(env.ANTHROPIC_BASE_URL, MODEL_URL);
  assert.equal(env.ANTHROPIC_API_KEY, PLACEHOLDER_KEY);
  assert.equal(env[directoryVar("records")], "/var/agent-state/records");
  assert.equal(Object.keys(env).filter((k) => k.startsWith("AGENT_DIRECTORY_")).length, 1);
  assert.equal(env.MESH_JOB_DIR, "/tmp/mesh/jobs/x/1");
  assert.equal(env.HOME, "/home/agent");
});

test("the roster of one runs the work in this container and nowhere else", () => {
  const row = rosterRow({ name: "helper", handle: "helper.person@example.com", key: "UKEY", tenant: readTenantFile(JSON.stringify({ answer_piece: "answer", job_seconds: 120 })) });
  assert.equal(row.container_only, true);
  assert.equal(row.container.job, "this-container");
  assert.equal(row.home, "/home/mesh");
  assert.equal(row.answer_piece, "answer");
  assert.equal(row.job_seconds, 120);
  assert.equal(row.jobs_at_once, 2);
  // As root the supervisor refuses a row with no uid; the work runs as the agent user.
  assert.equal(row.uid, 10001);
  assert.equal(row.gid, 10001);
});

test("a call to the door is carried whole as model.relay, and the gateway's answer comes back as it was", async () => {
  const relay = relayRequestOf("POST", "/v1/messages", { "anthropic-version": "2023-06-01", "x-api-key": PLACEHOLDER_KEY, authorization: "Bearer x" }, '{"max_tokens":5}');
  assert.equal(relay.api, "anthropic");
  assert.deepEqual(relay.headers, { "anthropic-version": "2023-06-01" });
  assert.equal(gunzipSync(Buffer.from(relay.body_gz_b64, "base64")).toString(), '{"max_tokens":5}');

  const answer = JSON.stringify({ type: "message", content: [{ type: "text", text: "hi" }] });
  const out = doorAnswer({ ok: true, payload: { status: 200, content_type: "application/json", body_gz_b64: gzipSync(answer).toString("base64") } });
  assert.deepEqual(out, { status: 200, content_type: "application/json", body: answer });
  const refused = doorAnswer({ ok: true, payload: { status: 429, content_type: "application/json", body_gz_b64: gzipSync('{"type":"error","error":{"message":"Your agents have used today\'s model allowance"}}').toString("base64") } });
  assert.equal(refused.status, 429);
  assert.match(refused.body, /allowance/);
  assert.equal(doorAnswer({ ok: false, code: "AGENT_UNAVAILABLE", error: "not connected" }).status, 503);
  assert.match(JSON.parse(doorAnswer({ ok: true, payload: { refused: "no" } }).body).error.message, /refused the call: no/);
});

test("the door answers an ordinary Anthropic client over loopback", async () => {
  const sent = [];
  const GW = "U" + "G".repeat(55);
  const asked = [];
  const server = modelDoor({
    to: gatewayKey(async (h) => { asked.push(h); return GW; }),
    send: async (body) => {
      sent.push(body);
      const reply = JSON.stringify({ type: "message", content: [{ type: "text", text: "four" }], usage: { input_tokens: 3, output_tokens: 1 } });
      return { ok: true, payload: { status: 200, content_type: "application/json", body_gz_b64: gzipSync(reply).toString("base64") } };
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = server.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": PLACEHOLDER_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "anything", max_tokens: 20, messages: [{ role: "user", content: "two and two" }] }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).content[0].text, "four");
    // The adapter's /send takes a key, so the handle is resolved first.
    assert.deepEqual(asked, ["models.platform@agentmesh.ai"]);
    assert.equal(sent[0].to, GW);
    assert.equal(sent[0].kind, "model.relay");
    const carried = JSON.parse(sent[0].text);
    assert.equal(carried.relay, "v1");
    assert.equal(carried.path, "/v1/messages");
    assert.equal(JSON.stringify(carried).includes(PLACEHOLDER_KEY), false);
  } finally {
    server.close();
  }
});

test("one message runs through the supervisor's container worker, here, and its reply and pieces come back", { skip: containerWorker ? false : "set ADLC_FLEET_SUPERVISOR to the fleet supervisor to run this" }, async () => {
  const root = tmp("tenant-host-");
  const mount = join(root, "mesh");
  const adapterJob = join(root, "adapter", "jobs", "m1");
  mkdirSync(adapterJob, { recursive: true });
  mkdirSync(mount, { recursive: true });
  // A stand-in for the package's one-message entrypoint: it reads the message
  // the supervisor staged, writes the reply, a piece and the outcome, and says
  // what it could see of its environment.
  const fake = join(root, "entrypoint.mjs");
  writeFileSync(fake, [
    'import { readFileSync, writeFileSync, mkdirSync } from "node:fs";',
    'import { join } from "node:path";',
    "const dir = process.env.MESH_JOB_DIR;",
    'const msg = JSON.parse(readFileSync(process.env.MESH_MESSAGE_FILE, "utf8"));',
    'mkdirSync(join(dir, "out"), { recursive: true });',
    'writeFileSync(join(dir, "out", "answer.md"), "the answer");',
    'writeFileSync(join(dir, "pieces.json"), JSON.stringify([{ name: "answer", path: "out/answer.md", media_type: "text/markdown" }]));',
    'writeFileSync(process.env.MESH_REPLY_FILE, `got: ${msg.text}; door: ${process.env.AGENTMESH_MODEL_URL}; key: ${process.env.AGENTMESH_CREDENTIALS_JSON ?? "none"}`);',
    'writeFileSync(join(dir, "outcome.json"), JSON.stringify({ status: "answered", by: "command", exit_code: 0, pieces: ["answer"] }));',
  ].join("\n"));
  const chowned = [];
  const handedBack = [];
  const start = handBackToAdapter(containerWorker({
    execute: localExecution({ entrypoint: fake, baseEnv: { PATH: process.env.PATH, AGENTMESH_CREDENTIALS_JSON: "{never}" }, tenant: readTenantFile("{}"), chown: (p) => chowned.push(p) }),
    mount: { hostRoot: mount, containerRoot: mount },
    report: async () => ({ ok: true }),
    log: () => {},
  }), { chown: (p, uid) => handedBack.push([p, uid]) });
  const agent = { name: "helper", key: "UKEY", handle: "helper.person@example.com", container: { job: "this-container" }, containerOnly: true, jobSeconds: 60 };
  const job = start(agent, { id: "m1", from: "USENDER", text: "compare these", job: { dir: adapterJob }, files: [] });
  const done = await job.finished;
  assert.equal(done.code, 0);
  assert.match(done.text, /got: compare these/);
  assert.match(done.text, new RegExp(`door: ${MODEL_URL.replace(/[.:/]/g, "\\$&")}`));
  assert.match(done.text, /key: none/);
  assert.ok(chowned.some((p) => p.startsWith(mount)), "the job folder was handed to the work's user");
  // The piece is put back where the adapter collects a delivery, and that
  // folder is handed back to the adapter's user after the copy.
  assert.equal(readFileSync(join(adapterJob, "out", "answer.md"), "utf8"), "the answer");
  assert.ok(handedBack.some(([p, uid]) => p.endsWith(join("out", "answer.md")) && uid === 10002), "the copied piece belongs to the adapter's user");
});

test("the gateway's key is resolved once and kept, a key is used as it is, and no key is said in words", async () => {
  let n = 0;
  let t = 0;
  const get = gatewayKey(async () => { n++; return "U" + "K".repeat(55); }, "models.platform@agentmesh.ai", { now: () => t });
  await get(); await get();
  assert.equal(n, 1);
  t = 700_000; await get();
  assert.equal(n, 2);
  const fixed = "U" + "F".repeat(55);
  assert.equal(await gatewayKey(async () => { throw new Error("never"); }, fixed)(), fixed);
  const server = modelDoor({ to: async () => null, send: async () => { throw new Error("never sent"); } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/v1/messages`, { method: "POST", body: "{}" });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error.message, /could not find AgentMesh's model gateway/);
  } finally { server.close(); }
});

// ── wake on message ──────────────────────────────────────────────────────

const jwtFor = (claims) => `Bearer ${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.SIGNATURE_REMOVED_BY_GOOGLE`;
const WAKER = "tenant-waker@example-tenants.iam.gserviceaccount.com";

test("a wake is taken only from the waker the deployment manager named", () => {
  assert.equal(wakeCaller(jwtFor({ email: WAKER }), WAKER).ok, true);
  assert.equal(wakeCaller(jwtFor({ email: "someone@else.iam.gserviceaccount.com" }), WAKER).ok, false);
  assert.equal(wakeCaller(undefined, WAKER).ok, false);
  assert.equal(wakeCaller("Bearer not-a-token", WAKER).ok, false);
  assert.match(wakeCaller(jwtFor({ email: WAKER }), "").why, /names no waker/);
});

test("a session ends after the idle window with nothing under way, never while a job runs, and at its limit", () => {
  assert.equal(sessionEnd({ busy: false, sinceChangeMs: 119_000, sinceStartMs: 130_000, idleMs: 120_000, maxMs: 3_300_000 }), null);
  assert.equal(sessionEnd({ busy: false, sinceChangeMs: 120_000, sinceStartMs: 130_000, idleMs: 120_000, maxMs: 3_300_000 }), "idle");
  assert.equal(sessionEnd({ busy: true, sinceChangeMs: 900_000, sinceStartMs: 900_000, idleMs: 120_000, maxMs: 3_300_000 }), null);
  assert.equal(sessionEnd({ busy: true, sinceChangeMs: 0, sinceStartMs: 3_300_000, idleMs: 120_000, maxMs: 3_300_000 }), "limit");
  const w = wakeWindows({ TENANT_WAKE_IDLE_SECONDS: "5", TENANT_WAKE_MAX_SECONDS: "99999" });
  assert.deepEqual(w, { idleMs: 30_000, maxMs: 3_300_000 });
  assert.deepEqual(wakeWindows({}), { idleMs: 120_000, maxMs: 3_300_000 });
});

test("activity changes when a job starts or the inbox changes, and busy means work under way", () => {
  const a = { jobs: new Map(), replying: new Map(), startRetries: new Map(), started: 0, finished: 0, pendingIds: [] };
  const before = activityOf(a);
  a.pendingIds = ["m1"];
  assert.notEqual(activityOf(a), before);
  assert.equal(busyOf(a), false);
  a.jobs.set("m1", {});
  assert.equal(busyOf(a), true);
});

test("a session runs until idle, then hands back its jobs, and the platform hears a beat while it waits", async () => {
  let t = 0;
  const a = { jobs: new Map(), replying: new Map(), startRetries: new Map(), started: 0, finished: 0, pendingIds: ["m1"] };
  const beats = [];
  let closed = null;
  const r = await runSession({
    now: () => t,
    sleep: async (ms) => {
      t += ms;
      if (t === 4000) { a.jobs.set("m1", {}); a.started = 1; }
      if (t === 20_000) { a.jobs.delete("m1"); a.finished = 1; a.pendingIds = []; }
    },
    idleMs: 30_000, maxMs: 600_000, tickMs: 2000, beatMs: 15_000,
    beat: (b) => beats.push(b),
    open: async () => {
      // As the real adapter does: closing the session stops it.
      let stopped; const died = new Promise((r) => { stopped = r; });
      return { readyMs: 1500, died, agent: () => a, close: async (why) => { closed = why; stopped("SIGTERM"); await died; return [{ agent: "U", ms: 16_000, ok: true }]; } };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.ended, "idle");
  assert.equal(closed, "idle");
  assert.equal(r.jobs.length, 1);
  assert.equal(r.ready_ms, 1500);
  assert.equal(r.session_ms, 50_000, "thirty seconds after the last change at twenty");
  assert.ok(beats.length >= 2);
});

test("a session whose adapter stops ends at once and says so; one that cannot start says why", async () => {
  let t = 0;
  const r = await runSession({
    now: () => t, sleep: async (ms) => { t += ms; }, idleMs: 60_000, maxMs: 600_000,
    open: async () => ({ readyMs: 1, died: Promise.resolve("1"), agent: () => null, close: async () => [] }),
  });
  assert.equal(r.ok, false);
  assert.match(r.ended, /adapter stopped/);
  const r2 = await runSession({ open: async () => { throw new Error("no key"); }, idleMs: 60_000, maxMs: 600_000 });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /no key/);
});

test("the wake door refuses a stranger, answers its state, and gives two callers the one session", async () => {
  let started = 0;
  let release;
  const server = wakeServer({
    waker: WAKER,
    log: () => {},
    state: () => "asleep",
    session: () => { started++; return new Promise((r) => { release = () => r({ ok: true, ended: "idle", jobs: [{ agent: "U" }] }); }); },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    const refused = await fetch(`${base}/wake`, { method: "POST", headers: { authorization: jwtFor({ email: "x@y.iam.gserviceaccount.com" }) } });
    assert.equal(refused.status, 403);
    assert.equal((await fetch(`${base}/other`, { method: "POST" })).status, 404);
    const one = fetch(`${base}/wake`, { method: "POST", headers: { authorization: jwtFor({ email: WAKER }) } });
    const two = fetch(`${base}/wake`, { method: "POST", headers: { authorization: jwtFor({ email: WAKER }) } });
    const [r1, r2] = await Promise.all([one, two]);
    assert.equal(r1.status, 200);
    release();
    const lines1 = (await r1.text()).trim().split("\n").map((l) => JSON.parse(l));
    const lines2 = (await r2.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(started, 1, "one session for both");
    assert.equal(lines1.at(-1).done, true);
    assert.equal(lines2.at(-1).jobs.length, 1);
    assert.ok(lines1[0].taken);
  } finally { server.close(); }
});
