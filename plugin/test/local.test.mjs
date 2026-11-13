// The local AgentMesh (kit/local.mjs): the open-source server in Docker on
// this computer from its public images, and the agent built in the folder
// running beside it in a container, answering through the adapter and the
// bridge. Docker, git, the server and the packer are all stand-ins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTER, CONTAINER_HOME_URL, LOCAL_FILES, SERVER, down, localLayer, localProblems, put, runEnv, serverEnv, status, tryIt, up } from "../kit/local.mjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const KIT_LOCAL = join(dirname(fileURLToPath(import.meta.url)), "..", "kit", "local");
import { entryOf, replyOf } from "../kit/local/bridge.mjs";

const KEY = "am_local_single_use_key";
const ID = "UBBW6C2IKGSG2Q3MWCL46LLY7IA2XTGTZDQZ4GXMRUKTCDTNXJG2SGBO";
const CALLER = "UDKCJGNZOE5G7VUFPCGCHDD7N3ZQTVH5KHEBTLRSMROD6DQWMA7RWNSG";
const dirs = [];
process.on("exit", () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };

/** Docker and git, standing in: every call kept. */
function docker({ dockerUp = true, volume = false } = {}) {
  const calls = [];
  const seen = {};
  const run = (cmd, args, { cwd } = {}) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
    if (cmd === "docker" && args[0] === "info") return dockerUp ? ok("29.0.0") : { status: 1, stdout: "", stderr: "Cannot connect" };
    if (cmd === "git" && args[0] === "clone") { mkdirSync(join(args.at(-1), "deploy", "compose", "nats"), { recursive: true }); return ok(); }
    if (cmd === "docker" && args.includes("mesh-admin") && args.includes("key")) return ok(`a key for the tenant:\n${KEY}\n`);
    if (cmd === "docker" && args[0] === "build") {
      const ctx = args.at(-1);
      seen.dockerfile = readFileSync(join(ctx, "Dockerfile"), "utf8");
      seen.local = existsSync(join(ctx, "local", "bridge.mjs")) && existsSync(join(ctx, "local", "start.sh"));
      if (seen.local) { seen.startSh = readFileSync(join(ctx, "local", "start.sh"), "utf8"); seen.bridge = readFileSync(join(ctx, "local", "bridge.mjs"), "utf8"); }
      return ok("sha256:abc");
    }
    if (cmd === "docker" && args[0] === "volume" && args[1] === "inspect") return volume ? ok("[]") : { status: 1, stdout: "", stderr: "no such volume" };
    if (cmd === "docker" && args[0] === "run" && args.includes("-d")) { const f = args[args.indexOf("--env-file") + 1]; seen.env = readFileSync(f, "utf8"); seen.envFile = f; return ok("c0ffee"); }
    if (cmd === "docker" && args[0] === "logs") return ok(`agentmesh: registered as ${ID}\n`);
    if (cmd === "docker" && args[0] === "run" && args.includes("--rm")) {
      if (!args.some((a) => a.startsWith("TRY_TO="))) return ok(JSON.stringify({ agent_id: CALLER }));
      seen.caller = args;
      return ok("09:30 in Denver is 17:30 in Paris.\n");
    }
    if (cmd === "docker" && args[0] === "ps") return ok(args.includes("-aq") ? "c0ffee\n" : "agentmesh-local-time-zone-converter\tUp 2 minutes\n");
    void cwd;
    return ok();
  };
  return { run, calls, seen };
}
const answering = async () => ({ ok: true, json: async () => ({ agent_messaging: "0.10.2", profile: "full" }) });
const silent = async () => { throw new Error("connection refused"); };

/** A package the emitter reads: one job with a command of its own. */
function packageFiles(into, { systems = [], run = true } = {}) {
  const pkg = join(into, "time-zone-converter");
  mkdirSync(join(pkg, "skills", "convert", "scripts"), { recursive: true });
  writeFileSync(join(pkg, "plugin.json"), JSON.stringify({ name: "time-zone-converter", version: "0.1.2", extensions: { "net.agentdoc.package": { descriptor: { path: "descriptor.json" }, install: { path: "install.json" } } } }));
  writeFileSync(join(pkg, "descriptor.json"), JSON.stringify({ format: "agent-descriptor-v1", does: "Converts a time between zones.", offerings: [{ id: "convert", name: "Convert" }] }));
  writeFileSync(join(pkg, "install.json"), JSON.stringify({
    format: "agent-install-v1", runtimes: [{ name: "node", version: ">=22", purpose: "runs its script" }], job_seconds: 60,
    directories: [{ name: "records", purpose: "what each job leaves" }],
    ...(systems.length ? { systems } : {}),
    ...(run ? { run: { convert: { command: ["node", "{home}/{package}/skills/convert/scripts/convert.mjs", "--job", "{job_dir}"], reply: "stdout" } } } : {}),
  }));
  writeFileSync(join(pkg, "skills", "convert", "SKILL.md"), "---\nname: convert\ndescription: converts\n---\nRun the script.\n");
  writeFileSync(join(pkg, "skills", "convert", "scripts", "convert.mjs"), "console.log('converted');\n");
  return pkg;
}
const packer = (opts) => (_dir, { out }) => ({ ok: true, package_dir: packageFiles(out, opts) });

function folder() {
  const dir = tmp("adlc-local-");
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "time-zone-converter", version: "0.1.2" }));
  return dir;
}

test("the server is the open-source one, from its public images at the pinned release, reached by containers at the host", () => {
  const env = serverEnv();
  assert.match(env, new RegExp(`SERVER_IMAGE=ghcr\\.io/agent-messaging/agent-messaging-server:${SERVER.version.replace(/\./g, "\\.")}`));
  assert.match(env, /GATEWAY_IMAGE=ghcr\.io\/agent-messaging\/agent-messaging-a2a-gateway:/);
  assert.match(env, /MESH_PUBLIC_URL=http:\/\/host\.docker\.internal:3005/);
  assert.ok(!/agentmesh\.ai/.test(env), "no AgentMesh address");
});

test("up starts the server from its compose files, waits for it to answer, and makes the tenant", async () => {
  const home = tmp("adlc-local-home-");
  const d = docker();
  const r = await up({ env: { ADLC_LOCAL_HOME: home }, run: d.run, fetcher: answering, sleep: async () => {} });
  assert.equal(r.code, 0, r.said);
  assert.ok(d.calls.some((c) => c.startsWith(`git clone --quiet --depth 1 --branch ${SERVER.tag} https://github.com/${SERVER.repository}.git`)));
  assert.equal(readFileSync(join(home, "ams", "deploy", "compose", "nats", ".env"), "utf8"), serverEnv());
  assert.ok(d.calls.includes("docker compose -p agentmesh-local up -d"));
  assert.ok(d.calls.some((c) => c.endsWith("mesh-admin tenants create local")));
  assert.ok(existsSync(join(home, "mesh.json")));
});

test("up says so when Docker does not answer, or the server never does, and starts nothing in the first case", async () => {
  const off = docker({ dockerUp: false });
  const r1 = await up({ env: { ADLC_LOCAL_HOME: tmp("adlc-local-home-") }, run: off.run, fetcher: answering, sleep: async () => {} });
  assert.equal(r1.code, 1);
  assert.match(r1.said, /Docker does not answer/);
  assert.equal(off.calls.length, 1);
  const d = docker();
  const r2 = await up({ env: { ADLC_LOCAL_HOME: tmp("adlc-local-home-") }, run: d.run, fetcher: silent, sleep: async () => {}, waitMs: 0 });
  assert.equal(r2.code, 1);
  assert.match(r2.said, /does not answer at http:\/\/127\.0\.0\.1:3005/);
});

test("a package that asks for keys, settings or a harness is refused locally, in words", () => {
  const ok = JSON.parse(readFileSync(join(packageFiles(tmp("adlc-pkg-")), "install.json"), "utf8"));
  assert.deepEqual(localProblems(ok, "time-zone-converter"), []);
  const keyed = JSON.parse(readFileSync(join(packageFiles(tmp("adlc-pkg-"), { systems: [{ name: "code-host", env: "GITHUB_TOKEN", credential: "github-token" }] }), "install.json"), "utf8"));
  assert.match(localProblems(keyed, "time-zone-converter")[0], /a credential for code-host/);
  const harness = JSON.parse(readFileSync(join(packageFiles(tmp("adlc-pkg-"), { run: false }), "install.json"), "utf8"));
  assert.ok(localProblems(harness, "time-zone-converter").some((p) => /harness/.test(p)));
});

test("the container is given its key, the mesh's address, its directories and the person's model settings, and nothing else", () => {
  const env = runEnv({ name: "tzc", key: KEY, directories: [{ name: "records", env: "AGENT_DIRECTORY_RECORDS" }], env: { MODEL_NAME: "m", MODEL_KEY: "sk-mine", MODEL_ENDPOINT: "", HOME: "/home/me", GITHUB_TOKEN: "ghp_x" } });
  assert.equal(env, [`LOCAL_AGENT_KEY=${KEY}`, `LOCAL_MESH_HOME=${CONTAINER_HOME_URL}`, "AGENT_NAME=tzc", "AGENT_DIRECTORY_RECORDS=/data/records", "MODEL_NAME=m", "MODEL_KEY=sk-mine", ""].join("\n"));
});

test("put builds the package's image with the adapter and the bridge, runs it with its key in a file that is gone after, and says which agent it is", async () => {
  const home = tmp("adlc-local-home-");
  writeFileSync(join(home, "mesh.json"), "{}");
  const d = docker();
  const r = await put(folder(), { env: { ADLC_LOCAL_HOME: home, MODEL_KEY: "sk-mine" }, run: d.run, packer: packer(), sleep: async () => {} });
  assert.equal(r.code, 0, r.said);
  assert.equal(r.id, ID);
  assert.match(r.said, /with your model settings/);
  assert.ok(d.seen.dockerfile.endsWith(localLayer()));
  assert.ok(d.seen.dockerfile.includes(ADAPTER.url));
  assert.ok(d.seen.local, "the bridge and the start script are in the build context");
  assert.match(d.seen.env, new RegExp(`LOCAL_AGENT_KEY=${KEY}`));
  assert.match(d.seen.env, /MODEL_KEY=sk-mine/);
  assert.ok(!existsSync(d.seen.envFile), "the file with the key is removed once the container started");
  const runLine = d.calls.find((c) => c.startsWith("docker run -d"));
  assert.ok(runLine.includes("--add-host host.docker.internal:host-gateway") && runLine.includes("-v agentmesh-local-time-zone-converter:/data"));
  assert.ok(!runLine.includes("sk-mine") && !runLine.includes(KEY), "no secret on the command line");
  assert.deepEqual(JSON.parse(readFileSync(join(home, "agents", "time-zone-converter", "agent.json"), "utf8")).id, ID);
});

test("the start script and the bridge go into the image with LF line endings, though Git on Windows checked them out with CRLF", async () => {
  const home = tmp("adlc-local-home-");
  writeFileSync(join(home, "mesh.json"), "{}");
  const crlf = tmp("adlc-local-crlf-");
  for (const f of LOCAL_FILES) writeFileSync(join(crlf, f), readFileSync(join(KIT_LOCAL, f), "utf8").replace(/\r?\n/g, "\r\n"));
  assert.ok(readFileSync(join(crlf, "start.sh"), "utf8").includes("set -eu\r\n"), "the stand-in checkout has CRLF");
  const d = docker();
  const r = await put(folder(), { env: { ADLC_LOCAL_HOME: home }, run: d.run, packer: packer(), sleep: async () => {}, localDir: crlf });
  assert.equal(r.code, 0, r.said);
  assert.ok(!d.seen.startSh.includes("\r"), "start.sh has no carriage return in the image");
  assert.ok(d.seen.startSh.includes("set -eu\n"));
  assert.ok(!d.seen.bridge.includes("\r"));
});

test("a new version of an agent that ran here keeps its volume, so it is the same agent, and no key is made", async () => {
  const home = tmp("adlc-local-home-");
  writeFileSync(join(home, "mesh.json"), "{}");
  mkdirSync(join(home, "agents", "time-zone-converter"), { recursive: true });
  writeFileSync(join(home, "agents", "time-zone-converter", "agent.json"), JSON.stringify({ id: ID }));
  const d = docker({ volume: true });
  const r = await put(folder(), { env: { ADLC_LOCAL_HOME: home }, run: d.run, packer: packer(), sleep: async () => {} });
  assert.equal(r.code, 0, r.said);
  assert.ok(!d.calls.some((c) => c.includes("tenants key")), "no key is made");
  assert.ok(!d.calls.some((c) => c.startsWith("docker volume rm")), "the volume is kept");
  assert.match(d.seen.env, /^LOCAL_AGENT_KEY=\n/);
});

test("put refuses before anything is built when the local mesh is not running, or the package asks for a key", async () => {
  const d = docker();
  const r1 = await put(folder(), { env: { ADLC_LOCAL_HOME: tmp("adlc-local-home-") }, run: d.run, packer: packer() });
  assert.equal(r1.code, 1);
  assert.match(r1.said, /not running/);
  const home = tmp("adlc-local-home-");
  writeFileSync(join(home, "mesh.json"), "{}");
  const r2 = await put(folder(), { env: { ADLC_LOCAL_HOME: home }, run: d.run, packer: packer({ systems: [{ name: "code-host", env: "GITHUB_TOKEN" }] }) });
  assert.equal(r2.code, 1);
  assert.match(r2.said, /a credential for code-host/);
  assert.ok(!d.calls.some((c) => c.startsWith("docker build") || c.startsWith("docker run")));
});

test("try sends one message from the local caller's own container, which the agent lets in, and shows the reply; the caller joins once", async () => {
  const home = tmp("adlc-local-home-");
  mkdirSync(join(home, "agents", "time-zone-converter"), { recursive: true });
  writeFileSync(join(home, "agents", "time-zone-converter", "agent.json"), JSON.stringify({ id: ID, image: "agentmesh-local/time-zone-converter:0.1.2", container: "agentmesh-local-time-zone-converter" }));
  const d = docker();
  const r = await tryIt(folder(), { text: "09:30 Denver to Paris", env: { ADLC_LOCAL_HOME: home }, run: d.run });
  assert.equal(r.code, 0, r.said);
  assert.equal(r.said, "09:30 in Denver is 17:30 in Paris.");
  assert.ok(d.calls.some((c) => c.includes("tenants key local --label local-caller")), "the caller's key is made the first time");
  const admit = d.calls.findIndex((c) => c === `docker exec agentmesh-local-time-zone-converter sh -c HOME=/data/home agentmesh contacts admit ${CALLER}`);
  const send = d.calls.findIndex((c) => c.includes(`TRY_TO=${ID}`));
  assert.ok(admit >= 0 && admit < send, "the agent lets the caller in before the message is sent");
  assert.ok(d.seen.caller.includes("TRY_TEXT=09:30 Denver to Paris") && d.seen.caller.includes("agentmesh-local-caller:/data"));
  assert.deepEqual(JSON.parse(readFileSync(join(home, "caller.json"), "utf8")), { id: CALLER });
  const again = docker();
  await tryIt(folder(), { text: "again", env: { ADLC_LOCAL_HOME: home }, run: again.run });
  assert.ok(!again.calls.some((c) => c.includes("tenants key")), "the caller keeps the credential its first key was traded for");
});

test("status and down say what runs and stop it", async () => {
  const home = tmp("adlc-local-home-");
  mkdirSync(join(home, "ams"), { recursive: true });
  writeFileSync(join(home, "mesh.json"), "{}");
  const d = docker();
  const s = await status({ env: { ADLC_LOCAL_HOME: home }, run: d.run, fetcher: answering });
  assert.match(s.said, /The local mesh runs[\s\S]*time-zone-converter: Up 2 minutes/);
  const r = await down({ env: { ADLC_LOCAL_HOME: home }, run: d.run });
  assert.equal(r.code, 0);
  assert.ok(d.calls.includes("docker rm -f c0ffee") && d.calls.includes("docker compose -p agentmesh-local down"));
  assert.ok(!existsSync(join(home, "mesh.json")));
});

test("the bridge hands the adapter's message to the entrypoint as an inbox entry, and returns its reply or why there is none", () => {
  assert.deepEqual(entryOf("09:30 Denver to Paris", { AGENTMESH_FROM: ID, AGENTMESH_MESSAGE_ID: "m1" }),
    { id: "m1", from: ID, handle: ID, text: "09:30 Denver to Paris", in_reply_to: null, kind: "request", files: [] });
  const job = tmp("adlc-job-");
  assert.match(replyOf(3, job), /nothing to say/);
  assert.match(replyOf(2, job), /exited 2/);
  writeFileSync(join(job, "reply.txt"), "17:30 in Paris.\n");
  assert.equal(replyOf(0, job), "17:30 in Paris.");
});
