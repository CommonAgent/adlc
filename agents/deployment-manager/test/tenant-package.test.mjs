// A person's own package in the tenant project (docs/tenant-isolation-plan.md,
// "A person's own agent in the tenant project"; technical debt 95). What is
// pinned: install-package places a package only when it names a tenant, and
// only in the tenant project, every gcloud call as the tenant deployer; the
// package's digest is checked before it is read; the image is the package's
// own one-message image on the tenant catalogue's base with the tenant host on
// top; the service is the container agent's shape on tenant-vpc, with the key
// as one environment variable; a package that asks for a credential or leaves
// its work to a harness is refused before anything exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  TENANT_IMAGE_FILES, TENANT_READY_LINE, installPackage, packageServiceDeployArgv, readPackageInstruction, readTarball, tenantLayer, tenantSettings,
} from "../service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_FLEET = join(HERE, "..", "..");
const KEY = "UBBW6C2IKGSG2Q3MWCL46LLY7IA2XTGTZDQZ4GXMRUKTCDTNXJG2SGBO";
const DIGEST = `sha256:${"c".repeat(64)}`;
const DEPLOYER = "tenant-deployer@example-tenants.iam.gserviceaccount.com";
const BUILDER = "tenant-builder@example-tenants.iam.gserviceaccount.com";
const WAKER = "tenant-waker@example-tenants.iam.gserviceaccount.com";
const TENANT = tenantSettings({
  DM_TENANT_PROJECT: "example-tenants", DM_TENANT_REGISTRY: "us-east1-docker.pkg.dev/example-tenants/agents",
  DM_TENANT_DEPLOYER: DEPLOYER, DM_TENANT_BUILDER: BUILDER, DM_TENANT_WAKER: WAKER,
});
const RUN_URL = "https://agent-helper-530021944272.us-east1.run.app";
const URL_ = "https://api.agentmesh.ai/v1/deploy-requests/dr_abcdefghijkl/package.tar.gz";

const dirs = [];
process.on("exit", () => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* the OS will */ } });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "dm-tenant-pkg-")); dirs.push(d); return d; };

/** A ustar archive of these files, gzipped, the way a package travels. */
function tarGz(files, extra = []) {
  const blocks = [];
  const header = (name, size, type) => {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, "utf8");
    h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
    h.write(size.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write(type, 156);
    h.write("ustar\0", 257); h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    return h;
  };
  for (const [name, text] of [...Object.entries(files), ...extra]) {
    const body = Buffer.from(text);
    blocks.push(header(name, body.length, "0"), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function packageFiles({ run = true, systems = [] } = {}) {
  const install = {
    format: "agent-install-v1",
    runtimes: [{ name: "node", version: ">=22", purpose: "runs its script" }],
    job_seconds: 120,
    ...(systems.length ? { systems } : {}),
    ...(run ? { run: { answer: { command: ["node", "{home}/{package}/skills/answer/scripts/answer.mjs", "--job", "{job_dir}"], reply: "stdout" } } } : {}),
  };
  const descriptor = { format: "agent-descriptor-v1", does: "Answers a question in one sentence.", offerings: [{ id: "answer", name: "Answer" }] };
  const manifest = { name: "helper", version: "0.1.0", extensions: { "net.agentdoc.package": { descriptor: { path: "descriptor.json" }, install: { path: "install.json" } } } };
  return {
    "helper/plugin.json": JSON.stringify(manifest),
    "helper/descriptor.json": JSON.stringify(descriptor),
    "helper/install.json": JSON.stringify(install),
    "helper/skills/answer/SKILL.md": "---\nname: answer\ndescription: answers\n---\nRun the script.\n",
    "helper/skills/answer/scripts/answer.mjs": "console.log('an answer');\n",
  };
}

/** The tenant image's files, laid out as the fleet host keeps them. */
function imageDir() {
  const d = tmp();
  const from = {
    "emit-image.mjs": join(REPO_FLEET, "image", "emit-image.mjs"),
    "one-message.mjs": join(REPO_FLEET, "image", "one-message.mjs"),
    "check-lockfile.mjs": join(REPO_FLEET, "image", "check-lockfile.mjs"),
    "tenant-host.mjs": join(REPO_FLEET, "image", "tenant-host.mjs"),
    "supervisor.mjs": join(REPO_FLEET, "runtime", "fleet", "supervisor.mjs"),
    "bases/tenant-catalogue.json": join(REPO_FLEET, "image", "bases", "tenant-catalogue.json"),
  };
  assert.deepEqual(Object.keys(from).sort(), [...TENANT_IMAGE_FILES].sort(), "the files the host keeps are the files the install reads");
  for (const [rel, src] of Object.entries(from)) {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    cpSync(src, join(d, rel));
  }
  return d;
}

const args = (sha, over = {}) => ({
  name: "helper", handle: "helper.person@example.com", request_id: "dr_abcdefghijkl", package_url: URL_, sha256: sha,
  boot_token: "dr-abcdefghijkl", interaction: "service", admit: [], tenant: "t-0a1b2c3d4e5f", instructed_by: "person@example.com", ...over,
});

function fakes(tgz, { handle = "helper.person@example.com", rows = [] } = {}) {
  const calls = [];
  let inventory = rows;
  const tokens = new Map([["/t/dr-abcdefghijkl.token", "am_single_use_token\n"]]);
  const built = {};
  let revision = 0;
  const gcloud = (argv) => {
    calls.push(argv);
    const j = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: "" });
    const [a, b, c] = argv;
    if (a === "builds" && b === "submit") {
      built.dockerfile = readFileSync(join(argv[2], "Dockerfile"), "utf8");
      built.tenant = readFileSync(join(argv[2], "tenant", "tenant.json"), "utf8");
      built.host = existsSync(join(argv[2], "tenant", "tenant-host.mjs")) && existsSync(join(argv[2], "tenant", "supervisor.mjs"));
      built.config = JSON.parse(readFileSync(argv[argv.indexOf("--config") + 1], "utf8"));
      return j({ id: "build-1" });
    }
    if (a === "builds" && b === "describe") return j({ status: "SUCCESS", results: { images: [{ digest: DIGEST }] } });
    if (a === "iam" && c === "describe") return { code: 1, stdout: "", stderr: "NOT_FOUND" };
    if (a === "secrets" && b === "describe") return { code: 1, stdout: "", stderr: "NOT_FOUND" };
    if (a === "run" && b === "deploy") { revision++; built.env = JSON.parse(readFileSync(argv[argv.indexOf("--env-vars-file") + 1], "utf8")); return j({ status: { url: RUN_URL } }); }
    if (a === "run" && b === "services" && c === "describe") {
      const r = `agent-helper-0000${revision}`;
      return j({ status: { conditions: [{ type: "Ready", status: "True" }], latestCreatedRevisionName: r, latestReadyRevisionName: r } });
    }
    if (a === "run" && b === "revisions") return j({ status: { imageDigest: `x@${DIGEST}` } });
    if (a === "logging" && b === "read") return j([{ textPayload: `${TENANT_READY_LINE} helper.person@example.com` }]);
    return j({});
  };
  const fetched = [];
  const fetch = async (url, init = {}) => {
    fetched.push({ url, auth: init.headers?.authorization ?? null });
    const ok = (o) => ({ ok: true, status: 200, json: async () => o });
    if (url === URL_) return { ok: true, status: 200, arrayBuffer: async () => tgz };
    if (url.endsWith("/v1/bootstrap")) return ok({ creds: "test-creds-placeholder", mesh: { endpoints: ["wss://mesh.agentmesh.ai"] }, ...(handle ? { handle } : {}) });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const records = {};
  const deps = {
    gcloud, fetch, now: () => "2026-09-29T10:00:00.000Z", sleep: async () => {},
    readFile: (f) => (tokens.has(f) ? tokens.get(f) : readFileSync(f, "utf8")),
    exists: (f) => tokens.has(f) || existsSync(f), remove: (f) => tokens.delete(f),
    tmp, writeFile: (f, body) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); }, rmdir: (d) => rmSync(d, { recursive: true, force: true }),
    inventory: { load: () => inventory.map((r) => ({ ...r })), save: (r) => { inventory = r; } },
    newKey: () => ({ seed: "seed-placeholder", key: KEY }),
    signer: () => ({ by: "UDEPLOYMGR", sign: null }), bearer: () => "bearer", saveRecord: (n, act, doc) => { records[act] = doc; },
    importModule: (f) => import(new URL(`file:///${f.replace(/\\/g, "/").replace(/^\/+/, "")}`).href),
    paths: { tokens: "/t", tmp: "/home/deploymgr/tmp" },
    settings: { tenant: TENANT, buildMinutes: 1, readyMinutes: 1, meshApi: "https://api.agentmesh.ai", control: "https://app.agentmesh.ai/v1", tenantImageDir: imageDir() },
  };
  return { deps, calls, built, fetched, records, inventory: () => inventory };
}

const quietly = async (fn) => {
  const w = process.stdout.write;
  process.stdout.write = () => true;
  try { return await fn(); } finally { process.stdout.write = w; process.exitCode = 0; }
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

test("an instruction with no tenant, or that hands a person's agent anything but its key, is refused in words", () => {
  const s = { tenant: TENANT };
  assert.throws(() => readPackageInstruction(args("a".repeat(64), { tenant: undefined }), s), /names no tenant/);
  assert.throws(() => readPackageInstruction(args("a".repeat(64), { credentials: { "text-reasoning": "vertex-claude-endpoint" } }), s), /given no credentials/);
  assert.throws(() => readPackageInstruction(args("a".repeat(64), { package_url: "https://example.com/p.tar.gz" }), s), /package_url/);
  assert.throws(() => readPackageInstruction(args("a".repeat(64), { handle: "other.person@example.com" }), s), /handle/);
  assert.throws(() => readPackageInstruction(args("a".repeat(64)), { tenant: tenantSettings({}) }), /names none/);
  assert.throws(() => readPackageInstruction(args("a".repeat(64)), { tenant: { ...TENANT, waker: "" } }), /names no waker/);
  const ins = readPackageInstruction(args("a".repeat(64)), s);
  assert.equal(ins.project, "example-tenants");
  assert.equal(ins.region, "us-east1");
  assert.equal(ins.memory, "1Gi");
});

test("a package archive holds regular files in one folder, and nothing that climbs out or links", () => {
  const ok = readTarball(tarGz(packageFiles()));
  assert.equal(ok.top, "helper");
  assert.ok(ok.files.some((f) => f.path === "helper/install.json"));
  assert.throws(() => readTarball(tarGz({ "helper/../evil": "x" })), /leaves it/);
  assert.throws(() => readTarball(tarGz({ "/etc/passwd": "x" })), /leaves it/);
  assert.throws(() => readTarball(tarGz({ "a/x": "1", "b/y": "2" })), /one top folder/);
});

test("a person's package is built on the tenant base with the tenant host, and runs in the tenant project as its own agent", async () => {
  const tgz = tarGz(packageFiles());
  const f = fakes(tgz);
  const out = await quietly(() => installPackage(args(sha(tgz)), f.deps));
  assert.equal(out.ok, true, JSON.stringify(out).slice(0, 600));
  assert.equal(out.handle, "helper.person@example.com");
  assert.equal(out.agent_key, KEY);
  assert.equal(out.tenant, "t-0a1b2c3d4e5f");
  // Every call in the tenant project, as the tenant deployer.
  for (const argv of f.calls) {
    assert.ok(argv.includes(`--impersonate-service-account=${DEPLOYER}`), argv.join(" "));
    const p = argv.indexOf("--project");
    if (p >= 0) assert.equal(argv[p + 1], "example-tenants");
  }
  assert.ok(!JSON.stringify(f.calls).includes("langbench-1528148150979"));
  // The package was fetched with this host's bearer, and its digest checked.
  assert.equal(f.fetched[0].auth, "Bearer bearer");
  // Built as tenant-builder, from the uploaded context.
  const submit = f.calls.find((a) => a[0] === "builds" && a[1] === "submit");
  assert.ok(submit.includes(`projects/example-tenants/serviceAccounts/${BUILDER}`));
  assert.ok(submit.includes("--region") && submit.includes("us-east1"));
  assert.ok(submit.includes("--gcs-source-staging-dir=gs://example-tenants_us-east1_cloudbuild/source"));
  assert.match(f.built.dockerfile, /FROM \$\{BASE_IMAGE\}/);
  assert.match(f.built.dockerfile, /ARG BASE_IMAGE=us-east1-docker\.pkg\.dev\/example-tenants\/agents\/agentmesh-base:0\.99\.7/);
  assert.ok(f.built.dockerfile.endsWith(tenantLayer()));
  assert.ok(f.built.host, "the tenant host and the supervisor are in the context");
  assert.deepEqual(JSON.parse(f.built.tenant).descriptor, "descriptor.json");
  assert.match(f.built.config.images[0], /^us-east1-docker\.pkg\.dev\/example-tenants\/agents\/helper:0\.1\.0-/);
  // The service: tenant-vpc, the agent's tags, the key as one variable, and
  // asleep until woken: nothing runs while idle, CPU only during a request,
  // an address only the waker's signed request gets through.
  const deploy = f.calls.find((a) => a[0] === "run" && a[1] === "deploy");
  const flag = (n) => deploy[deploy.indexOf(n) + 1];
  assert.ok(!deploy.includes("--no-default-url"));
  assert.equal(flag("--min-instances"), "0");
  assert.equal(flag("--max-instances"), "1");
  assert.ok(deploy.includes("--cpu-throttling") && !deploy.includes("--no-cpu-throttling"));
  assert.ok(deploy.includes("--no-allow-unauthenticated") && !deploy.includes("--allow-unauthenticated"));
  assert.equal(flag("--timeout"), "3600");
  assert.match(flag("--labels"), /,wake=platform$/);
  assert.equal(out.wake_url, RUN_URL);
  assert.equal(f.inventory()[0].wake_url, RUN_URL);
  assert.equal(f.records.deploy.target.shape.min_instances, 0);
  assert.equal(f.records.deploy.target.shape.wake.by, WAKER);
  assert.equal(deploy[deploy.indexOf("--network") + 1], "tenant-vpc");
  assert.equal(deploy[deploy.indexOf("--network-tags") + 1], "tenant-agent,t-0a1b2c3d4e5f");
  assert.equal(deploy[deploy.indexOf("--set-secrets") + 1], "AGENTMESH_CREDENTIALS_JSON=mesh-agent-helper:latest");
  assert.equal(deploy[deploy.indexOf("--ingress") + 1], "all");
  assert.deepEqual(f.built.env, { TENANT_AGENT_NAME: "helper", TENANT_AGENT_HANDLE: "helper.person@example.com", TENANT_WAKER: WAKER, TENANT_WAKE_IDLE_SECONDS: "120", TENANT_WAKE_MAX_SECONDS: "3300" });
  // Its ready line was waited for, and both records name what was placed.
  assert.ok(f.calls.some((a) => a[0] === "logging" && a.join(" ").includes(TENANT_READY_LINE)));
  assert.equal(f.records.deploy.subject.kind, "package");
  assert.equal(f.records.deploy.target.shape.tenant, "t-0a1b2c3d4e5f");
  assert.deepEqual(f.records.deploy.credentials_placed, ["mesh-agent-helper"]);
  assert.equal(f.inventory()[0].state, "running");
  assert.equal(f.inventory()[0].kind, "package");
});

test("bytes that do not hash to the filed digest are refused before anything is read or made", async () => {
  const tgz = tarGz(packageFiles());
  const f = fakes(tgz);
  const out = await quietly(() => installPackage(args("0".repeat(64)), f.deps));
  assert.equal(out.ok, false);
  assert.equal(out.step, "fetch");
  assert.equal(f.calls.length, 0);
});

test("a package that asks for a credential, or leaves its work to a harness, is refused before anything exists", async () => {
  const withKey = tarGz(packageFiles({ systems: [{ name: "text-reasoning", env: "TEXT_API_KEY", credential: "text-reasoning" }] }));
  const a = fakes(withKey);
  const outA = await quietly(() => installPackage(args(sha(withKey)), a.deps));
  assert.equal(outA.ok, false);
  assert.equal(outA.step, "verify");
  assert.match(outA.error, /asks for a credential for text-reasoning/);
  const harness = tarGz(packageFiles({ run: false }));
  const b = fakes(harness);
  const outB = await quietly(() => installPackage(args(sha(harness)), b.deps));
  assert.equal(outB.ok, false);
  assert.match(outB.error, /harness/);
  for (const f of [a, b]) assert.ok(!f.calls.some((x) => x[0] === "builds" || x[0] === "iam" || x[0] === "run"));
});

test("a key the platform did not name as asked is not started", async () => {
  const tgz = tarGz(packageFiles());
  const f = fakes(tgz, { handle: null });
  const out = await quietly(() => installPackage(args(sha(tgz)), f.deps));
  assert.equal(out.ok, false);
  assert.equal(out.step, "name");
  assert.ok(!f.calls.some((a) => a[0] === "run" && a[1] === "deploy"));
  assert.match(out.state, /retire helper to clean/);
  assert.equal(out.agent_key, KEY, "the key made before the stop is named, so it can be retired");
});

test("the service shape carries the key as one variable and nothing mounted", () => {
  const ins = readPackageInstruction(args("a".repeat(64)), { tenant: TENANT });
  const argv = packageServiceDeployArgv(ins, { service: "agent-helper", service_account: "agent-helper@example-tenants.iam.gserviceaccount.com", secret: "mesh-agent-helper" }, "x@sha256:1", "/tmp/env.json");
  assert.ok(!argv.join(" ").includes("/secrets/agentmesh"));
  assert.ok(argv.includes("--cpu-throttling"));
  assert.equal(argv[argv.indexOf("--min-instances") + 1], "0");
});
