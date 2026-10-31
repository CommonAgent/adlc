// The tenant build pool (technical debt 72 on AgentMesh): Cloud Build's shared
// pool has the internet, and a tenant build runs a stranger's Dockerfile, so a
// host that names DM_TENANT_WORKER_POOL sends every tenant build to a private
// pool with no public address. What is pinned: both tenant builds (a person's
// package and a container agent) name the pool and their region; the pool and
// the npm mirror are checked against the tenant project before anything is
// built; a container agent's source is fetched by this host from GitHub's
// archive of the pinned commit and uploaded, since the pool cannot reach
// GitHub; a package's npm install reads the mirror from a build secret that is
// in no layer and no argument; and a host that names no pool builds as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  NPM_SECRET_ID, buildSubmitArgv, fetchSourceFolder, packageBuildConfig, packageBuildSubmitArgv, readInstruction, readPackageInstruction,
  rowInstruction, tenantPoolProblem, tenantSettings,
} from "../service.mjs";

const COMMIT = "48a431e0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6";
const POOL = "projects/example-tenants/locations/us-east1/workerPools/tenant-builds";
const MIRROR = "https://us-east1-npm.pkg.dev/example-tenants/npm-mirror/";
const BASE_ENV = {
  DM_TENANT_PROJECT: "example-tenants", DM_TENANT_REGISTRY: "us-east1-docker.pkg.dev/example-tenants/agents",
  DM_TENANT_DEPLOYER: "tenant-deployer@example-tenants.iam.gserviceaccount.com",
  DM_TENANT_BUILDER: "tenant-builder@example-tenants.iam.gserviceaccount.com",
  DM_TENANT_WAKER: "tenant-waker@example-tenants.iam.gserviceaccount.com",
};
const pooled = (over = {}) => ({ tenant: tenantSettings({ ...BASE_ENV, DM_TENANT_WORKER_POOL: POOL, DM_TENANT_NPM_REGISTRY: MIRROR, ...over }) });
const unpooled = () => ({ tenant: tenantSettings(BASE_ENV) });

const containerArgs = (over = {}) => ({
  name: "helper-bot", handle: "helper-bot.someone@example.com", request_id: "dr_abcdefghijkl",
  source: { repository: "https://github.com/someone/helper", path: "agent", commit: COMMIT, dockerfile: "Dockerfile" },
  kind: "mesh-coded", settings: {}, secrets: {}, boot_token: "dr-abcdefghijkl", cpu: "1", memory: "1Gi", claims: [],
  tenant: "t-0a1b2c3d4e5f", ...over,
});
const packageArgs = () => ({
  tenant: "t-0a1b2c3d4e5f", name: "tally-words", handle: "tally-words.someone@example.com", request_id: "dr_abcdefghijkl",
  package_url: "https://api.agentmesh.ai/v1/deploy-requests/dr_abcdefghijkl/package.tar.gz", sha256: "a".repeat(64),
  boot_token: "dr-abcdefghijkl",
});
const refusal = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };

test("a pool outside the tenant project or region, or with no npm mirror beside it, is refused before anything is built", () => {
  assert.equal(refusal(() => tenantPoolProblem(pooled().tenant)), null);
  assert.equal(refusal(() => tenantPoolProblem(unpooled().tenant)), null, "no pool is the shared pool, as before");
  assert.match(refusal(() => tenantPoolProblem(pooled({ DM_TENANT_WORKER_POOL: "tenant-builds" }).tenant)), /projects\/<project>\/locations/);
  assert.match(refusal(() => tenantPoolProblem(pooled({ DM_TENANT_WORKER_POOL: POOL.replace("example-tenants", "other-project") }).tenant)), /tenant builds run in example-tenants\/us-east1/);
  assert.match(refusal(() => tenantPoolProblem(pooled({ DM_TENANT_WORKER_POOL: POOL.replace("us-east1", "us-central1") }).tenant)), /us-central1/);
  assert.match(refusal(() => tenantPoolProblem(pooled({ DM_TENANT_NPM_REGISTRY: "" }).tenant)), /DM_TENANT_NPM_REGISTRY/);
  assert.match(refusal(() => tenantPoolProblem(pooled({ DM_TENANT_NPM_REGISTRY: "https://registry.npmjs.org/" }).tenant)), /DM_TENANT_NPM_REGISTRY/);
  assert.match(refusal(() => readInstruction(containerArgs(), pooled({ DM_TENANT_NPM_REGISTRY: "" }))), /DM_TENANT_NPM_REGISTRY/);
  assert.match(refusal(() => readPackageInstruction(packageArgs(), pooled({ DM_TENANT_NPM_REGISTRY: "" }))), /DM_TENANT_NPM_REGISTRY/);
});

test("a container agent's tenant build runs on the pool, in its region, from the folder this host uploaded", () => {
  const ins = readInstruction(containerArgs(), pooled());
  assert.equal(ins.worker_pool, POOL);
  assert.throws(() => buildSubmitArgv(ins, "/tmp/cfg.json"), /folder this host fetched/);
  const argv = buildSubmitArgv(ins, "/tmp/cfg.json", "/tmp/x/src/helper-abc/agent");
  assert.equal(argv[2], "/tmp/x/src/helper-abc/agent");
  assert.equal(argv[argv.indexOf("--worker-pool") + 1], POOL);
  assert.equal(argv[argv.indexOf("--region") + 1], "us-east1");
  assert.ok(!argv.includes("--git-source-revision"), "the pool cannot reach GitHub");
  assert.ok(argv.includes("--gcs-source-staging-dir=gs://example-tenants_us-east1_cloudbuild/source"));
  assert.equal(argv[argv.indexOf("--service-account") + 1], "projects/example-tenants/serviceAccounts/tenant-builder@example-tenants.iam.gserviceaccount.com");
  const row = { name: "helper-bot", tenant: "t-0a1b2c3d4e5f", project: "example-tenants", region: "us-east1", image: `us-east1-docker.pkg.dev/example-tenants/agents/helper-bot@sha256:${"a".repeat(64)}`, source: ins.source };
  assert.equal(rowInstruction(row, pooled()).worker_pool, POOL, "a rebuild of an installed tenant agent uses the pool too");
});

test("a host that names no pool builds tenant images as before: GitHub fetched by Cloud Build, the shared pool", () => {
  const ins = readInstruction(containerArgs(), unpooled());
  const argv = buildSubmitArgv(ins, "/tmp/cfg.json");
  assert.equal(argv[2], "https://github.com/someone/helper");
  assert.ok(argv.includes("--git-source-revision"));
  assert.ok(!argv.includes("--worker-pool"));
  const p = readPackageInstruction(packageArgs(), unpooled());
  assert.ok(!packageBuildSubmitArgv(p, "/tmp/ctx", "/tmp/cfg.json").includes("--worker-pool"));
  const cfg = packageBuildConfig(p, "us-east1-docker.pkg.dev/example-tenants/agents/tally-words:0.1.0-aaaa", "0.1.0");
  assert.equal(cfg.steps.length, 1);
  assert.ok(!JSON.stringify(cfg).includes("secret"));
});

test("a package's tenant build runs on the pool and its npm install reads the mirror from a build secret, never an argument or a layer", () => {
  const p = readPackageInstruction(packageArgs(), pooled());
  const argv = packageBuildSubmitArgv(p, "/tmp/ctx", "/tmp/cfg.json");
  assert.equal(argv[argv.indexOf("--worker-pool") + 1], POOL);
  const cfg = packageBuildConfig(p, "us-east1-docker.pkg.dev/example-tenants/agents/tally-words:0.1.0-aaaa", "0.1.0");
  const [write, build] = cfg.steps;
  assert.deepEqual(write.volumes, [{ name: "npm-secret", path: "/npm-secret" }]);
  assert.deepEqual(build.volumes, write.volumes, "the secret is passed in a volume, outside the build context");
  const script = write.args[1];
  assert.match(script, /metadata\.google\.internal\/computeMetadata\/v1\/instance\/service-accounts\/default\/token/);
  assert.ok(script.includes(`registry=%s`) && script.includes(`'${MIRROR}'`) && script.includes("'//us-east1-npm.pkg.dev/example-tenants/npm-mirror/'"));
  assert.ok(!/(^|[^$])\$[A-Za-z({]/.test(script), "every shell dollar is doubled, so Cloud Build does not read it as a substitution");
  assert.ok(!script.includes("set -x") && !script.includes("cat /npm-secret") && !/echo[^\n]*\$\$T/.test(script), "the token is never printed");
  assert.ok(build.env.includes("DOCKER_BUILDKIT=1"));
  assert.deepEqual(build.args.slice(0, 3), ["build", "--secret", `id=${NPM_SECRET_ID},src=/npm-secret/npmrc`]);
  assert.ok(build.args.every((a) => !a.includes("_authToken")), "no token in an argument");
  assert.equal(cfg.options.requestedVerifyOption, "VERIFIED");
  assert.deepEqual(cfg.images, ["us-east1-docker.pkg.dev/example-tenants/agents/tally-words:0.1.0-aaaa"]);
});

/** A GitHub-shaped archive: a pax global header, then one top folder. */
function githubArchive(files, extra = []) {
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
  const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  const comment = Buffer.from(`52 comment=${COMMIT}\n`);
  blocks.push(header("pax_global_header", comment.length, "g"), pad(comment));
  blocks.push(header("helper-48a431e/", 0, "5"));
  for (const [name, body] of Object.entries(files)) {
    const b = Buffer.from(body);
    blocks.push(header(`helper-48a431e/${name}`, b.length, "0"), pad(b));
  }
  for (const [name, type] of extra) blocks.push(header(`helper-48a431e/${name}`, 0, type));
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function sourceDeps(archive, status = 200) {
  const asked = [];
  const written = new Map();
  return {
    asked, written,
    deps: {
      fetch: async (url) => { asked.push(url); return { ok: status === 200, status, arrayBuffer: async () => archive }; },
      writeFile: (f, b) => written.set(f.replace(/\\/g, "/"), b),
      exists: (f) => written.has(f.replace(/\\/g, "/")),
    },
  };
}

test("this host fetches GitHub's archive of the pinned commit and hands the build the named folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dm-pool-"));
  try {
    const ins = readInstruction(containerArgs(), pooled());
    const f = sourceDeps(githubArchive({ "agent/Dockerfile": "FROM mirror.gcr.io/library/node:22\n", "agent/main.mjs": "export {};\n", "README.md": "hi\n" }));
    const folder = (await fetchSourceFolder(ins, dir, f.deps)).replace(/\\/g, "/");
    assert.deepEqual(f.asked, [`https://github.com/someone/helper/archive/${COMMIT}.tar.gz`]);
    assert.ok(folder.endsWith("/src/helper-48a431e/agent"), folder);
    assert.ok([...f.written.keys()].some((k) => k.endsWith("/src/helper-48a431e/agent/Dockerfile")));
    const noDockerfile = sourceDeps(githubArchive({ "agent/main.mjs": "export {};\n" }));
    await assert.rejects(fetchSourceFolder(ins, dir, noDockerfile.deps), /agent has no Dockerfile at 48a431e/);
    const linked = sourceDeps(githubArchive({ "agent/Dockerfile": "FROM x\n" }, [["agent/escape", "2"]]));
    await assert.rejects(fetchSourceFolder(ins, dir, linked.deps), /could not be read: the repository holds a link/);
    await assert.rejects(fetchSourceFolder(ins, dir, sourceDeps(Buffer.alloc(0), 404).deps), /GitHub answered 404/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
