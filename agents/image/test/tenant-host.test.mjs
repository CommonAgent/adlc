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
  ADAPTER_BIN, ADAPTER_MODULES, adapterPlaces, credentialText, relayUpdates, resolveWorkUser, settleImage, usersToAdd, workUserOf,
} from "../tenant-host.mjs";
import { appendFileSync } from "node:fs";
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

test("Common Agent 0.41.0: no shape, acts_for stated, never unsigned", () => {
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

test("a session says it is ready once the adapter is up, and the wake door passes it on, to a caller who joins late too", async () => {
  const said = [];
  let t = 0;
  const r = await runSession({ open: async () => ({ agent: () => ({}), readyMs: 1335, close: async () => [] }), now: () => (t += 1000), sleep: async () => {}, idleMs: 1000, maxMs: 600_000, ready: (o) => said.push(o) });
  assert.deepEqual(said, [{ ready: true, ready_ms: 1335 }]);
  assert.equal(r.ok, true);
  let release;
  const server = wakeServer({
    waker: WAKER,
    log: () => {},
    session: ({ ready }) => new Promise((done) => { setTimeout(() => ready({ ready: true, ready_ms: 900 }), 20); release = () => done({ ok: true, ended: "idle", jobs: [] }); }),
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const one = fetch(`${base}/wake`, { method: "POST", headers: { authorization: jwtFor({ email: WAKER }) } });
    await new Promise((ok) => setTimeout(ok, 120));
    const two = fetch(`${base}/wake`, { method: "POST", headers: { authorization: jwtFor({ email: WAKER }) } });
    const [r1, r2] = await Promise.all([one, two]);
    await new Promise((ok) => setTimeout(ok, 50));
    release();
    const lines1 = (await r1.text()).trim().split("\n").map((l) => JSON.parse(l));
    const lines2 = (await r2.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lines1.some((l) => l.ready === true && l.ready_ms === 900), "the first caller hears it is ready");
    assert.equal(lines2[1].ready, true, "a caller who joins after it is up hears it at once");
  } finally { server.close(); }
});

// ── an outside agent tried on the mesh (docs/try-mode-plan.md) ─────────────

test("the key is read from AGENTMESH_CREDENTIALS_JSON, or else from the file AGENTMESH_CREDENTIALS_FILE names", () => {
  const bundle = JSON.stringify({ agent_seed: SEED, mesh_creds: CREDS });
  assert.deepEqual(credentialText({ AGENTMESH_CREDENTIALS_JSON: bundle, AGENTMESH_CREDENTIALS_FILE: "/never" }, () => { throw new Error("not read"); }), { text: bundle, from: "AGENTMESH_CREDENTIALS_JSON" });
  const read = [];
  const got = credentialText({ AGENTMESH_CREDENTIALS_FILE: "/secrets/agentmesh/credentials.json" }, (f) => { read.push(f); return bundle; });
  assert.deepEqual(read, ["/secrets/agentmesh/credentials.json"]);
  assert.equal(readBundle(got.text).seed, SEED);
  assert.throws(() => credentialText({}), /neither AGENTMESH_CREDENTIALS_JSON nor AGENTMESH_CREDENTIALS_FILE is set/);
  assert.throws(() => credentialText({ AGENTMESH_CREDENTIALS_FILE: "/gone" }, () => { const e = new Error("x"); e.code = "ENOENT"; throw e; }), /could not be read: ENOENT/);
});

test("the adapter is found where tenant.json says, overridable, and on the path by default", () => {
  assert.deepEqual(adapterPlaces(readTenantFile("{}"), {}), { bin: ADAPTER_BIN, modules: ADAPTER_MODULES });
  const t = readTenantFile(JSON.stringify({ adapter: { bin: "/opt/mesh/bin/agentmesh", modules: "/opt/mesh/lib/node_modules/mesh-adapter/node_modules" } }));
  assert.deepEqual(adapterPlaces(t, {}), { bin: "/opt/mesh/bin/agentmesh", modules: "/opt/mesh/lib/node_modules/mesh-adapter/node_modules/" });
  assert.deepEqual(adapterPlaces(t, { TENANT_ADAPTER_BIN: "/x/agentmesh", TENANT_ADAPTER_MODULES: "/x/node_modules/" }), { bin: "/x/agentmesh", modules: "/x/node_modules/" });
  assert.equal(adapterPlaces(readTenantFile(JSON.stringify({ adapter: { bin: "../agentmesh", modules: "relative/" } })), {}).bin, ADAPTER_BIN, "a path that is not absolute is not taken");
});

test("tenant.json may name the work's user, which is never root, and the work and its folders run as it", () => {
  assert.deepEqual(readTenantFile("{}").agent_user, { name: "agent", uid: 10001, gid: 10001 });
  assert.deepEqual(workUserOf({ name: "app", uid: 1000, gid: 1000 }), { name: "app", uid: 1000, gid: 1000 });
  for (const bad of [{ uid: 0, gid: 0 }, { uid: 1000, gid: 0 }, { uid: 0, gid: 1000 }, { uid: "1000", gid: 1000 }, null]) {
    assert.deepEqual(workUserOf(bad), { name: "agent", uid: 10001, gid: 10001 }, JSON.stringify(bad));
  }
  const tenant = readTenantFile(JSON.stringify({ agent_user: { name: "app", uid: 1000, gid: 1001 }, directories: ["work"], job_seconds: 1500 }));
  const row = rosterRow({ name: "design-agent", handle: "design-agent.person@example.com", key: "UKEY", tenant });
  assert.equal(row.uid, 1000);
  assert.equal(row.gid, 1001);
  assert.equal(row.job_seconds, 1500);
  const owned = [];
  const exec = localExecution({ entrypoint: "/opt/agent/entrypoint.mjs", baseEnv: {}, tenant, user: tenant.agent_user, chown: (p, uid, gid) => owned.push([uid, gid]),
    spawnImpl: () => { throw new Error("not started here"); } });
  exec({ hostDir: tmp("tenant-host-own-"), env: {} });
  assert.deepEqual(owned[0], [1000, 1001], "the job folder is handed to the work's own user");
});

test("the work's user is the image's own unless that is root, and the agent user is made when it is needed", () => {
  const passwd = "root:x:0:0:root:/root:/bin/bash\nagent:x:10001:10001::/home/agent:/bin/sh\napp:x:1000:1000::/home/app:/bin/sh\n";
  const group = "root:x:0:\nagent:x:10001:\napp:x:1000:\nstaff:x:50:\n";
  // design-agent's image runs as `agent`, uid 10001, made by its own Dockerfile.
  assert.deepEqual(resolveWorkUser("agent", passwd, group), { name: "agent", uid: 10001, gid: 10001, make: false });
  assert.deepEqual(resolveWorkUser("app:staff", passwd, group), { name: "app", uid: 1000, gid: 50, make: false });
  assert.deepEqual(resolveWorkUser("1000", passwd, group), { name: "app", uid: 1000, gid: 1000, make: false });
  assert.deepEqual(resolveWorkUser("4242:4343", passwd, group), { name: "uid-4242", uid: 4242, gid: 4343, make: false });
  assert.equal(resolveWorkUser("1000:0", passwd, group).gid, 10001, "never the root group");
  for (const root of ["", "root", "0", "0:0", "root:root"]) {
    assert.deepEqual(resolveWorkUser(root, passwd, group), { name: "agent", uid: 10001, gid: 10001, make: false }, root);
  }
  const bare = "root:x:0:0:root:/root:/bin/bash\n";
  assert.deepEqual(resolveWorkUser("", bare, "root:x:0:\n"), { name: "agent", uid: 10001, gid: 10001, make: true });
  assert.throws(() => resolveWorkUser("nobody-here", passwd, group), /has no user nobody-here/);
  assert.throws(() => resolveWorkUser("app:nogroup", passwd, group), /has no group nogroup/);
  // The adapter's user is added; the agent user only when it is made.
  assert.deepEqual(usersToAdd(passwd, group, { make: false }), { passwd: ["mesh:x:10002:10002:AgentMesh adapter:/home/mesh:/usr/sbin/nologin"], group: ["mesh:x:10002:"] });
  const made = usersToAdd(bare, "root:x:0:\n", { make: true });
  assert.equal(made.work_name, "agent");
  assert.ok(made.passwd.includes("agent:x:10001:10001:the agent's work:/home/agent:/usr/sbin/nologin"));
  assert.throws(() => usersToAdd(`${bare}other:x:10002:10002::/:/bin/sh\n`, "", { make: false }), /uid 10002 is other in this image/);
  assert.throws(() => usersToAdd(`${bare}mesh:x:999:999::/:/bin/sh\n`, "", { make: false }), /already has a user mesh with uid 999/);
});

/** An image's files as the adapter layer leaves them before it settles. */
function imageRoot({ adapter = true } = {}) {
  const root = tmp("tenant-host-settle-");
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put("etc/passwd", "root:x:0:0:root:/root:/bin/bash\nagent:x:10001:10001::/home/agent:/bin/sh\n");
  put("etc/group", "root:x:0:\nagent:x:10001:\n");
  put("opt/agent/command.json", JSON.stringify({ entrypoint: null, cmd: ["design-agent", "serve"], workdir: "/app", env: [], user: "agent" }));
  put("opt/agent/entrypoint.mjs", "export const ok = true;\n");
  put("opt/tenant/tenant.json", JSON.stringify({ descriptor: "agent-descriptor.json", directories: ["work"], job_seconds: 1500,
    adapter: { bin: "/opt/mesh/bin/agentmesh", modules: "/opt/mesh/lib/node_modules/mesh-adapter/node_modules/" } }));
  put("opt/mesh/bin/agentmesh", "#!/bin/sh\n");
  if (adapter) {
    put("opt/mesh/lib/node_modules/mesh-adapter/node_modules/nkeys.js/package.json", JSON.stringify({ name: "nkeys.js", main: "index.js" }));
    put("opt/mesh/lib/node_modules/mesh-adapter/node_modules/nkeys.js/index.js", "module.exports = {};\n");
  }
  return root;
}

test("the settle step writes the users, the folders and the work's user into tenant.json", () => {
  const root = imageRoot();
  const lines = [];
  const r = settleImage({ root, log: (l) => lines.push(l) });
  assert.deepEqual(r.work, { name: "agent", uid: 10001, gid: 10001 });
  const t = JSON.parse(readFileSync(join(root, "opt/tenant/tenant.json"), "utf8"));
  assert.deepEqual(t.agent_user, { name: "agent", uid: 10001, gid: 10001 });
  assert.equal(t.descriptor, "agent-descriptor.json", "the rest of tenant.json is kept");
  assert.match(readFileSync(join(root, "etc/passwd"), "utf8"), /\nmesh:x:10002:10002:AgentMesh adapter:\/home\/mesh:\/usr\/sbin\/nologin\n$/);
  assert.match(readFileSync(join(root, "etc/group"), "utf8"), /\nmesh:x:10002:\n$/);
  for (const d of ["home/mesh", "var/agent-state", "tmp/mesh"]) assert.ok(existsSync(join(root, d)), d);
  assert.match(lines[0], /the work runs as agent \(10001:10001\), the adapter as mesh \(10002\)/);
  // An image with no adapter where tenant.json says is refused, and the build stops.
  assert.throws(() => settleImage({ root: imageRoot({ adapter: false }), log: () => {} }), /nkeys\.js is not under/);
});

test("the work's status lines reach the adapter's job folder while it runs, as written, whole lines only", async () => {
  const root = tmp("tenant-host-relay-");
  const work = join(root, "work");
  const adapter = join(root, "adapter");
  mkdirSync(work, { recursive: true });
  mkdirSync(adapter, { recursive: true });
  const from = join(work, "updates.jsonl");
  const to = join(adapter, "updates.jsonl");
  const relay = relayUpdates(from, to, { everyMs: 60_000 });
  relay.tick();
  assert.equal(existsSync(to), false, "nothing yet");
  appendFileSync(from, `${JSON.stringify({ progress: "Starting the agent's own server" })}\n{"progress":"half`);
  relay.tick();
  assert.equal(readFileSync(to, "utf8"), `${JSON.stringify({ progress: "Starting the agent's own server" })}\n`, "the half-written line waits");
  appendFileSync(from, ` done"}\n`);
  relay.tick();
  assert.equal(readFileSync(to, "utf8"), readFileSync(from, "utf8"), "the same bytes, in order");
  // The supervisor's copy at the end writes the whole file again; from then
  // the relay writes nothing more, so the adapter sends nothing twice.
  appendFileSync(from, `{"progress":"three"}\n`);
  writeFileSync(to, readFileSync(from));
  appendFileSync(from, `{"progress":"after the copy"}\n`);
  relay.tick();
  assert.ok(!readFileSync(to, "utf8").includes("after the copy"));
  relay.stop();

  // Wired into the worker: on while the job runs, off when it finishes.
  const jobDir = join(root, "adapter-job");
  const workDir = join(root, "mesh", "jobs", "helper", "m1");
  mkdirSync(jobDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  let finish;
  const start = handBackToAdapter(() => ({ kind: "local", pid: 1, kill() {}, finished: new Promise((r) => { finish = r; }) }),
    { chown: () => {}, workDirOf: () => workDir, everyMs: 20 });
  const h = start({ name: "helper" }, { id: "m1", job: { dir: jobDir } });
  appendFileSync(join(workDir, "updates.jsonl"), `{"progress":"live"}\n`);
  for (let i = 0; i < 100 && !existsSync(join(jobDir, "updates.jsonl")); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(readFileSync(join(jobDir, "updates.jsonl"), "utf8"), `{"progress":"live"}\n`, "streamed before the job ended");
  finish({ code: 0 });
  await h.finished;
  // The same folder on both sides needs no relay.
  const same = handBackToAdapter(() => ({ finished: Promise.resolve({ code: 0 }), kill() {} }), { chown: () => {}, workDirOf: () => jobDir });
  await same({ name: "helper" }, { id: "m2", job: { dir: jobDir } }).finished;
});

test("the tenant host passes the environment's addresses to the adapter, and nothing else of its own environment", async () => {
  const { adapterAddresses } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "tenant-host.mjs")).href);
  assert.deepEqual(adapterAddresses({ MESH_GUEST_URL: "https://api.dev.example/v1/guest", PAN_REGISTRAR: "https://naming.dev.example", MESH_CONSOLE: "https://app.dev.example", AGENTMESH_CREDENTIALS_JSON: "{}", PATH: "/bin" }),
    { MESH_GUEST_URL: "https://api.dev.example/v1/guest", PAN_REGISTRAR: "https://naming.dev.example", MESH_CONSOLE: "https://app.dev.example" });
  assert.deepEqual(adapterAddresses({ PAN_REGISTRAR: "file:///etc/passwd" }), {});
});

test("the image's working folder is handed to the work, never a system folder or the layer's", async () => {
  const { workdirToHand } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "tenant-host.mjs")).href);
  assert.equal(workdirToHand("/app"), "/app");
  assert.equal(workdirToHand("/srv/agent/"), "/srv/agent");
  assert.equal(workdirToHand("/home/agent/app"), "/home/agent/app");
  assert.equal(workdirToHand("/usr/src/app"), "/usr/src/app");
  for (const w of ["/", "", null, "app", "/usr", "/usr/lib/x", "/usr/src", "/etc", "/opt", "/opt/tenant", "/opt/mesh/lib", "/home/mesh", "/tmp", "/var", "/app/../etc"]) assert.equal(workdirToHand(w), null, String(w));
});

test("the model door says in one line why a call failed, never the call's words", async () => {
  const { modelDoorWhy } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "tenant-host.mjs")).href);
  assert.equal(modelDoorWhy(JSON.stringify({ type: "error", error: { type: "relay_refused", message: "The model door is not set up on this mesh." } })), "relay_refused: The model door is not set up on this mesh.");
  assert.equal(modelDoorWhy("not json at all"), "not json at all");
});

test("what a person connected to a try is read from TRY_CONNECT, and nothing that is not it", async () => {
  const { readTryConnect, workEnv } = await import("../tenant-host.mjs");
  const proxy = "http://try:" + "a".repeat(32) + "@egress.dev.agentmesh.ai:3129";
  assert.equal(readTryConnect("{}"), null);
  assert.equal(readTryConnect("not json"), null);
  assert.equal(readTryConnect(JSON.stringify({ proxy: "http://elsewhere:80", env: { K: "v" } })), null);
  assert.deepEqual(readTryConnect(JSON.stringify({ proxy, env: { LANGSMITH_API_KEY: "k", HTTPS_PROXY: "x", AGENTMESH_X: "y", lower: "z" } })), { proxy, env: { LANGSMITH_API_KEY: "k" } });
  // TENANT_ names never reach the work, the restart stamp among them.
  assert.equal(workEnv({ TENANT_CONNECTED_AT: "1", AGENT_TRY_CONNECT: "{}" }, {}, {}).TENANT_CONNECTED_AT, undefined);
});
