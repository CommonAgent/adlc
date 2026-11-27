// An outside agent tried on the mesh (docs/try-mode-plan.md, "The adapter on
// it"): a container install whose request carries `answers` gets the adapter
// layer instead of the wake layer. What is pinned: `answers` and the draft
// descriptor are read by the spec's rules and refused in words, and only for
// a person's agent in the tenant project that wakes on message; the layer is
// the tenant host on the folder's own image, node and the adapter from the
// tenant base in a place of their own, carried into the build with no dollar
// sign in any step; the service is the tenant wake shape a person's package
// takes, its key as one variable, and the install waits for the tenant host's
// line; and retire takes all of it down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  LAYER_ADAPTER_BIN, LAYER_ADAPTER_MODULES, TENANT_READY_LINE, adapterDockerfile, buildConfig, envFor, install, platformSettings, readAnswers, readInstruction,
  readLayer, resourcesFor, restart, retire, tenantBaseImage, tenantFile, tenantSettings, tryPlacement,
} from "../service.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGE = join(HERE, "..", "..", "image");
const COMMIT = "86d8f667796890eb6d3612dbd1b9e941782fe03f";
const DIGEST = `sha256:${"c".repeat(64)}`;
const KEY = "UBBW6C2IKGSG2Q3MWCL46LLY7IA2XTGTZDQZ4GXMRUKTCDTNXJG2SGBO";
const DEPLOYER = "tenant-deployer@example-tenants.iam.gserviceaccount.com";
const WAKER = "tenant-waker@example-tenants.iam.gserviceaccount.com";
const REGISTRY = "us-east1-docker.pkg.dev/example-tenants/agents";
const TENANT = tenantSettings({
  DM_TENANT_PROJECT: "example-tenants", DM_TENANT_REGISTRY: REGISTRY, DM_TENANT_DEPLOYER: DEPLOYER,
  DM_TENANT_BUILDER: "tenant-builder@example-tenants.iam.gserviceaccount.com", DM_TENANT_WAKER: WAKER,
});
const IMAGE_DIR = "/opt/fleet/tenant-image";
const S = { tenant: TENANT, platform: platformSettings({ DM_PLATFORM_WAKER: "platform-waker@langbench-1528148150979.iam.gserviceaccount.com" }),
  wakeHostFile: "/opt/fleet/wake-host.mjs", tenantImageDir: IMAGE_DIR, buildMinutes: 1, readyMinutes: 1, meshApi: "https://api.agentmesh.ai", control: "https://app.agentmesh.ai/v1" };

// The spec's own example, for langchain-ai/design-agent.
const ANSWERS = {
  over: "http", port: 8081, health: "/health", start: null,
  env: { DESIGN_AGENT_API_PORT: "8081", DESIGN_AGENT_API_HOST: "127.0.0.1" },
  token: { env: "DESIGN_AGENT_API_TOKENS", value: "{token}:agentmesh", header: "authorization", prefix: "Bearer " },
  ask: { method: "POST", path: "/threads/{thread}/messages", body: { text: "{text}" } },
  reply: "reply",
  files: { list: "files", get: "/threads/{thread}/files/{name}" },
  working: { field: "working", poll: "/threads/{thread}/updates?after={after}", items: "updates", next: "next" },
  attach: { path: "/threads/{thread}/attachments", field: "files" },
  job_seconds: 1500,
};
const DESCRIPTOR = { format: "agent-descriptor-v1", does: "Designs pages, decks and images from a brief.", offerings: [{ id: "design", name: "Design" }] };

const args = (over = {}) => ({
  name: "design-agent-k3p9", handle: "design-agent-k3p9.someone@example.com", request_id: "dr_trytrytrytry1",
  source: { repository: "https://github.com/langchain-ai/design-agent", path: "", commit: COMMIT, dockerfile: "deploy/self-host/Dockerfile" },
  kind: "third-party-framework", boot_token: "dr-trytrytrytry", cpu: "1", memory: "2Gi", tenant: "t-0a1b2c3d4e5f",
  answers: ANSWERS, descriptor: DESCRIPTOR, ...over,
});

/** The tenant image's files as this host keeps them; the supervisor is only
 *  carried here, so a stand-in will do. */
function layerFiles() {
  const real = (f) => readFileSync(join(IMAGE, f), "utf8");
  return new Map([
    [join(IMAGE_DIR, "tenant-host.mjs"), real("tenant-host.mjs")],
    [join(IMAGE_DIR, "http-agent.mjs"), real("http-agent.mjs")],
    [join(IMAGE_DIR, "supervisor.mjs"), "// the fleet supervisor, as the host keeps it\nexport class Supervisor {}\n"],
    [join(IMAGE_DIR, "bases", "tenant-catalogue.json"), real(join("bases", "tenant-catalogue.json"))],
  ]);
}

function fakes(rows = []) {
  const calls = [];
  let inventory = rows;
  const files = new Map([["/t/dr-trytrytrytry.token", "am_single_use_token\n"], ...layerFiles()]);
  const fetched = [];
  const filters = [];
  let revision = 0;
  const gcloud = (argv) => {
    calls.push(argv);
    const j = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: "" });
    const [a, b, c] = argv;
    if (a === "builds" && b === "submit") return j({ id: "build-1" });
    if (a === "builds" && b === "describe") return j({ status: "SUCCESS", results: { images: [{ digest: DIGEST }] } });
    if (a === "iam" && c === "describe") return { code: 1, stdout: "", stderr: "NOT_FOUND" };
    if (a === "secrets" && b === "describe") return { code: 1, stdout: "", stderr: "NOT_FOUND" };
    if (a === "run" && b === "deploy") { revision++; return j({ status: { url: "https://agent-design-agent-k3p9-abc123-ue.a.run.app" } }); }
    if (a === "run" && b === "services" && c === "describe") {
      const r = `agent-design-agent-k3p9-0000${revision}`;
      return j({ status: { url: "https://agent-design-agent-k3p9-abc123-ue.a.run.app", conditions: [{ type: "Ready", status: "True" }], latestCreatedRevisionName: r, latestReadyRevisionName: r } });
    }
    if (a === "logging") { filters.push(argv[2]); return j([{ textPayload: `${TENANT_READY_LINE} design-agent-k3p9.someone@example.com: waiting to be woken` }]); }
    if (a === "run" && b === "revisions") return j({ status: { imageDigest: `x@${DIGEST}` } });
    return j({});
  };
  const fetch = async (url, init = {}) => {
    fetched.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const ok = (o) => ({ ok: true, status: 200, json: async () => o });
    if (url.endsWith("/v1/bootstrap")) return ok({ creds: "test-creds-placeholder", mesh: { endpoints: [] } });
    if (url.endsWith("/name")) return ok({ ok: true, handle: "design-agent-k3p9.someone@example.com" });
    if (url.endsWith("/retire-key")) return ok({ ok: true, unlinked: true, deregistered: true, name_released: true, credential_revoked: true });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const records = {};
  const deps = {
    gcloud, fetch, now: () => "2026-11-26T10:00:00.000Z", sleep: async () => {},
    readFile: (f) => { if (!files.has(f)) throw new Error(`no file ${f}`); return files.get(f); },
    exists: (f) => files.has(f), remove: (f) => files.delete(f),
    tmp: () => "/tmp/x", writeFile: (f, body) => files.set(f, body), rmdir: () => {},
    inventory: { load: () => inventory.map((r) => ({ ...r })), save: (r) => { inventory = r; } },
    newKey: () => ({ seed: "seed-placeholder", key: KEY }),
    signer: () => ({ by: "UDEPLOYMGR", sign: null }), bearer: () => "bearer", saveRecord: (n, act, doc) => { records[act] = doc; },
    paths: { tokens: "/t", tmp: "/home/deploymgr/tmp" }, settings: S,
  };
  return { deps, calls, files, fetched, filters, records, inventory: () => inventory };
}

const quietly = async (fn) => {
  const w = process.stdout.write;
  process.stdout.write = () => true;
  try { return await fn(); } finally { process.stdout.write = w; process.exitCode = 0; }
};

/** The files a build config carries, put back together. */
function carried(cfg) {
  const parts = {};
  for (const s of cfg.steps) {
    if (s.entrypoint !== "bash") continue;
    for (const m of s.args[1].matchAll(/^echo (\S+) >> \/workspace\/\.agentmesh-adapter\/(\S+)\.b64$/gm)) (parts[m[2]] ??= []).push(m[1]);
  }
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k.replace(/__/g, "/"), gunzipSync(Buffer.from(v.join(""), "base64")).toString("utf8")]));
}

test("answers is read by the spec's rules, and refused in words", () => {
  const a = readAnswers(ANSWERS);
  assert.deepEqual(a, ANSWERS, "the spec's own example is taken as it is");
  const min = readAnswers({ over: "http", port: 9000, health: "/healthz", ask: { path: "/ask" }, reply: "answer", job_seconds: 60 });
  assert.deepEqual([min.start, min.token, min.files, min.working, min.attach, min.ask.method], [null, null, null, null, null, "POST"]);
  assert.deepEqual(min.ask.body, { text: "{text}" });
  const bad = (over, why) => assert.throws(() => readAnswers({ ...ANSWERS, ...over }), why, JSON.stringify(over));
  bad({ over: "grpc" }, /over is "http"/);
  for (const port of [8080, 8790, 80, 70000, "8081"]) bad({ port }, /port is 1024 to 65535, and never 8080/);
  bad({ start: "design-agent serve" }, /start is null for the image's own command, or its argv/);
  bad({ start: [] }, /start is null/);
  bad({ env: Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`V${i}`, "x"])) }, /at most 60 settings/);
  for (const name of ["AGENTMESH_URL", "TENANT_X", "K_SERVICE", "PORT", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY"]) bad({ env: { [name]: "x" } }, /is not the agent's to set/);
  bad({ env: { lower: "x" } }, /not a variable name/);
  bad({ env: { LONG: "x".repeat(2001) } }, /at most 2000 characters/);
  bad({ env: { KEYISH: "sk-abcdefghijklmnopqrstuvwxyz" } }, /looks like a credential/);
  bad({ env: { WHO: "{thread}" } }, /only \{token\}/);
  bad({ token: { ...ANSWERS.token, value: "fixed" } }, /holds \{token\}/);
  bad({ token: { ...ANSWERS.token, env: "DESIGN_AGENT_API_PORT" } }, /which env sets too/);
  bad({ token: { ...ANSWERS.token, header: "bad header" } }, /token.header/);
  bad({ ask: { ...ANSWERS.ask, path: "threads/{thread}" } }, /ask.path is a path that starts with \//);
  bad({ ask: { ...ANSWERS.ask, path: "/threads/{job}/messages" } }, /holds \{job\}; a path holds only the placeholders \{thread\}, \{name\} and \{after\}/);
  bad({ ask: { ...ANSWERS.ask, path: "//evil.example/x" } }, /a path that starts with \//);
  bad({ ask: { ...ANSWERS.ask, path: "/a/../b" } }, /a path that starts with \//);
  bad({ ask: { ...ANSWERS.ask, body: { text: "{text}", thread: "{thread}" } } }, /strings hold only the placeholder \{text\}/);
  bad({ ask: { ...ANSWERS.ask, method: "DELETE" } }, /POST, PUT or PATCH/);
  bad({ reply: "reply.text" }, /reply is a field name/);
  bad({ files: { list: "files" } }, /files.get is a path/);
  bad({ working: { ...ANSWERS.working, poll: "/u?after={cursor}" } }, /holds \{cursor\}/);
  bad({ attach: { path: "/a", field: "fi les" } }, /attach.field/);
  for (const job_seconds of [59, 3001, 90.5]) bad({ job_seconds }, /60 to 3000/);
  bad({ extra: true }, /extra is not something answers says/);
});

test("answers and a descriptor are taken only for a person's agent in the tenant project that wakes on message", () => {
  const ins = readInstruction(args(), S);
  assert.deepEqual(ins.answers, ANSWERS);
  assert.deepEqual(ins.descriptor, DESCRIPTOR);
  assert.deepEqual(ins.admit, []);
  assert.equal(ins.always_on, false);
  assert.equal(resourcesFor(ins).image, `${REGISTRY}/design-agent-k3p9:${COMMIT.slice(0, 12)}-adapter`);
  const platform = { tenant: undefined, project: "langbench-1528148150979", region: "us-central1", registry: "gcr.io/langbench-1528148150979/deploymgr" };
  assert.throws(() => readInstruction(args(platform), S), /for a person's agent tried in the tenant project/);
  assert.throws(() => readInstruction(args({ ...platform, always_on: true }), S), /for a person's agent tried in the tenant project/);
  assert.throws(() => readInstruction(args({ answers: undefined }), S), /a descriptor goes in with the adapter layer/);
  assert.throws(() => readInstruction(args({ settings: { MODE: "x" } }), S), /takes its settings in answers.env/);
  assert.throws(() => readInstruction(args({ descriptor: { format: "descriptor-v0" } }), S), /agent-descriptor-v1 draft/);
  assert.throws(() => readInstruction(args({ descriptor: { ...DESCRIPTOR, does: "x".repeat(70_000) } }), S), /at most 65536 bytes/);
  assert.throws(() => readInstruction(args({ admit: ["not a handle"] }), S), /admit must be a list/);
  assert.throws(() => readInstruction(args({ answers: undefined, descriptor: undefined, admit: ["a.b@example.com"] }), S), /only an install with answers has/);
  assert.deepEqual(readInstruction(args({ admit: ["Helper.Someone@Example.com"] }), S).admit, ["helper.someone@example.com"]);
  // An install with neither is as it was.
  const plain = readInstruction(args({ answers: undefined, descriptor: undefined }), S);
  assert.equal(plain.answers, undefined);
  assert.match(resourcesFor(plain).image, /-wake$/);
});

test("the tenant base is the catalogue's adapter base, its registry this host's", () => {
  const cat = readFileSync(join(IMAGE, "bases", "tenant-catalogue.json"), "utf8");
  assert.equal(tenantBaseImage(cat, REGISTRY), `${REGISTRY}/agentmesh-base:0.99.7`);
  assert.throws(() => tenantBaseImage(cat, ""), /not an image this host can name/);
  assert.throws(() => tenantBaseImage(JSON.stringify({ bases: [{ image: "x/y:1", provides: { binaries: [] } }] }), REGISTRY), /no base that provides the mesh adapter/);
  const f = fakes();
  const layer = readLayer(readInstruction(args(), S), f.deps);
  assert.equal(layer.base, `${REGISTRY}/agentmesh-base:0.99.7`);
  assert.deepEqual(Object.keys(layer.files).sort(), ["agent/entrypoint.mjs", "tenant/supervisor.mjs", "tenant/tenant-host.mjs"]);
  f.files.delete(join(IMAGE_DIR, "http-agent.mjs"));
  assert.throws(() => readLayer(readInstruction(args(), S), f.deps), /the adapter layer's http-agent.mjs is not on this host/);
});

test("the adapter layer is the tenant host on the folder's own image, node and the adapter in a place of their own, with no dollar sign in any step", () => {
  const ins = readInstruction(args(), S);
  const image = resourcesFor(ins).image;
  assert.throws(() => buildConfig(ins, image), /adapter layer's files, and the tenant base or the try's adapter tarball, are needed/);
  const f = fakes();
  const cfg = buildConfig(ins, image, null, readLayer(ins, f.deps));
  // The folder's own Dockerfile first, at the commit, then the layer; only the layer is pushed.
  assert.deepEqual(cfg.steps[0].args.slice(-5), ["-t", "agentmesh-local/design-agent-k3p9:folder", "-f", "deploy/self-host/Dockerfile", "."]);
  const last = cfg.steps.at(-1).args;
  assert.deepEqual(last.slice(-3), ["-t", image, "/workspace/.agentmesh-adapter"]);
  assert.ok(last.includes("net.agentmesh.adapter=tenant-host"));
  assert.deepEqual(cfg.images, [image]);
  assert.equal(cfg.options.requestedVerifyOption, "VERIFIED");
  for (const s of cfg.steps) for (const a of s.args) {
    assert.ok(!a.includes("$"), "Cloud Build would read a dollar sign as a substitution");
    assert.ok(a.length <= 9500, "Cloud Build takes at most 10,000 characters in one argument");
  }
  const script = cfg.steps.at(-2).args[1];
  assert.match(script, /docker inspect --format '\{"entrypoint":\{\{json \.Config\.Entrypoint\}\},"cmd":\{\{json \.Config\.Cmd\}\},"workdir":\{\{json \.Config\.WorkingDir\}\},"env":\{\{json \.Config\.Env\}\},"user":\{\{json \.Config\.User\}\}\}' agentmesh-local\/design-agent-k3p9:folder > \/workspace\/\.agentmesh-adapter\/agent\/command\.json/);
  assert.match(script, /chmod 0755 \/workspace\/\.agentmesh-adapter\/mesh\/agentmesh/);

  const files = carried(cfg);
  assert.deepEqual(Object.keys(files).sort(), ["Dockerfile", "agent/agent-descriptor.json", "agent/answers.json", "agent/entrypoint.mjs", "mesh/agentmesh", "tenant/supervisor.mjs", "tenant/tenant-host.mjs", "tenant/tenant.json"]);
  for (const rel of Object.keys(files)) assert.match(script, new RegExp(`> /workspace/\\.agentmesh-adapter/${rel.replace(/[.]/g, "\\.")}(\\n|$)`), `${rel} is decoded`);
  assert.equal(files["agent/entrypoint.mjs"], readFileSync(join(IMAGE, "http-agent.mjs"), "utf8"), "http-agent.mjs is the work's entrypoint");
  assert.equal(files["tenant/tenant-host.mjs"], readFileSync(join(IMAGE, "tenant-host.mjs"), "utf8"));
  assert.deepEqual(JSON.parse(files["agent/answers.json"]), ANSWERS);
  assert.deepEqual(JSON.parse(files["agent/agent-descriptor.json"]), DESCRIPTOR);
  const facts = JSON.parse(files["tenant/tenant.json"]);
  assert.equal(facts.descriptor, "agent-descriptor.json");
  assert.equal(facts.job_seconds, 1500);
  assert.deepEqual(facts.directories, ["work"]);
  assert.deepEqual(facts.adapter, { bin: LAYER_ADAPTER_BIN, modules: LAYER_ADAPTER_MODULES });
  assert.match(files["mesh/agentmesh"], /^#!\/bin\/sh\n/);
  assert.match(files["mesh/agentmesh"], /LD_LIBRARY_PATH=\/opt\/mesh\/lib exec \/opt\/mesh\/node \/opt\/mesh\/lib\/node_modules\/mesh-adapter\/mesh-adapter\.mjs "\$@"/);

  const df = files.Dockerfile;
  assert.equal(df, adapterDockerfile("agentmesh-local/design-agent-k3p9:folder", `${REGISTRY}/agentmesh-base:0.99.7`));
  const lines = df.split("\n").filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(lines.slice(0, 3), [`FROM ${REGISTRY}/agentmesh-base:0.99.7 AS mesh`, "FROM agentmesh-local/design-agent-k3p9:folder", "USER root"]);
  assert.ok(lines.includes("COPY --from=mesh /usr/local/bin/node /opt/mesh/node"));
  assert.ok(lines.includes("COPY --from=mesh /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 /opt/mesh/lib/"));
  assert.ok(lines.includes("COPY --from=mesh /usr/local/lib/node_modules/mesh-adapter /opt/mesh/lib/node_modules/mesh-adapter"));
  assert.ok(lines.includes("COPY tenant/ /opt/tenant/") && lines.includes("COPY agent/ /opt/agent/"));
  assert.ok(lines.includes('RUN ["/usr/bin/env","LD_LIBRARY_PATH=/opt/mesh/lib","/opt/mesh/node","/opt/tenant/tenant-host.mjs","--settle"]'));
  assert.ok(lines.includes("ENV AGENT_DIR=/opt/agent AGENT_HOME=/opt/agent"));
  assert.equal(lines.at(-2), 'ENTRYPOINT ["/usr/bin/env","LD_LIBRARY_PATH=/opt/mesh/lib","/opt/mesh/node","/opt/tenant/tenant-host.mjs"]');
  // Nothing the agent uses is changed: no ENV of PATH or LD_LIBRARY_PATH, and no USER after root.
  assert.ok(!lines.some((l) => /^ENV .*\b(PATH|LD_LIBRARY_PATH)=/.test(l)));
  assert.equal(lines.filter((l) => l.startsWith("USER ")).length, 1);
});

test("an install with answers runs in the tenant wake shape a person's package takes, its key as one variable, and waits for the tenant host", async () => {
  const f = fakes();
  const r = await quietly(() => install(args(), f.deps));
  assert.equal(r.ok, true, r.error);
  for (const argv of f.calls) assert.ok(argv.includes(`--impersonate-service-account=${DEPLOYER}`), argv.join(" "));
  const cfg = JSON.parse(f.files.get(join("/tmp/x", "cloudbuild.json")));
  assert.ok(cfg.tags.includes("adapter"), "the adapter layer was built");
  const deploy = f.calls.find((a) => a[0] === "run" && a[1] === "deploy");
  const flag = (x) => deploy[deploy.indexOf(x) + 1];
  assert.equal(flag("--set-secrets"), "AGENTMESH_CREDENTIALS_JSON=mesh-agent-design-agent-k3p9:latest,TRY_CONNECT=mesh-agent-design-agent-k3p9-connect:latest", "the key is one variable, never a mounted file, and the try's own connect secret is another");
  assert.equal(flag("--min-instances"), "0");
  assert.equal(flag("--max-instances"), "1");
  assert.ok(deploy.includes("--cpu-throttling") && deploy.includes("--no-allow-unauthenticated"));
  assert.equal(flag("--network-tags"), "tenant-agent,t-0a1b2c3d4e5f");
  assert.match(flag("--labels"), /workload=tenant,tenant=t-0a1b2c3d4e5f,wake=platform$/);
  assert.equal(flag("--memory"), "2Gi");
  const env = JSON.parse(f.files.get(flag("--env-vars-file")));
  assert.deepEqual(env, {
    TENANT_AGENT_NAME: "design-agent-k3p9", TENANT_AGENT_HANDLE: "design-agent-k3p9.someone@example.com", TENANT_WAKER: WAKER,
    TENANT_WAKE_IDLE_SECONDS: "120", TENANT_WAKE_MAX_SECONDS: "3300",
    // The environment's addresses for the public adapter (adapterEnvOf).
    MESH_GUEST_URL: "https://api.agentmesh.ai/v1/guest",
  });
  assert.deepEqual(env, envFor(readInstruction(args(), S)));
  assert.ok(f.filters.every((x) => x.includes(`textPayload:"${TENANT_READY_LINE}"`)), "the install waits for the tenant host's asleep line");
  // Everything else as for any container install: the key, its secret, its reader, the name before start, the records, the row.
  assert.ok(f.fetched.some((x) => x.url.endsWith("/v1/bootstrap")));
  assert.ok(f.fetched.some((x) => x.url.endsWith("/deploy-requests/dr_trytrytrytry1/name")));
  assert.ok(f.calls.some((a) => a[0] === "secrets" && a[1] === "add-iam-policy-binding"));
  assert.equal(r.wake, true);
  assert.equal(r.wake_url, "https://agent-design-agent-k3p9-abc123-ue.a.run.app");
  assert.match(r.build_record.checks[0].what, /with the adapter layer on top/);
  assert.equal(r.record.target.shape.min_instances, 0);
  const row = f.inventory().find((x) => x.name === "design-agent-k3p9");
  assert.deepEqual([row.state, row.wake, row.adapter, row.ready_line, row.tenant], ["running", true, "tenant-host", TENANT_READY_LINE, "t-0a1b2c3d4e5f"]);
  assert.equal(row.images.length, 1);
});

test("retire takes an agent tried with answers down completely: service, image, secret, service account and key", async () => {
  const f = fakes();
  const r = await quietly(() => install(args(), f.deps));
  assert.equal(r.ok, true, r.error);
  f.calls.length = 0;
  const gone = await quietly(() => retire("design-agent-k3p9", "removed after a try", f.deps));
  assert.equal(gone.ok, true, JSON.stringify(gone.remaining));
  assert.deepEqual(gone.remaining, []);
  const what = gone.removed.join("; ");
  assert.match(what, /the Cloud Run service agent-design-agent-k3p9/);
  assert.match(what, new RegExp(`the image ${REGISTRY.replace(/[./]/g, "\\$&")}/design-agent-k3p9@${DIGEST}`));
  assert.match(what, /the secret mesh-agent-design-agent-k3p9/);
  assert.match(what, /the service account agent-design-agent-k3p9@example-tenants\.iam\.gserviceaccount\.com/);
  const key = f.fetched.find((x) => x.url.endsWith("/deploy-requests/retire-key"));
  assert.deepEqual(key.body, { agent_key: KEY, reason: "removed after a try" });
  for (const argv of f.calls) assert.ok(argv.includes(`--impersonate-service-account=${DEPLOYER}`), argv.join(" "));
  assert.deepEqual(f.inventory(), []);
  assert.equal(gone.record.act, "remove");
});

test("a restart of a row on the tenant host waits for the tenant host's own line", async () => {
  const f = fakes();
  await quietly(() => install(args(), f.deps));
  f.filters.length = 0;
  const r = await quietly(() => restart("design-agent-k3p9", "test", f.deps));
  assert.equal(r.ok, true, r.error);
  assert.ok(f.filters.length && f.filters.every((x) => x.includes(`textPayload:"${TENANT_READY_LINE}"`)));
});

// Try mode's build account (docs/try-mode-plan.md; debt 634): an outside
// agent's Dockerfile needs the internet, so a try is built on the shared pool
// as tenant-try-builder into the tries repository, and the adapter layer
// takes node from Node's own image and the adapter from its release tarball,
// checked by sha256, reading nothing from the tenant registry.
const TARBALL = "https://storage.googleapis.com/agentmesh-releases/mesh-adapter-0.99.7.tgz";
const SHA = "a".repeat(64);
const TRY_ENV = {
  DM_TENANT_PROJECT: "example-tenants", DM_TENANT_REGISTRY: REGISTRY, DM_TENANT_DEPLOYER: DEPLOYER,
  DM_TENANT_BUILDER: "tenant-builder@example-tenants.iam.gserviceaccount.com", DM_TENANT_WAKER: WAKER,
  DM_TENANT_WORKER_POOL: "projects/example-tenants/locations/us-east1/workerPools/tenant-builds",
  DM_TENANT_NPM_REGISTRY: "https://us-east1-npm.pkg.dev/example-tenants/npm-mirror/",
  DM_TENANT_TRY_BUILDER: "tenant-try-builder@example-tenants.iam.gserviceaccount.com",
  DM_TENANT_TRY_REGISTRY: "us-east1-docker.pkg.dev/example-tenants/tries",
  DM_TENANT_TRY_ADAPTER_TARBALL: TARBALL, DM_TENANT_TRY_ADAPTER_DIGEST: SHA,
};

test("a try is built on the shared pool as the try builder, into the tries repository", () => {
  const T = { ...S, tenant: tenantSettings(TRY_ENV) };
  const ins = readInstruction(args({ registry: "us-east1-docker.pkg.dev/example-tenants/agents" }), T);
  assert.equal(ins.builder, "tenant-try-builder@example-tenants.iam.gserviceaccount.com");
  assert.equal(ins.worker_pool, null);
  assert.equal(ins.registry, "us-east1-docker.pkg.dev/example-tenants/tries");
  assert.deepEqual(ins.try_adapter, { node: "node:22-bookworm-slim", url: TARBALL, sha256: SHA });
  assert.equal(resourcesFor(ins).image, `us-east1-docker.pkg.dev/example-tenants/tries/design-agent-k3p9:${COMMIT.slice(0, 12)}-adapter`);
  // An install with no answers stays on the pool, as the tenant builder.
  const plain = readInstruction(args({ answers: undefined, descriptor: undefined }), T);
  assert.equal(plain.builder, "tenant-builder@example-tenants.iam.gserviceaccount.com");
  assert.ok(plain.worker_pool);
  // Half set is refused in words.
  assert.throws(() => readInstruction(args(), { ...S, tenant: tenantSettings({ ...TRY_ENV, DM_TENANT_TRY_ADAPTER_DIGEST: "" }) }), /DM_TENANT_TRY_ADAPTER_DIGEST/);
  assert.throws(() => readInstruction(args(), { ...S, tenant: tenantSettings({ ...TRY_ENV, DM_TENANT_TRY_ADAPTER_TARBALL: "https://evil.example/a.tgz" }) }), /public release bucket/);
});

test("a try's layer takes node and the adapter from public sources, checked by sha256, and reads no tenant image", () => {
  const T = { ...S, tenant: tenantSettings(TRY_ENV) };
  const ins = readInstruction(args(), T);
  const reads = [];
  const layer = readLayer(ins, { settings: T, readFile: (p) => { reads.push(p); return layerFiles()[Object.keys(layerFiles()).find((k) => p.endsWith(k.split("/").pop())) ?? ""] ?? "x"; } });
  assert.deepEqual(layer.base, ins.try_adapter);
  assert.ok(!reads.some((p) => p.includes("tenant-catalogue")), "the tenant catalogue is not read for a try");
  const docker = adapterDockerfile("agentmesh-local/x:folder", layer.base);
  assert.match(docker, /^FROM node:22-bookworm-slim AS mesh$/m);
  assert.ok(docker.includes(`${SHA}  /tmp/adapter.tgz" | sha256sum -c -`));
  assert.ok(docker.includes(TARBALL));
  assert.ok(!docker.includes(REGISTRY), "nothing from the tenant registry");
  const cfg = buildConfig(ins, resourcesFor(ins).image, null, layer);
  const all = JSON.stringify(cfg.steps);
  assert.ok(!all.includes("$"), "no dollar sign in any step");
  assert.equal(cfg.images[0], resourcesFor(ins).image);
});

test("every try setting reaches the deployment manager through the host's tenant file", () => {
  const dir = mkdtempSync(join(tmpdir(), "dm-tenant-"));
  try {
    const f = join(dir, "deploymgr-tenant.json");
    writeFileSync(f, JSON.stringify(TRY_ENV));
    const placed = tryPlacement(tenantSettings(tenantFile(f)));
    assert.deepEqual(placed?.try_adapter, { node: "node:22-bookworm-slim", url: TARBALL, sha256: SHA });
    assert.equal(placed?.builder, TRY_ENV.DM_TENANT_TRY_BUILDER);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a try's adapter is told this environment's addresses, which the tenant host passes on", () => {
  const T = { ...S, naming: "https://naming.dev.example", app: "https://app.dev.example", meshApi: "https://api.dev.example" };
  const ins = readInstruction(args(), T);
  assert.deepEqual(ins.adapter_env, { MESH_GUEST_URL: "https://api.dev.example/v1/guest", PAN_REGISTRAR: "https://naming.dev.example", MESH_CONSOLE: "https://app.dev.example" });
  const env = envFor(ins);
  assert.equal(env.PAN_REGISTRAR, "https://naming.dev.example");
  assert.equal(env.MESH_GUEST_URL, "https://api.dev.example/v1/guest");
  assert.equal(readInstruction(args({ answers: undefined, descriptor: undefined }), T).adapter_env, undefined);
});
