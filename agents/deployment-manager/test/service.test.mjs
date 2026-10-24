// The deployment manager's container path (service.mjs), with gcloud, the
// platform and the key maker stood in. What is pinned: an instruction is
// refused before anything exists; the build is the folder's own Dockerfile in
// Cloud Build with provenance asked for; the service wakes on message by
// default (the wake host on top, min 0, CPU only in a request, callable by the
// platform's waker alone), and an agent the owner keeps always on is always
// on, internal, pinned by digest and runs as its own account; the seed never reaches a
// command line or the disk; the name is bound only after the service is
// ready; an update keeps the key; a failure says what it left; retire takes
// everything down and retires the key; and there is one gcloud door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactRef, buildConfig, restart, canonical, install, keepOn, readInstruction, resourcesFor, retire, serviceDeployArgv, signRecord, sleepInPlace,
  wakeDockerfile, platformSettings, wakerRoleOf, MOUNT, WAKE_ASLEEP_LINE, WAKE_ENTRYPOINT,
} from "../service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMIT = "48a431e0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6";
const COMMIT2 = "59b542f1d2c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7";
const DIGEST = `sha256:${"a".repeat(64)}`;
const NEWKEY = "UBBW6C2IKGSG2Q3MWCL46LLY7IA2XTGTZDQZ4GXMRUKTCDTNXJG2SGBO";
const OLDKEY = "UDSMFIHUD4MZPNYKJ5AEYNQ4WKZ3WCFDPDKIGBNFEGFXC7BVA7QEZVTN";
const SEED = "test-agent-seed-placeholder-not-a-key";
const URL = "https://agent-crewai-demo-t6vcq4c4cq-ue.a.run.app";

const args = (over = {}) => ({
  name: "crewai-demo", handle: "crewai.demo@agentmesh.ai", request_id: "dr_abcdefghijkl",
  source: { repository: "https://github.com/AgentMesh-Community/reference-agents", path: "frameworks/crewai", commit: COMMIT, dockerfile: "Dockerfile" },
  kind: "third-party-framework", settings: { RING_HANDLE: "crewai.demo@agentmesh.ai", AGENTMESH_SERVERS: "wss://mesh.agentmesh.ai" },
  secrets: {}, boot_token: "dr-abcdefghijkl", project: "langbench-1528148150979", region: "us-east1",
  registry: "gcr.io/langbench-1528148150979/deploymgr", cpu: "1", memory: "1Gi", claims: ["ring-member"],
  replaces: OLDKEY, ready_line: "ring member ready", always_on: true, ...over,
});
const WAKER = "platform-waker@langbench-1528148150979.iam.gserviceaccount.com";
const PLATFORM = platformSettings({ DM_PLATFORM_WAKER: WAKER });
const WAKE_HOST = readFileSync(join(HERE, "..", "..", "image", "wake-host.mjs"), "utf8");
/** The default: no always_on, so it wakes on message. */
const wakeArgs = (over = {}) => { const a = args(over); if (!("always_on" in over)) delete a.always_on; return a; };

function fakes({ failAt = null, rows = [] } = {}) {
  const calls = [];
  const fetches = [];
  const seq = [];
  let inventory = rows;
  const records = {};
  const files = new Map([["/home/deploymgr/secrets/boot-tokens/dr-abcdefghijkl.token", "am_single_use_token\n"], ["/opt/fleet/wake-host.mjs", WAKE_HOST]]);
  let revision = 0;
  const gcloud = (argv, opts = {}) => {
    calls.push({ argv, input: opts.input });
    seq.push(argv.slice(0, 2).join(" "));
    const j = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: "" });
    const [a, b, c] = argv;
    if (failAt && argv.join(" ").includes(failAt)) return { code: 1, stdout: "", stderr: `refused: ${failAt}` };
    if (a === "builds" && b === "submit") return j({ id: "build-123" });
    if (a === "builds" && b === "describe") return j({ status: "SUCCESS", results: { images: [{ digest: DIGEST }] }, logUrl: "https://console/b" });
    if (a === "artifacts" && c === "images" && argv[3] === "describe") return j({ provenance_summary: { provenance: [{ envelope: { payloadType: "application/vnd.in-toto+json" } }] } });
    if (a === "iam" && b === "service-accounts" && c === "describe") return { code: 1, stdout: "", stderr: "NOT_FOUND" };
    if (a === "secrets" && b === "describe") return { code: 1, stdout: "", stderr: "NOT_FOUND" };
    if (a === "run" && b === "deploy") { revision++; return j({ status: { url: URL } }); }
    if (a === "run" && b === "services" && c === "update") { revision++; return j({ status: { url: URL } }); }
    if (a === "run" && b === "services" && c === "describe") {
      const r = `agent-crewai-demo-0000${revision}`;
      return j({ status: { url: URL, conditions: [{ type: "Ready", status: "True" }], latestCreatedRevisionName: r, latestReadyRevisionName: r } });
    }
    if (a === "run" && b === "revisions") return j({ status: { imageDigest: `gcr.io/langbench-1528148150979/deploymgr/crewai-demo@${DIGEST}` } });
    if (a === "logging") return j([{ textPayload: argv[2].includes(WAKE_ASLEEP_LINE) ? `${WAKE_ASLEEP_LINE}: waiting to be woken by ${WAKER}` : "ring member ready: crewai.demo@agentmesh.ai" }]);
    return j({});
  };
  const fetch = async (url, init) => {
    fetches.push({ url, body: JSON.parse(init.body) });
    seq.push(url);
    const ok = (o) => ({ ok: true, status: 200, json: async () => o });
    if (url.endsWith("/v1/bootstrap")) return ok({ creds: "test-creds-placeholder", mesh: { endpoints: ["wss://mesh.agentmesh.ai"] }, account_email: "platform@agentmesh.ai" });
    if (url.endsWith("/name")) return ok({ ok: true, handle: "crewai.demo@agentmesh.ai", category: "mesh-demo" });
    if (url.endsWith("/retire-key")) return ok({ ok: true, via: "install", unlinked: true, deregistered: true, name_released: true, credential_revoked: true });
    if (url.endsWith("/deploy-requests/wake")) return ok({ ok: true, requests: 1 });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const deps = {
    gcloud, fetch, now: () => "2026-09-27T23:00:00.000Z", sleep: async () => {},
    readFile: (f) => files.get(f), exists: (f) => files.has(f), remove: (f) => files.delete(f),
    tmp: () => "/tmp/dm-service-x", writeFile: (f, body) => files.set(f, body), rmdir: () => {},
    inventory: { load: () => inventory.map((r) => ({ ...r })), save: (r) => { inventory = r; } },
    newKey: () => ({ seed: SEED, key: NEWKEY }),
    signer: () => ({ by: "UDEPLOYMGR", sign: (m) => `sig(${m.length})` }),
    bearer: () => "bearer",
    saveRecord: (name, act, doc) => { records[`${name}-${act}`] = doc; },
    paths: { tokens: "/home/deploymgr/secrets/boot-tokens", tmp: "/home/deploymgr/tmp" },
    settings: { buildMinutes: 1, readyMinutes: 1, meshApi: "https://api.agentmesh.ai", control: "https://app.agentmesh.ai/v1", platform: PLATFORM, wakeHostFile: "/opt/fleet/wake-host.mjs" },
  };
  return { deps, calls, fetches, seq, files, records, inventory: () => inventory };
}

// Silence the procedure's one line of JSON on stdout.
const quietly = async (fn) => {
  const w = process.stdout.write;
  process.stdout.write = () => true;
  try { return await fn(); } finally { process.stdout.write = w; process.exitCode = 0; }
};

test("an instruction is refused in words before anything exists", () => {
  assert.throws(() => readInstruction(args({ name: "Crew AI" })), /bad name/);
  assert.throws(() => readInstruction(args({ source: { ...args().source, commit: "main" } })), /40-character commit/);
  assert.throws(() => readInstruction(args({ settings: { RING_HANDLE: "am_leaked_token_value" } })), /looks like a credential/);
  assert.throws(() => readInstruction(args({ secrets: { ANTHROPIC_API_KEY: "sk-ant-123" } })), /never its value/);
  assert.throws(() => readInstruction(args({ settings: { AGENTMESH_CREDENTIALS_FILE: "/x" } })), /deployment manager's to set/);
  assert.throws(() => readInstruction(args({ cloud: { project: "theirs" } })), /customer's own project is not built/);
  assert.equal(readInstruction(args()).source.path, "frameworks/crewai");
});

test("the build is the folder's own Dockerfile in Cloud Build, with provenance asked for", () => {
  const ins = readInstruction(args());
  const res = resourcesFor(ins);
  assert.equal(res.image, `gcr.io/langbench-1528148150979/deploymgr/crewai-demo:${COMMIT.slice(0, 12)}`);
  const cfg = buildConfig(ins, res.image);
  assert.deepEqual(cfg.images, [res.image]);
  assert.equal(cfg.options.requestedVerifyOption, "VERIFIED");
  assert.equal(cfg.steps.length, 1);
  assert.deepEqual(cfg.steps[0].args.slice(-4), [res.image, "-f", "Dockerfile", "."]);
});

test("an agent the owner keeps always on is always on, internal, pinned by digest, and runs as its own account", () => {
  const ins = readInstruction(args());
  const res = resourcesFor(ins);
  const argv = serviceDeployArgv(ins, res, `x@${DIGEST}`, "/tmp/env.json");
  const flag = (f) => argv[argv.indexOf(f) + 1];
  assert.equal(flag("--image"), `x@${DIGEST}`);
  assert.equal(flag("--min-instances"), "1");
  assert.equal(flag("--max-instances"), "1");
  assert.ok(argv.includes("--no-cpu-throttling"));
  assert.equal(flag("--ingress"), "internal");
  assert.ok(argv.includes("--no-allow-unauthenticated"));
  assert.equal(flag("--service-account"), "agent-crewai-demo@langbench-1528148150979.iam.gserviceaccount.com");
  assert.equal(flag("--set-secrets"), `${MOUNT}=mesh-agent-crewai-demo:latest`);
});

test("a new install: built, keyed into its secret without the seed touching a command line or the disk, ready, then named, and signed", async () => {
  const f = fakes();
  const r = await quietly(() => install(args(), f.deps));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.act, "deploy");
  assert.equal(r.agent_key, NEWKEY);
  assert.equal(r.handle, "crewai.demo@agentmesh.ai");
  assert.equal(r.image_digest, DIGEST, "the digest the service runs, which is the one built");
  // The seed went in on stdin to exactly one call, and appears in no argv and no file.
  const withSeed = f.calls.filter((c) => (c.input ?? "").includes(SEED));
  assert.equal(withSeed.length, 1);
  assert.deepEqual(withSeed[0].argv.slice(0, 4), ["secrets", "versions", "add", "mesh-agent-crewai-demo"]);
  assert.ok(!f.calls.some((c) => c.argv.join(" ").includes(SEED)));
  assert.ok(![...f.files.values()].some((v) => String(v).includes(SEED)));
  // The single-use agent key was burned.
  assert.ok(!f.files.has("/home/deploymgr/secrets/boot-tokens/dr-abcdefghijkl.token"));
  // The name was asked for only after the service was ready.
  const at = (p) => f.seq.findIndex((x) => p(x));
  assert.ok(at((x) => x === "logging read") > at((x) => x === "run deploy"), "the ready line was watched after the deploy");
  assert.ok(at((x) => x.endsWith("/name")) < at((x) => x === "run deploy"), "named before the service starts, because the registry refuses an unnamed agent");
  assert.ok(at((x) => x.endsWith("/name")) > at((x) => x === "secrets add-iam-policy-binding"), "named once its key and secret exist");
  // Only the agent's account reads its secret, at the secret.
  const bind = f.calls.find((c) => c.argv.slice(0, 2).join(" ") === "secrets add-iam-policy-binding");
  assert.ok(bind.argv.includes("serviceAccount:agent-crewai-demo@langbench-1528148150979.iam.gserviceaccount.com"));
  // Two signed records: the build (commit, build id, digest, provenance) and the deployment.
  assert.equal(r.build_record.act, "build");
  assert.equal(r.build_record.source.commit, COMMIT);
  assert.equal(r.build_record.cloud_build.id, "build-123");
  assert.equal(r.build_record.provenance.attached, true);
  assert.equal(r.record.act, "deploy");
  assert.equal(r.record.target.kind, "cloud-run-service");
  assert.equal(r.record.key_custody.minted, "generated");
  // A platform container agent has no VPC setting, so nothing of ours limits
  // what it reaches, and the record says so (Common Agent 8.3 egress).
  assert.deepEqual(r.record.egress, { policy: "open", enforced_by: "none" });
  assert.equal(r.record.signatures[0].tag, "agent-deployment-record-v1");
  assert.equal(r.record.checks[0].kind, "smoke");
  assert.equal(f.inventory()[0].state, "running");
});

test("a new commit is an update: the same key and secret, no new key, the previous revision named", async () => {
  const first = fakes();
  await quietly(() => install(args(), first.deps));
  const f = fakes({ rows: first.inventory() });
  const r = await quietly(() => install(args({ source: { ...args().source, commit: COMMIT2 }, boot_token: null }), f.deps));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.act, "update");
  assert.equal(r.agent_key, NEWKEY);
  assert.ok(!f.fetches.some((x) => x.url.endsWith("/v1/bootstrap")), "no new key");
  assert.ok(!f.calls.some((c) => c.argv[0] === "secrets" && c.argv[1] === "versions"), "the bundle is untouched");
  assert.equal(r.record.previous.commit, COMMIT);
  assert.equal(f.inventory()[0].source.commit, COMMIT2);
});

test("an update lands where the install stands, whatever the host now places new installs in", async () => {
  const first = fakes();
  await quietly(() => install(args(), first.deps));
  const f = fakes({ rows: first.inventory() });
  const r = await quietly(() => install(args({ source: { ...args().source, commit: COMMIT2 }, boot_token: null, region: "us-south1" }), f.deps));
  assert.equal(r.ok, true, r.error);
  const regions = f.calls.filter((c) => c.argv[0] === "run").map((c) => c.argv[c.argv.indexOf("--region") + 1]);
  assert.ok(regions.length && regions.every((x) => x === "us-east1"), `every Cloud Run call in us-east1: ${regions.join(", ")}`);
  assert.equal(f.inventory()[0].region, "us-east1");
});

test("a new service account unknown to IAM for a moment is asked about again", async () => {
  const f = fakes();
  let refusals = 0;
  const real = f.deps.gcloud;
  f.deps.gcloud = (argv, opts) => (argv[1] === "add-iam-policy-binding" && refusals++ < 2 ? { code: 1, stdout: "", stderr: "Service account agent-crewai-demo@x does not exist." } : real(argv, opts));
  const r = await quietly(() => install(args(), f.deps));
  assert.equal(r.ok, true, r.error);
  assert.equal(refusals, 3);
});

test("a failure after the key was made says what it left and how to clean it", async () => {
  const f = fakes({ failAt: "run deploy" });
  const r = await quietly(() => install(args(), f.deps));
  assert.equal(r.ok, false);
  assert.equal(r.step, "service");
  assert.match(r.state, /run retire crewai-demo to clean/);
  assert.equal(r.record.act, "refuse");
  assert.equal(f.inventory()[0].state, "failed at service");
});

test("retire takes the service, the images, the secret and the account down, then retires the key", async () => {
  const first = fakes();
  await quietly(() => install(args(), first.deps));
  const f = fakes({ rows: first.inventory() });
  const r = await quietly(() => retire("crewai-demo", "switched off", f.deps));
  assert.equal(r.ok, true, JSON.stringify(r.remaining));
  const verbs = f.calls.map((c) => c.argv.slice(0, 3).join(" "));
  assert.ok(verbs.includes("run services delete"));
  assert.ok(verbs.includes("artifacts docker images"));
  assert.ok(verbs.includes("secrets delete mesh-agent-crewai-demo"));
  assert.ok(verbs.some((v) => v.startsWith("iam service-accounts delete")));
  assert.equal(f.fetches.find((x) => x.url.endsWith("/retire-key")).body.agent_key, NEWKEY);
  assert.equal(r.record.act, "remove");
  assert.deepEqual(f.inventory(), []);
});

test("records are signed over sorted canonical JSON, and gcloud has one door", () => {
  assert.equal(canonical({ b: 1, a: [2, { d: "x", c: null }] }), '{"a":[2,{"c":null,"d":"x"}],"b":1}');
  const s = signRecord({ act: "deploy", signatures: [] }, "agent-deployment-record-v1", (m) => m, "UBY");
  assert.equal(s.signatures[0].sig, 'agent-deployment-record-v1\n{"act":"deploy","by":"UBY"}');
  const src = readFileSync(join(HERE, "..", "service.mjs"), "utf8");
  assert.equal((src.match(/spawnSync\(/g) ?? []).length, 1, "one place starts a process");
  assert.match(src, /const p = spawnSync\(bin, argv/);
});

test("the name is asked for again while the platform restarts, and bound when it answers", async () => {
  const f = fakes();
  let answers = 0;
  const real = f.deps.fetch;
  f.deps.fetch = async (url, init) => {
    if (url.endsWith("/name") && answers++ < 2) return { ok: false, status: 502, json: async () => ({}) };
    return real(url, init);
  };
  const r = await quietly(() => install(args(), f.deps));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.handle, "crewai.demo@agentmesh.ai");
  assert.equal(answers, 3);
});

test("a gcr.io image is named the way Artifact Registry's commands take it", () => {
  assert.equal(artifactRef(`gcr.io/langbench-1528148150979/deploymgr/crewai-demo@${DIGEST}`), `us-docker.pkg.dev/langbench-1528148150979/gcr.io/deploymgr/crewai-demo@${DIGEST}`);
  assert.equal(artifactRef("us-central1-docker.pkg.dev/p/r/x:1"), "us-central1-docker.pkg.dev/p/r/x:1");
});

test("restart starts the installed service again on the same image, waits for it, and records it", async () => {
  const first = fakes();
  await quietly(() => install(args(), first.deps));
  const f = fakes({ rows: first.inventory() });
  const r = await quietly(() => restart("crewai-demo", "named after it first started", f.deps));
  assert.equal(r.ok, true, r.error);
  assert.ok(f.calls.some((c) => c.argv.slice(0, 3).join(" ") === "run services update"));
  assert.ok(!f.calls.some((c) => c.argv[0] === "builds"), "nothing is built");
  assert.equal(r.record.act, "restart");
});

// ── wake on message, the default ──────────────────────────────────────────

test("a container agent wakes on message unless its owner keeps it on, and is refused when nobody could wake it", () => {
  const s = { platform: PLATFORM };
  const ins = readInstruction(wakeArgs(), s);
  assert.equal(ins.always_on, false);
  assert.equal(ins.waker, WAKER);
  assert.equal(ins.wake_idle_seconds, 120);
  assert.equal(readInstruction(wakeArgs({ wake_idle_seconds: 360 }), s).wake_idle_seconds, 360);
  assert.throws(() => readInstruction(wakeArgs({ wake_idle_seconds: 5 }), s), /30 to 900/);
  assert.throws(() => readInstruction(wakeArgs(), { platform: platformSettings({}) }), /names no platform waker/);
  assert.equal(readInstruction(args(), { platform: platformSettings({}) }).always_on, true, "kept on needs no waker");
  assert.equal(resourcesFor(ins).image, `gcr.io/langbench-1528148150979/deploymgr/crewai-demo:${COMMIT.slice(0, 12)}-wake`);
});

test("the platform's own container agents go to the project kept for them, and the waker's role follows the project", () => {
  const own = { platform: platformSettings({ DM_PLATFORM_WAKER: WAKER, DM_PLATFORM_WAKER_ROLE: "projects/langbench-1528148150979/roles/platformWaker",
    DM_PLATFORM_PROJECT: "example-agents-dev", DM_PLATFORM_REGION: "us-central1", DM_PLATFORM_REGISTRY: "us-central1-docker.pkg.dev/example-agents-dev/agents" }) };
  const ins = readInstruction(wakeArgs(), own);
  assert.equal(ins.project, "example-agents-dev", "the placement the host handed for jobs gives way");
  assert.equal(ins.region, "us-central1");
  assert.equal(ins.registry, "us-central1-docker.pkg.dev/example-agents-dev/agents");
  assert.equal(resourcesFor(ins).service_account, "agent-crewai-demo@example-agents-dev.iam.gserviceaccount.com");
  assert.equal(wakerRoleOf(ins, own), "projects/example-agents-dev/roles/platformWaker", "a role named for another project is not bound here");
  // Unset, nothing moves: the host's placement stands.
  const before = readInstruction(wakeArgs(), { platform: PLATFORM });
  assert.equal(before.project, "langbench-1528148150979");
  assert.equal(wakerRoleOf(before, { platform: platformSettings({ DM_PLATFORM_WAKER: WAKER, DM_PLATFORM_WAKER_ROLE: "projects/langbench-1528148150979/roles/platformWaker" }) }), "projects/langbench-1528148150979/roles/platformWaker");
});

test("the wake build is the folder's own image, read for its command, with the wake host on top; only that is pushed", () => {
  const ins = readInstruction(wakeArgs(), { platform: PLATFORM });
  const res = resourcesFor(ins);
  assert.throws(() => buildConfig(ins, res.image), /wake host's source/);
  const cfg = buildConfig(ins, res.image, WAKE_HOST);
  assert.deepEqual(cfg.images, [res.image]);
  assert.ok(cfg.steps.length >= 4);
  assert.deepEqual(cfg.steps[0].args.slice(-4), ["agentmesh-local/crewai-demo:folder", "-f", "Dockerfile", "."], "the folder's own Dockerfile, as before");
  for (const s of cfg.steps) for (const a of s.args) assert.ok(a.length <= 10_000, "Cloud Build takes at most 10,000 characters an argument");
  const carry = cfg.steps.slice(1, -2).map((s) => /echo (\S+) >>? \/workspace\/\.agentmesh-wake\/wake-host\.b64/.exec(s.args[1])[1]).join("");
  assert.equal(gunzipSync(Buffer.from(carry, "base64")).toString("utf8"), WAKE_HOST, "the wake host goes in whole");
  const script = cfg.steps.at(-2).args[1];
  assert.ok(!cfg.steps.some((s) => s.args.join(" ").includes("$")), "no Cloud Build substitution in any step");
  assert.match(script, /docker inspect --format '\{"entrypoint":\{\{json \.Config\.Entrypoint\}\},"cmd":\{\{json \.Config\.Cmd\}\}/);
  assert.equal(cfg.steps.at(-1).args.at(-1), "/workspace/.agentmesh-wake");
  const df = wakeDockerfile("agentmesh-local/crewai-demo:folder");
  assert.match(df, /^FROM node:22-bookworm-slim AS wakenode\nFROM agentmesh-local\/crewai-demo:folder\n/);
  assert.match(df, /RUN \["\/usr\/bin\/env","LD_LIBRARY_PATH=\/opt\/wake\/lib","\/opt\/wake\/node","--check","\/opt\/wake\/wake-host\.mjs"\]/, "the build stops if node cannot run on the agent's image");
  assert.ok(df.includes(`ENTRYPOINT ${JSON.stringify(WAKE_ENTRYPOINT)}\nCMD []`));
  // Kept on: the folder's image alone, as before.
  assert.equal(buildConfig(readInstruction(args(), {}), "x:1").steps.length, 1);
});

test("the wake shape: no instance while asleep, CPU only in a request, an hour's request, the waker's settings, labelled", () => {
  const ins = readInstruction(wakeArgs(), { platform: PLATFORM });
  const argv = serviceDeployArgv(ins, resourcesFor(ins), `x@${DIGEST}`, "/tmp/env.json");
  const flag = (f) => argv[argv.indexOf(f) + 1];
  assert.equal(flag("--min-instances"), "0");
  assert.equal(flag("--max-instances"), "1");
  assert.ok(argv.includes("--cpu-throttling") && !argv.includes("--no-cpu-throttling"));
  assert.equal(flag("--timeout"), "3600");
  assert.equal(flag("--ingress"), "all");
  assert.ok(argv.includes("--no-allow-unauthenticated"), "nobody unsigned gets in");
  assert.match(flag("--labels"), /,wake=platform$/);
});

test("a new install that wakes on message: the waker may call it, it is left asleep, and the platform is told its address", async () => {
  const f = fakes();
  const r = await quietly(() => install(wakeArgs(), f.deps));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.wake, true);
  assert.equal(r.wake_url, URL);
  const bind = f.calls.find((c) => c.argv.slice(0, 3).join(" ") === "run services add-iam-policy-binding");
  assert.ok(bind, "the waker is bound on this service");
  assert.equal(bind.argv[bind.argv.indexOf("--member") + 1], `serviceAccount:${WAKER}`);
  assert.equal(bind.argv[bind.argv.indexOf("--role") + 1], "projects/langbench-1528148150979/roles/platformWaker");
  const env = JSON.parse([...f.files].find(([k]) => /env\.json$/.test(k))?.[1] ?? "{}");
  assert.equal(env.WAKE_BY, WAKER);
  assert.equal(env.WAKE_READY_LINE, "ring member ready");
  assert.equal(env.RING_HANDLE, "crewai.demo@agentmesh.ai", "the agent's own settings are kept");
  const log = f.calls.find((c) => c.argv[0] === "logging");
  assert.ok(log.argv[2].includes(WAKE_ASLEEP_LINE), "it waits for the wake host, not the agent");
  assert.equal(r.record.target.shape.min_instances, 0);
  assert.equal(r.record.target.shape.wake.by, WAKER);
  const row = f.inventory()[0];
  assert.equal(row.wake, true);
  assert.equal(row.wake_url, URL);
});

test("an always-on install is put to sleep in place: same service, key and secret, the platform told", async () => {
  const first = fakes();
  await quietly(() => install(args({ ready_line: undefined }), first.deps));
  const f = fakes({ rows: first.inventory() });
  const r = await quietly(() => sleepInPlace("crewai-demo", { ready_line: "ring member ready", wake_idle_seconds: 60 }, f.deps));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.agent_key, NEWKEY);
  assert.ok(!f.fetches.some((x) => x.url.endsWith("/v1/bootstrap")), "no new key");
  assert.ok(!f.calls.some((c) => c.argv[0] === "secrets"), "the secret is untouched");
  assert.ok(!f.calls.some((c) => c.argv[1] === "deploy"), "the service is updated, not deployed again");
  const up = f.calls.find((c) => c.argv.slice(0, 3).join(" ") === "run services update").argv;
  assert.equal(up[up.indexOf("--min-instances") + 1], "0");
  assert.equal(up[up.indexOf("--update-env-vars") + 1], `^|^WAKE_BY=${WAKER}|WAKE_IDLE_SECONDS=60|WAKE_MAX_SECONDS=3300|WAKE_READY_LINE=ring member ready`);
  const verbs = f.calls.map((c) => c.argv.slice(0, 3).join(" "));
  assert.ok(verbs.indexOf("run services add-iam-policy-binding") < verbs.indexOf("run services update"), "the waker is bound before the agent is put to sleep");
  // Bound already (by the owner): read, not bound again.
  const pre = fakes({ rows: first.inventory() });
  const real = pre.deps.gcloud;
  pre.deps.gcloud = (argv, o) => (argv[2] === "get-iam-policy" ? { code: 0, stdout: JSON.stringify({ bindings: [{ role: "projects/langbench-1528148150979/roles/platformWaker", members: [`serviceAccount:${WAKER}`] }] }), stderr: "" } : real(argv, o));
  const r2 = await quietly(() => sleepInPlace("crewai-demo", {}, pre.deps));
  assert.equal(r2.ok, true, r2.error);
  assert.ok(!pre.calls.some((c) => c.argv[2] === "add-iam-policy-binding"));
  // Refused the bind: the agent is not put to sleep, and the owner is told the one command.
  const denied = fakes({ rows: first.inventory(), failAt: "add-iam-policy-binding agent-crewai-demo" });
  const r3 = await quietly(() => sleepInPlace("crewai-demo", {}, denied.deps));
  assert.equal(r3.ok, false);
  assert.match(r3.error, /The owner binds it once/);
  assert.ok(!denied.calls.some((c) => c.argv[2] === "update"));
  const told = f.fetches.find((x) => x.url.endsWith("/deploy-requests/wake"));
  assert.deepEqual(told.body, { agent_key: NEWKEY, wake_url: URL });
  const row = f.inventory()[0];
  assert.equal(row.wake, true);
  assert.equal(row.always_on_image, first.inventory()[0].image, "the image it ran before is kept, for the way back");
  assert.equal(r.record.act, "sleep");
  // Again is refused; keep-on goes back, platform first.
  const again = await quietly(() => sleepInPlace("crewai-demo", {}, fakes({ rows: f.inventory() }).deps));
  assert.match(again.error, /already wakes on message/);
  const g = fakes({ rows: f.inventory() });
  const back = await quietly(() => keepOn("crewai-demo", "must stay on", g.deps));
  assert.equal(back.ok, true, back.error);
  assert.equal(g.fetches[0].body.wake_url, null);
  const up2 = g.calls.find((c) => c.argv.slice(0, 3).join(" ") === "run services update").argv;
  assert.equal(up2[up2.indexOf("--image") + 1], row.always_on_image);
  assert.equal(up2[up2.indexOf("--min-instances") + 1], "1");
  assert.equal(g.inventory()[0].wake, false);
});
