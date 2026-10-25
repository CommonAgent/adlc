// The deployment manager's tenant placement (docs/tenant-isolation-plan.md).
// What is pinned: a tenant's agent runs only in the tenant project, whatever
// the request or the host's placement says; it is built as the tenant
// builder and handled as the tenant deployer by impersonation; its service
// sends everything through tenant-vpc under the agent tag, and it sleeps
// until the tenant waker wakes it (never kept always on); it reads no
// platform secret; its tenant's limits are enforced before anything exists;
// and the tenant project refuses a workload with no tenant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSubmitArgv, rowInstruction, checkTenantLimits, egressOf, install, tenantEgress, platformSettings, readInstruction, resourcesFor, retire, serviceDeployArgv, tenantSettings, tenantUsage, TENANT_AGENT_TAG,
} from "../service.mjs";

const COMMIT = "48a431e0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6";
const DIGEST = `sha256:${"b".repeat(64)}`;
const KEY = "UBBW6C2IKGSG2Q3MWCL46LLY7IA2XTGTZDQZ4GXMRUKTCDTNXJG2SGBO";
const DEPLOYER = "tenant-deployer@example-tenants.iam.gserviceaccount.com";
const BUILDER = "tenant-builder@example-tenants.iam.gserviceaccount.com";

const TENANT = tenantSettings({
  DM_TENANT_PROJECT: "example-tenants", DM_TENANT_REGISTRY: "us-east1-docker.pkg.dev/example-tenants/agents",
  DM_TENANT_DEPLOYER: DEPLOYER, DM_TENANT_BUILDER: BUILDER,
  DM_TENANT_WAKER: "tenant-waker@example-tenants.iam.gserviceaccount.com",
  DM_TENANT_EGRESS: JSON.stringify({
    policy: "allowlist",
    allowed: [{ name: "network", from: "network", address: "192.0.2.10/32" }, { name: "registrar", from: "registrar", address: "192.0.2.20/32" }],
    denied: ["10.0.0.0/8"], enforced_by: "gcp-vpc-firewall (tenant-vpc, tag tenant-agent)",
  }),
});
const S = { tenant: TENANT, platform: platformSettings({ DM_PLATFORM_WAKER: "platform-waker@langbench-1528148150979.iam.gserviceaccount.com" }),
  wakeHostFile: "/opt/fleet/wake-host.mjs", buildMinutes: 1, readyMinutes: 1, meshApi: "https://api.agentmesh.ai", control: "https://app.agentmesh.ai/v1" };
const WAKE_HOST = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "image", "wake-host.mjs"), "utf8");

const args = (over = {}) => ({
  name: "helper-bot", handle: "helper-bot.someone@example.com", request_id: "dr_abcdefghijkl",
  source: { repository: "https://github.com/someone/helper", path: "", commit: COMMIT, dockerfile: "Dockerfile" },
  kind: "mesh-coded", settings: {}, secrets: {}, boot_token: "dr-abcdefghijkl",
  project: "langbench-1528148150979", region: "us-central1", registry: "gcr.io/langbench-1528148150979/deploymgr",
  cpu: "1", memory: "1Gi", claims: [], tenant: "t-0a1b2c3d4e5f", ...over,
});

function fakes(rows = []) {
  const calls = [];
  let inventory = rows;
  const files = new Map([["/t/dr-abcdefghijkl.token", "am_single_use_token\n"], ["/opt/fleet/wake-host.mjs", WAKE_HOST]]);
  let revision = 0;
  const gcloud = (argv) => {
    calls.push(argv);
    const j = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: "" });
    const [a, b, c] = argv;
    if (a === "builds" && b === "submit") return j({ id: "build-1" });
    if (a === "builds" && b === "describe") return j({ status: "SUCCESS", results: { images: [{ digest: DIGEST }] } });
    if (a === "iam" && c === "describe") return { code: 1, stdout: "", stderr: "NOT_FOUND" };
    if (a === "secrets" && b === "describe") return { code: 1, stdout: "", stderr: "NOT_FOUND" };
    if (a === "run" && b === "deploy") { revision++; return j({ status: { url: "https://agent-helper-bot-abc123-ue.a.run.app" } }); }
    if (a === "run" && b === "services" && c === "describe") {
      const r = `agent-helper-bot-0000${revision}`;
      return j({ status: { url: "https://agent-helper-bot-abc123-ue.a.run.app", conditions: [{ type: "Ready", status: "True" }], latestCreatedRevisionName: r, latestReadyRevisionName: r } });
    }
    if (a === "logging") return j([{ textPayload: "wake host: asleep: waiting to be woken" }]);
    if (a === "run" && b === "revisions") return j({ status: { imageDigest: `x@${DIGEST}` } });
    return j({});
  };
  const fetch = async (url) => {
    const ok = (o) => ({ ok: true, status: 200, json: async () => o });
    if (url.endsWith("/v1/bootstrap")) return ok({ creds: "test-creds-placeholder", mesh: { endpoints: [] } });
    if (url.endsWith("/name")) return ok({ ok: true, handle: "helper-bot.someone@example.com" });
    if (url.endsWith("/retire-key")) return ok({ ok: true });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const deps = {
    gcloud, fetch, now: () => "2026-09-29T10:00:00.000Z", sleep: async () => {},
    readFile: (f) => files.get(f), exists: (f) => files.has(f), remove: (f) => files.delete(f),
    tmp: () => "/tmp/x", writeFile: (f, body) => files.set(f, body), rmdir: () => {},
    inventory: { load: () => inventory.map((r) => ({ ...r })), save: (r) => { inventory = r; } },
    newKey: () => ({ seed: "seed-placeholder", key: KEY }),
    signer: () => ({ by: "UDEPLOYMGR", sign: null }), bearer: () => "bearer", saveRecord: () => {},
    paths: { tokens: "/t", tmp: "/home/deploymgr/tmp" }, settings: S,
  };
  return { deps, calls, inventory: () => inventory };
}

const quietly = async (fn) => {
  const w = process.stdout.write;
  process.stdout.write = () => true;
  try { return await fn(); } finally { process.stdout.write = w; process.exitCode = 0; }
};

test("a tenant's agent runs in the tenant project, whatever the request says", () => {
  const ins = readInstruction(args(), S);
  assert.equal(ins.project, "example-tenants");
  assert.equal(ins.region, "us-east1");
  assert.equal(ins.registry, "us-east1-docker.pkg.dev/example-tenants/agents");
  assert.equal(resourcesFor(ins).service_account, "agent-helper-bot@example-tenants.iam.gserviceaccount.com");
});

test("a tenant install is refused when this host names no tenant project", () => {
  assert.throws(() => readInstruction(args(), { tenant: tenantSettings({}) }), /runs only in the tenant project/);
});

test("the tenant project refuses a workload that names no tenant", () => {
  assert.throws(() => readInstruction(args({ tenant: undefined, project: "example-tenants" }), S), /takes only tenant workloads/);
  assert.equal(readInstruction(args({ tenant: undefined }), S).project, "langbench-1528148150979", "a platform install is unchanged");
});

test("a tenant's agent reads no platform secret and stays within one service's size", () => {
  assert.throws(() => readInstruction(args({ secrets: { GOOGLE_GENERATIVE_AI_API_KEY: "fleet-gemini-api-key" } }), S), /reads only its own credential/);
  assert.throws(() => readInstruction(args({ cpu: "4" }), S), /at most 2 CPUs/);
  assert.throws(() => readInstruction(args({ memory: "4Gi" }), S), /at most 2 GiB/);
  assert.throws(() => readInstruction(args({ tenant: "Somebody" }), S), /tenant id/);
});

test("the service goes through tenant-vpc under the agent tag, sleeps until the tenant waker wakes it, labelled by tenant", () => {
  const ins = readInstruction(args(), S);
  assert.equal(ins.waker, "tenant-waker@example-tenants.iam.gserviceaccount.com");
  assert.throws(() => readInstruction(args({ always_on: true }), S), /cannot be kept always on/);
  const argv = serviceDeployArgv(ins, resourcesFor(ins), `x@${DIGEST}`, "/tmp/env.json");
  const flag = (f) => argv[argv.indexOf(f) + 1];
  assert.equal(flag("--network"), "tenant-vpc");
  assert.equal(flag("--subnet"), "tenant-us-east1");
  assert.equal(flag("--vpc-egress"), "all-traffic");
  assert.equal(flag("--network-tags"), `${TENANT_AGENT_TAG},t-0a1b2c3d4e5f`);
  assert.ok(!argv.includes("--no-default-url"), "the waker calls its address");
  assert.equal(flag("--min-instances"), "0");
  assert.equal(flag("--ingress"), "all");
  assert.ok(argv.includes("--no-allow-unauthenticated"));
  assert.match(flag("--labels"), /workload=tenant,tenant=t-0a1b2c3d4e5f,wake=platform/);
  assert.equal(flag("--set-secrets"), "/secrets/agentmesh/credentials.json=mesh-agent-helper-bot:latest");
});

test("a tenant image is built as the tenant builder", () => {
  const ins = readInstruction(args(), S);
  const argv = buildSubmitArgv(ins, "/tmp/cfg.json");
  assert.equal(argv[argv.indexOf("--service-account") + 1], `projects/example-tenants/serviceAccounts/${BUILDER}`);
  const platform = buildSubmitArgv(readInstruction(args({ tenant: undefined }), S), "/tmp/cfg.json");
  assert.ok(!platform.includes("--service-account"));
});

test("a platform image is built as the platform builder when the host names one of its project, and as before otherwise", () => {
  const plain = readInstruction(args({ tenant: undefined }), S);
  const withBuilder = (b) => ({ ...S, platform: platformSettings({ DM_PLATFORM_WAKER: "platform-waker@langbench-1528148150979.iam.gserviceaccount.com", DM_PLATFORM_BUILDER: b }) });
  const mine = `fleet-builder@${plain.project}.iam.gserviceaccount.com`;
  const argv = buildSubmitArgv(readInstruction(args({ tenant: undefined }), withBuilder(mine)), "/tmp/cfg.json");
  assert.equal(argv[argv.indexOf("--service-account") + 1], `projects/${plain.project}/serviceAccounts/${mine}`);
  for (const other of ["fleet-builder@another-project.iam.gserviceaccount.com", "not an account"]) {
    assert.ok(!buildSubmitArgv(readInstruction(args({ tenant: undefined }), withBuilder(other)), "/tmp/cfg.json").includes("--service-account"), other);
  }
  const row = { name: "helper-bot", project: plain.project, region: "us-east1", image: `gcr.io/x/y@sha256:${"a".repeat(64)}`, source: plain.source };
  assert.equal(rowInstruction(row, withBuilder(mine)).builder, mine, "a rebuild of an installed row uses it too");
});
test("a tenant install is made entirely as the tenant deployer, in the tenant project", async () => {
  const f = fakes();
  const r = await quietly(() => install(args(), f.deps));
  assert.equal(r.ok, true, r.error);
  assert.ok(f.calls.length > 5);
  for (const argv of f.calls) {
    assert.ok(argv.includes(`--impersonate-service-account=${DEPLOYER}`), argv.join(" "));
    assert.ok(!argv.join(" ").includes("langbench"), argv.join(" "));
  }
  const row = f.inventory().find((x) => x.name === "helper-bot");
  assert.equal(row.tenant, "t-0a1b2c3d4e5f");
  assert.equal(row.project, "example-tenants");
  assert.equal(r.record.target.shape.vpc_egress, "all-traffic");
  assert.equal(r.record.egress.policy, "allowlist");
  assert.equal(r.record.egress.enforced_by, "gcp-vpc-firewall (tenant-vpc, tag tenant-agent)");
  assert.deepEqual(r.record.egress.allowed.map((a) => a.from), ["network", "registrar"]);
  assert.deepEqual(r.record.egress.denied, ["10.0.0.0/8"]);
  assert.ok(!f.calls.some((argv) => argv[2] === "add-iam-policy-binding" && argv[0] === "run"), "the tenant waker holds its role on the tenant project, not per service");
  assert.equal(r.wake_url, "https://agent-helper-bot-abc123-ue.a.run.app");
});

test("a tenant's limits are enforced before anything exists", async () => {
  const running = (name, cpu = "1", memory = "1Gi") => ({ name, tenant: "t-0a1b2c3d4e5f", state: "running", cpu, memory });
  const f = fakes([running("one"), running("two")]);
  const r = await quietly(() => install(args(), f.deps));
  assert.equal(r.ok, false);
  assert.equal(r.step, "limits");
  assert.match(r.error, /already runs 2 of the 2 services/);
  assert.equal(f.calls.length, 0, "nothing was asked of Google");
  const lim = { services: 5, cpu: 2, memory_mib: 4096, instance_hours: 120 };
  assert.match(checkTenantLimits(readInstruction(args(), S), [running("one", "1.5")], lim), /would have 2.5 CPUs/);
  assert.match(checkTenantLimits(readInstruction(args(), S), [running("one", "0.5", "2Gi"), running("two", "0.5", "2Gi")], lim), /would have 5120 MiB/);
  // A sleeper counts no instance-hours; rows kept on from before the wake count 24 a day.
  assert.equal(checkTenantLimits(readInstruction(args(), S), [running("a", "0.1", "512Mi"), running("b", "0.1", "512Mi")], { ...lim, instance_hours: 48 }), null);
  assert.match(checkTenantLimits(readInstruction(args(), S), [running("a", "0.1", "512Mi"), running("b", "0.1", "512Mi"), running("c", "0.1", "512Mi")], { ...lim, instance_hours: 48 }), /72 instance-hours/);
  assert.equal(tenantUsage([{ ...running("a"), wake: true }], "t-0a1b2c3d4e5f").instance_hours, 0);
  assert.equal(checkTenantLimits(readInstruction(args(), S), [{ ...running("other"), tenant: "t-ffffffffffff" }, running("x", "1", "1Gi")], lim), null, "another tenant's services do not count");
  assert.equal(tenantUsage([running("x"), { ...running("y"), state: "failed at build" }], "t-0a1b2c3d4e5f").services, 1);
});

test("retiring a tenant's agent is done as the tenant deployer too", async () => {
  const row = { name: "helper-bot", tenant: "t-0a1b2c3d4e5f", project: "example-tenants", region: "us-east1", service: "agent-helper-bot",
    service_account: "agent-helper-bot@example-tenants.iam.gserviceaccount.com", secret: "mesh-agent-helper-bot", images: [], state: "running", agent_key: KEY };
  const f = fakes([row]);
  const r = await quietly(() => retire("helper-bot", "test", f.deps));
  assert.equal(r.ok, true, JSON.stringify(r.remaining));
  for (const argv of f.calls) assert.ok(argv.includes(`--impersonate-service-account=${DEPLOYER}`));
});

test("the tenant network's egress is recorded as the host describes it, and never guessed", () => {
  // No description: the member is left out, which says the egress was not observed.
  assert.equal(tenantEgress(""), null);
  assert.equal(egressOf({ tenant: "t-0a1b2c3d4e5f", egress: null }), null);
  // An allowlist enforced by nothing is not an allowlist (8.3), and neither is one with no entries.
  assert.equal(tenantEgress(JSON.stringify({ policy: "allowlist", allowed: [{ name: "network", from: "network" }], enforced_by: "none" })), null);
  assert.equal(tenantEgress(JSON.stringify({ policy: "allowlist", allowed: [], enforced_by: "a firewall" })), null);
  // An entry from outside the seven sources, or text that is not JSON, is no description.
  assert.equal(tenantEgress(JSON.stringify({ policy: "allowlist", allowed: [{ name: "x", from: "elsewhere" }], enforced_by: "a firewall" })), null);
  assert.equal(tenantEgress("{not json"), null);
  // What the network lets through beyond the derived set is listed too, as the host's.
  assert.equal(tenantEgress(JSON.stringify({ policy: "allowlist", allowed: [{ name: "metadata", from: "host", address: "169.254.169.254" }], enforced_by: "a firewall" })).allowed[0].from, "host");
  // Open is a true record too.
  assert.deepEqual(tenantEgress(JSON.stringify({ policy: "open", enforced_by: "none" })), { policy: "open", enforced_by: "none" });
  // A platform agent is open whatever the tenant settings say.
  assert.deepEqual(egressOf({ tenant: null, egress: TENANT.egress }), { policy: "open", enforced_by: "none" });
  assert.equal(TENANT.egress.policy, "allowlist");
});

test("a host whose tenant file carries the egress description loads it when the module loads", async () => {
  // SETTINGS reads the tenant file while service.mjs is still loading, so the
  // parser must not lean on anything declared later in the module.
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..");
  const rendered = execFileSync(process.execPath, [join(root, "env", "render.mjs"), join(here, "..", "host", "deploymgr-tenant.json.tmpl")],
    { env: { ...process.env, AGENTMESH_ENV: "example" }, encoding: "utf8" });
  const dir = mkdtempSync(join(tmpdir(), "dm-tenant-"));
  try {
    writeFileSync(join(dir, "deploymgr-tenant.json"), rendered);
    const service = join(here, "..", "service.mjs").replace(/\\/g, "/");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e",
      `const m = await import("file:///${service.replace(/^\//, "")}"); console.log(JSON.stringify(m.SETTINGS.tenant.egress));`],
      { env: { ...process.env, AGENTMESH_ENV: "example", DM_FLEET: dir }, encoding: "utf8" });
    const egress = JSON.parse(out.trim().split("\n").pop());
    assert.equal(egress.policy, "allowlist");
    assert.ok(egress.allowed.some((a) => a.from === "host" && a.address === "169.254.169.254"), "the metadata server is listed");
    assert.ok(egress.allowed.some((a) => a.name === "api" && a.address === "192.0.2.11/32"), "the API host is listed (egress step 2)");
    assert.ok(!egress.allowed.some((a) => a.address === "199.36.153.8/30"), "a tenant agent no longer reaches Google APIs; only the sandbox does");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
