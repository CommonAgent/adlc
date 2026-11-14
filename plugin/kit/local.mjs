// The local AgentMesh: the Agent Messaging Server in Docker on this computer,
// and the agent built in this folder running beside it in a container of its
// own. Nothing here reaches an AgentMesh address or needs an account: the
// server is the open-source one, from its public images, and running the
// command is the person's approval, since it is their computer.
//
//   needs: node >= 22, git, docker (with Compose v2)
//   node .adlc/local.mjs up         start the local mesh (the first time, it fetches the server's compose files)
//   node .adlc/local.mjs put        build this agent's image and run it on the local mesh
//   node .adlc/local.mjs try [--text <words>]   send it one message and show the reply
//   node .adlc/local.mjs link --email <address> --name "<your name>" [--own-agent <name>] [--computer <words>] [--instance <url>]
//                                   link the local agents to AgentMesh, approved by the emailed link:
//                                   they are reached there by name while this computer is on
//   node .adlc/local.mjs try --via-agentmesh [--text <words>]   send it a message from your own agent on AgentMesh
//   node .adlc/local.mjs status     what runs
//   node .adlc/local.mjs down       stop it all (what the agents keep stays, on their volumes)
//
// Putting a new version of an agent that already runs here keeps its volume,
// so it is the same agent, with its records.
//
// A model, when the agent's code calls one, is reached with the person's own
// settings, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, taken
// from this shell's environment. They are handed to the container in a file
// only the person can read, which is removed once the container has started,
// and are never printed.
//
// Everything is kept under ADLC_LOCAL_HOME (default ~/.agentmesh-local).
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pack } from "./packer.mjs";
import { emit, needsHarness, readPackage, requiredVariables } from "./image/emit-image.mjs";
import { meshUrlsOf } from "./local/link.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The server release the local mesh runs, from its public images. */
export const SERVER = { repository: "agent-messaging/agent-messaging-server", tag: "server-v0.5.3", version: "0.5.3" };
/** The adapter release each container serves its agent with. */
export const ADAPTER = { version: "0.100.1", url: "https://storage.googleapis.com/agentmesh-releases/mesh-adapter-0.100.1.tgz" };
export const PROJECT = "agentmesh-local";
export const TENANT = "local";
/** Where this computer reaches the server, and where a container does. */
export const HOME_URL = "http://127.0.0.1:3005";
export const CONTAINER_HOME_URL = "http://host.docker.internal:3005";
const MODEL_VARS = ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL"];
const KEY_RE = /^am_\S+$/;
const AGENT_ID_RE = /\b(U[A-Z2-7]{55})\b/;

/** The kit's own files that go into the agent's image, beside the package. */
export const LOCAL_FILES = ["bridge.mjs", "start.sh"];
/** Text with LF line endings, whatever the checkout gave it. */
export const lf = (text) => String(text).replace(/\r\n/g, "\n");

export const localHome = (env = process.env) => resolve(env.ADLC_LOCAL_HOME || join(homedir(), ".agentmesh-local"));
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

export function runCommand(cmd, args, { cwd, timeout = 1_800_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout, maxBuffer: 64 << 20 });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? r.error?.message ?? "") };
}
const tail = (r) => String(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ");

/** The compose folder of the server's clone, and the commands run in it. */
function server(home, run) {
  const dir = join(home, "ams", "deploy", "compose", "nats");
  const compose = (args, opts) => run("docker", ["compose", "-p", PROJECT, ...args], { cwd: dir, ...opts });
  const admin = (args) => compose(["exec", "-T", "server", "/entrypoint.sh", "mesh-admin", ...args]);
  return { dir, compose, admin };
}

/** The server's environment file: its public images, and the addresses an
 *  agent's credential carries, which a container reaches the host by. */
export function serverEnv() {
  return [
    `SERVER_IMAGE=ghcr.io/agent-messaging/agent-messaging-server:${SERVER.version}`,
    `GATEWAY_IMAGE=ghcr.io/agent-messaging/agent-messaging-a2a-gateway:${SERVER.version}`,
    "MESH_NATS_ENDPOINTS=nats://host.docker.internal:4222,ws://host.docker.internal:4443",
    `MESH_PUBLIC_URL=${CONTAINER_HOME_URL}`,
    "GATEWAY_PUBLIC_URL=http://localhost:8090",
    "",
  ].join("\n");
}

async function answers(fetcher) {
  try {
    const r = await fetcher(`${HOME_URL}/v1/capabilities`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Start the local mesh, and say what it is. */
export async function up({ env = process.env, run = runCommand, fetcher = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = 240_000 } = {}) {
  if (run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 30_000 }).status !== 0) {
    return { code: 1, said: "Docker does not answer. Start Docker, then run this again." };
  }
  const home = localHome(env);
  mkdirSync(home, { recursive: true });
  const ams = join(home, "ams");
  if (!existsSync(join(ams, "deploy", "compose", "nats"))) {
    const got = run("git", ["clone", "--quiet", "--depth", "1", "--branch", SERVER.tag, `https://github.com/${SERVER.repository}.git`, ams]);
    if (got.status !== 0) return { code: 1, said: `The server's compose files could not be fetched: ${tail(got)}` };
  }
  const s = server(home, run);
  writeFileSync(join(s.dir, ".env"), serverEnv());
  const started = s.compose(["up", "-d"]);
  if (started.status !== 0) return { code: 1, said: `The local mesh did not start: ${tail(started)}` };
  const until = Date.now() + waitMs;
  let caps = await answers(fetcher);
  while (!caps && Date.now() < until) { await sleep(3000); caps = await answers(fetcher); }
  if (!caps) return { code: 1, said: `The local mesh started, and its server does not answer at ${HOME_URL}. See: docker compose -p ${PROJECT} logs server` };
  s.admin(["tenants", "create", TENANT]);
  writeFileSync(join(home, "mesh.json"), JSON.stringify({ server: SERVER.version, home: HOME_URL }, null, 2) + "\n");
  return { code: 0, said: `The local AgentMesh runs: Agent Messaging Server ${SERVER.version} at ${HOME_URL}, in Docker on this computer.` };
}

/** A single-use agent key from the local mesh. */
export function mintKey(label, { env = process.env, run = runCommand } = {}) {
  const r = server(localHome(env), run).admin(["tenants", "key", TENANT, "--label", label]);
  const key = r.stdout.split("\n").map((l) => l.trim()).find((l) => KEY_RE.test(l));
  return key ?? null;
}

/** Why this package cannot run on the local mesh yet, or an empty list. */
export function localProblems(install, packageName) {
  const needs = requiredVariables(install);
  const out = [];
  for (const c of needs.credentials) out.push(`a credential for ${c.name}`);
  for (const c of needs.settings) out.push(`the setting ${c.env}`);
  for (const c of needs.mcp) out.push(`a tool server for ${c.name}`);
  for (const c of needs.ceilings) out.push(`a spending ceiling for ${c.name}`);
  const asks = out.length ? [`it asks for ${out.join(", ")}, and the local mesh does not hand an agent anything but its own key and your model settings yet`] : [];
  if (needsHarness(install, { packageName })) asks.push("some of its work is left to a harness, and the local mesh runs none yet; each of its jobs needs a command of its own");
  return asks;
}

/** The Dockerfile lines that put the adapter and the bridge on the package's image. */
export function localLayer() {
  return [
    "",
    "# The local AgentMesh (node .adlc/local.mjs): the adapter serves the agent,",
    "# and runs the bridge for each message, which hands it to the entrypoint.",
    "USER root",
    `RUN npm install -g --no-audit --no-fund ${ADAPTER.url} && mkdir -p /data && chown agent:agent /data`,
    "COPY local/ /opt/local/",
    "USER agent",
    'ENTRYPOINT ["sh", "/opt/local/start.sh"]',
    "",
  ].join("\n");
}

export const containerOf = (name) => `${PROJECT}-${name}`;
export const volumeOf = (name) => `${PROJECT}-${name}`;

/** The environment file the agent's container starts with: its key (used once),
 *  the mesh's address, its name, where its directories are, and the person's
 *  model settings. */
export function runEnv({ name, key, directories, env }) {
  const lines = [`LOCAL_AGENT_KEY=${key}`, `LOCAL_MESH_HOME=${CONTAINER_HOME_URL}`, `AGENT_NAME=${name}`];
  for (const d of directories) lines.push(`${d.env}=/data/${d.name}`);
  for (const v of MODEL_VARS) if (typeof env[v] === "string" && env[v] !== "") lines.push(`${v}=${env[v]}`);
  return `${lines.join("\n")}\n`;
}

/** Build this folder's agent and run it on the local mesh. */
export async function put(dir, { env = process.env, run = runCommand, packer = pack, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = 120_000, localDir = join(HERE, "local") } = {}) {
  const home = localHome(env);
  if (!existsSync(join(home, "mesh.json"))) return { code: 1, said: "The local mesh is not running. Run node .adlc/local.mjs up first." };
  const plugin = readJson(join(dir, "plugin.json")) ?? {};
  const name = String(plugin.name ?? "");
  const version = String(plugin.version ?? "0.0.0");
  if (!name) return { code: 1, said: "This folder has no plugin.json naming the agent; build it first (node .adlc/check.mjs)." };
  const work = join(home, "agents", name);
  rmSync(join(work, "build"), { recursive: true, force: true });
  mkdirSync(join(work, "build"), { recursive: true });
  const packed = packer(dir, { out: join(work, "build", "pack") });
  if (!packed.ok) return { code: 1, said: `The packer did not make a package: ${packed.refused}` };
  let pkg;
  try { pkg = readPackage(packed.package_dir); } catch (e) { return { code: 1, said: `The package does not hold together: ${e.message}` }; }
  const problems = localProblems(pkg.install, pkg.name);
  if (problems.length) return { code: 1, said: `It can't run on the local mesh yet:\n${problems.map((p) => `  - ${p}`).join("\n")}` };
  const ctx = join(work, "build", "ctx");
  let emitted;
  try { emitted = emit(packed.package_dir, ctx, { bases: join(HERE, "local", "bases.json"), force: true }); } catch (e) { return { code: 1, said: `Its image could not be laid out: ${e.message}` }; }
  mkdirSync(join(ctx, "local"), { recursive: true });
  // Git on Windows may have checked these out with CRLF line endings, which
  // sh in the container cannot read (`set -eu\r` is an illegal option, and
  // the container restarts forever); they go into the image with LF.
  for (const f of LOCAL_FILES) writeFileSync(join(ctx, "local", f), lf(readFileSync(join(localDir, f), "utf8")));
  writeFileSync(join(ctx, "Dockerfile"), `${readFileSync(join(ctx, "Dockerfile"), "utf8")}${localLayer()}`);
  const image = `${PROJECT}/${name}:${version}`;
  const built = run("docker", ["build", "-q", "-t", image, ctx]);
  if (built.status !== 0) return { code: 1, said: `Its image did not build: ${tail(built)}` };

  // An agent that ran here before keeps its volume: its records and the
  // credential its first key was traded for, so a new version is the same
  // agent and needs no key. A first run gets one.
  const before = readJson(join(work, "agent.json"));
  const kept = !!before?.id && run("docker", ["volume", "inspect", volumeOf(name)], { timeout: 30_000 }).status === 0;
  const key = kept ? "" : mintKey(`${name}-${version}`, { env, run });
  if (!kept && !key) return { code: 1, said: "The local mesh would not make an agent key. Is it running? node .adlc/local.mjs status" };
  run("docker", ["rm", "-f", containerOf(name)], { timeout: 60_000 });
  const envFile = join(work, "run.env");
  writeFileSync(envFile, runEnv({ name, key, directories: emitted.record.needed_at_run_time.directories, env }), { mode: 0o600 });
  try { chmodSync(envFile, 0o600); } catch { /* the mode above stands where chmod does not apply */ }
  let started;
  try {
    started = run("docker", ["run", "-d", "--name", containerOf(name), "--label", `${PROJECT}=agent`, "--restart", "unless-stopped",
      "--add-host", "host.docker.internal:host-gateway", "-v", `${volumeOf(name)}:/data`, "--env-file", envFile, image]);
  } finally { rmSync(envFile, { force: true }); }
  if (started.status !== 0) return { code: 1, said: `Its container did not start: ${tail(started)}` };
  const until = Date.now() + waitMs;
  let id = null;
  while (!id && Date.now() < until) {
    const logs = run("docker", ["logs", containerOf(name)], { timeout: 30_000 });
    const m = AGENT_ID_RE.exec(`${logs.stdout}\n${logs.stderr}`);
    if (m) id = m[1]; else await sleep(2000);
  }
  if (!id) return { code: 1, said: `It started, and did not say which agent it is in ${Math.round(waitMs / 1000)} seconds. See: docker logs ${containerOf(name)}` };
  writeFileSync(join(work, "agent.json"), JSON.stringify({ name, version, id, image, container: containerOf(name) }, null, 2) + "\n");
  const model = MODEL_VARS.filter((v) => env[v]).length ? " with your model settings" : "";
  return { code: 0, said: `${name} ${version} runs on the local mesh as ${id}${model}. Send it a message with node .adlc/local.mjs try --text "<words>".`, id };
}

/** The caller's commands, in a container of the same image so nothing on this
 *  computer is touched: its own key the first time, kept on its volume. With
 *  no message to send it says who it is. */
export function callerScript() {
  return [
    "set -eu", "export HOME=/data/home", "mkdir -p \"$HOME\"",
    "if [ ! -s \"$HOME/.agentmesh/adapter/mesh.creds\" ]; then agentmesh mesh-home set \"$LOCAL_MESH_HOME\" >/dev/null; agentmesh bootstrap \"$LOCAL_AGENT_KEY\" >/dev/null; fi",
    "if [ -z \"${TRY_TO:-}\" ]; then exec agentmesh identity me --json; fi",
    "agentmesh messages send \"$TRY_TO\" \"$TRY_TEXT\" --wait 90",
  ].join("\n");
}

/** The caller's agent id, from what `identity me --json` printed. */
export function callerIdOf(stdout) {
  try { const d = JSON.parse(stdout); return String(d.agent_id ?? d.agent?.id ?? "") || null; } catch { return null; }
}

/** Send the running agent one message from the local caller, and show the reply. */
export async function tryIt(dir, { text, env = process.env, run = runCommand } = {}) {
  const home = localHome(env);
  const name = String((readJson(join(dir, "plugin.json")) ?? {}).name ?? "");
  const agent = readJson(join(home, "agents", name, "agent.json"));
  if (!agent?.id) return { code: 1, said: "It does not run on the local mesh yet. Run node .adlc/local.mjs put first." };
  const caller = join(home, "caller.json");
  let known = readJson(caller);
  const callerRun = (extra) => run("docker", ["run", "--rm", "--add-host", "host.docker.internal:host-gateway", "-v", `${PROJECT}-caller:/data`,
    "-e", `LOCAL_MESH_HOME=${CONTAINER_HOME_URL}`, ...extra, "--entrypoint", "sh", agent.image, "-c", callerScript()], { timeout: 240_000 });
  if (!known?.id) {
    const key = mintKey("local-caller", { env, run });
    if (!key) return { code: 1, said: "The local mesh would not make the caller's key. Is it running? node .adlc/local.mjs status" };
    const id = callerIdOf(callerRun(["-e", `LOCAL_AGENT_KEY=${key}`]).stdout);
    if (!id) return { code: 1, said: "The local caller could not join the local mesh. See: node .adlc/local.mjs status" };
    known = { id };
    writeFileSync(caller, JSON.stringify(known, null, 2) + "\n");
  }
  // The agent holds a stranger's message at its door, as every agent does;
  // the caller is the person's own, so it is let in, and nobody else is.
  const admitted = run("docker", ["exec", agent.container ?? containerOf(name), "sh", "-c", `HOME=/data/home agentmesh contacts admit ${known.id}`], { timeout: 60_000 });
  if (admitted.status !== 0) return { code: 1, said: `The agent would not let your local caller in: ${tail(admitted)}` };
  const words = String(text ?? "").trim() || "Hello. What can you do?";
  const r = callerRun(["-e", "LOCAL_AGENT_KEY=", "-e", `TRY_TO=${agent.id}`, "-e", `TRY_TEXT=${words}`]);
  if (r.status !== 0) return { code: 1, said: `The message did not go through: ${tail(r)}` };
  return { code: 0, said: r.stdout.trim() };
}

// ── The link to a public AgentMesh (Agent Messaging §21.8 to §21.13) ─────

/** The public AgentMesh a link goes to unless --instance names another. */
export const PUBLIC_API = "https://api.agentmesh.ai";
export const LINK_CONTAINER = `${PROJECT}-link`;
const LINK_IMAGE = `${PROJECT}/link`;
/** Where a linked agent's key is, inside the link's container. */
export const identityPathOf = (name) => `/agents/${name}/home/.agentmesh/adapter/identity.json`;

/** The agents on the local mesh: each one put here, and the local caller. */
export function localAgents(home) {
  const out = [];
  let names = [];
  try { names = readdirSync(join(home, "agents")); } catch { names = []; }
  for (const n of names) {
    const a = readJson(join(home, "agents", n, "agent.json"));
    if (a?.id && a.name) out.push({ name: a.name, id: a.id, volume: volumeOf(a.name), container: a.container ?? containerOf(a.name) });
  }
  const caller = readJson(join(home, "caller.json"));
  if (caller?.id) out.push({ name: "caller", id: caller.id, volume: `${PROJECT}-caller`, container: null });
  return out;
}

/** The `docker run` arguments of the link's container. */
export function linkRunArgs({ image, api, mesh, agents }) {
  const config = { api, mesh, local: "ws://host.docker.internal:4443", agents: agents.map((a) => ({ name: a.name, id: a.id, identity: identityPathOf(a.name) })) };
  return ["run", "-d", "--name", LINK_CONTAINER, "--label", `${PROJECT}=agent`, "--restart", "unless-stopped",
    "--add-host", "host.docker.internal:host-gateway", "-v", `${PROJECT}-link:/data`, "-v", `${PROJECT}_config:/config:ro`,
    ...agents.flatMap((a) => ["-v", `${a.volume}:/agents/${a.name}:ro`]),
    "-e", `LINK_CONFIG=${JSON.stringify(config)}`, image];
}

async function linkCall(fetcher, url, init = {}, timeoutMs = 30_000) {
  try {
    const r = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch (e) { return { status: 0, body: { error: `AgentMesh did not answer at ${url}: ${e.message}` } }; }
}

/**
 * Link the local mesh's agents to a public AgentMesh: file them with an email
 * address, wait for the person to press the button in the email (or, with
 * AGENTMESH_DEPLOY_KEY for the platform's own addresses, at once), then start
 * the link's container and let the person's own agent on AgentMesh in.
 */
export async function link({ email, name, computer, ownAgent, instance, env = process.env, run = runCommand, fetcher = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = 540_000, localDir = join(HERE, "local") } = {}) {
  const home = localHome(env);
  if (!existsSync(join(home, "mesh.json"))) return { code: 1, said: "The local mesh is not running. Run node .adlc/local.mjs up first." };
  const agents = localAgents(home);
  if (!agents.length) return { code: 1, said: "No agent runs on the local mesh yet, so there is nothing to link. Put one first: node .adlc/local.mjs put" };
  const api = String(instance || PUBLIC_API).replace(/\/+$/, "");
  const savedFile = join(home, "link.json");
  let saved = readJson(savedFile);
  const sameAgents = saved?.api === api && JSON.stringify(saved?.keys ?? []) === JSON.stringify(agents.map((a) => a.id));
  const newOwnAgent = !!ownAgent && ownAgent !== saved?.own_agent;
  if (!saved?.ticket || !sameAgents || newOwnAgent || saved.state === "refused" || saved.state === "expired") {
    if (!email || !name) return { code: 2, said: 'Say where the approval goes and your public name: node .adlc/local.mjs link --email <address> --name "<your name>"' };
    const key = env.AGENTMESH_DEPLOY_KEY;
    const filed = await linkCall(fetcher, `${api}/v1/link/by-email`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ email, name, computer: computer || "this computer", ...(ownAgent ? { own_agent: ownAgent } : {}), agents: agents.map((a) => ({ name: a.name, key: a.id })) }),
    });
    if (filed.status !== 202) return { code: 1, said: `AgentMesh did not take the link: ${filed.body.error ?? `HTTP ${filed.status}`}` };
    saved = { api, ticket: filed.body.ticket, keys: agents.map((a) => a.id), ...(ownAgent ? { own_agent: ownAgent } : {}), state: filed.body.state ?? "waiting" };
    writeFileSync(savedFile, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600 });
    console.log(filed.body.says);
  }
  // Wait for the button.
  const until = Date.now() + waitMs;
  let st = await linkCall(fetcher, `${api}/v1/link/by-email/${saved.ticket}`);
  while (st.status === 200 && st.body.state === "waiting" && Date.now() < until) { await sleep(5000); st = await linkCall(fetcher, `${api}/v1/link/by-email/${saved.ticket}`); }
  if (st.status !== 200) return { code: 1, said: `AgentMesh could not say where the link stands: ${st.body.error ?? `HTTP ${st.status}`}` };
  saved = { ...saved, state: st.body.state };
  writeFileSync(savedFile, JSON.stringify(saved, null, 2) + "\n", { mode: 0o600 });
  if (st.body.state === "waiting") return { code: 3, said: "The button in the email has not been pressed yet. Once it is, run this again: node .adlc/local.mjs link" };
  if (st.body.state !== "linked") return { code: 1, said: st.body.says ?? st.body.refusal ?? "It was not linked." };
  const mesh = meshUrlsOf(st.body.mesh);
  if (!mesh.length) return { code: 1, said: "AgentMesh linked the agents and did not say where the link connects." };
  const joined = (st.body.agents ?? []).filter((a) => !a.refusal);
  const carried = agents.filter((a) => joined.some((j) => j.key === a.id));

  // The link's container.
  const ctx = join(home, "link", "build");
  rmSync(ctx, { recursive: true, force: true });
  mkdirSync(ctx, { recursive: true });
  writeFileSync(join(ctx, "link.mjs"), lf(readFileSync(join(localDir, "link.mjs"), "utf8")));
  writeFileSync(join(ctx, "Dockerfile"), lf(readFileSync(join(localDir, "link.Dockerfile"), "utf8")));
  const image = `${LINK_IMAGE}:latest`;
  const built = run("docker", ["build", "-q", "-t", image, ctx]);
  if (built.status !== 0) return { code: 1, said: `The link's image did not build: ${tail(built)}` };
  run("docker", ["rm", "-f", LINK_CONTAINER], { timeout: 60_000 });
  const started = run("docker", linkRunArgs({ image, api, mesh, agents: carried }));
  if (started.status !== 0) return { code: 1, said: `The link's container did not start: ${tail(started)}` };
  // The person's own agent on AgentMesh may write to their local agents, as
  // the local caller may: it is theirs.
  if (st.body.own_agent_key) {
    for (const a of carried) if (a.container) run("docker", ["exec", a.container, "sh", "-c", `HOME=/data/home agentmesh contacts admit ${st.body.own_agent_key}`], { timeout: 60_000 });
  }
  const upUntil = Date.now() + 120_000;
  let logs = "";
  while (Date.now() < upUntil) {
    const l = run("docker", ["logs", LINK_CONTAINER], { timeout: 30_000 });
    logs = `${l.stdout}\n${l.stderr}`;
    if (/\[link\] (linked:|stopped:)/.test(logs)) break;
    await sleep(2000);
  }
  if (!/\[link\] linked:/.test(logs)) return { code: 1, said: `The link started, and did not say it is linked. See: docker logs ${LINK_CONTAINER}\n${logs.trim().split("\n").slice(-5).join("\n")}` };
  const handles = joined.map((a) => `  ${a.handle ?? a.name}`).join("\n");
  const not = (st.body.agents ?? []).filter((a) => a.refusal).map((a) => `  ${a.name}: ${a.refusal}`);
  return { code: 0, said: [`The local mesh is linked to ${api.replace(/^https?:\/\/api\./, "")}. These agents can be reached there by name while this computer is on:`, handles, ...(not.length ? ["Not linked:", ...not] : [])].join("\n") };
}

/** Send this folder's agent one message from the person's own agent on the
 *  public AgentMesh, carried down the link, and show the reply carried up. */
export async function tryFromPublic(dir, { text, env = process.env, fetcher = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = 120_000 } = {}) {
  const home = localHome(env);
  const saved = readJson(join(home, "link.json"));
  if (!saved?.ticket || saved.state !== "linked") return { code: 1, said: "The local mesh is not linked to AgentMesh. Link it first: node .adlc/local.mjs link --email <address> --name \"<your name>\"" };
  const name = String((readJson(join(dir, "plugin.json")) ?? {}).name ?? "");
  const words = String(text ?? "").trim() || "Hello. What can you do?";
  const sent = await linkCall(fetcher, `${saved.api}/v1/link/by-email/${saved.ticket}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: name, text: words }) }, 120_000);
  if (sent.status !== 200 && sent.status !== 202) return { code: 1, said: `AgentMesh did not send it: ${sent.body.error ?? `HTTP ${sent.status}`}` };
  // The test waits for the answer, and usually brings it back itself.
  if (sent.body.reply?.text) return { code: 0, said: `${sent.body.to} answered, through AgentMesh:\n${sent.body.reply.text}` };
  if (sent.body.ok === false && !/no response|offline|AGENT_UNAVAILABLE/i.test(String(sent.body.error ?? ""))) return { code: 1, said: `AgentMesh did not send it: ${sent.body.error}` };
  const since = sent.body.sent_at;
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const r = await linkCall(fetcher, `${saved.api}/v1/link/by-email/${saved.ticket}/replies?to=${encodeURIComponent(name)}&since=${encodeURIComponent(since)}`);
    const reply = (r.body.replies ?? [])[0];
    if (reply) return { code: 0, said: `${sent.body.to} answered, through AgentMesh:\n${reply.text}` };
    await sleep(3000);
  }
  return { code: 1, said: `${sent.body.to} did not answer within ${Math.round(waitMs / 1000)} seconds. See: docker logs ${LINK_CONTAINER}` };
}

/** What runs on the local mesh. */
export async function status({ env = process.env, run = runCommand, fetcher = fetch } = {}) {
  const caps = await answers(fetcher);
  const ps = run("docker", ["ps", "--filter", `label=${PROJECT}=agent`, "--format", "{{.Names}}\t{{.Status}}"], { timeout: 30_000 });
  const agents = ps.stdout.trim().split("\n").filter(Boolean).map((l) => `  ${l.replace(`${PROJECT}-`, "").replace("\t", ": ")}`);
  return {
    code: caps ? 0 : 1,
    said: [caps ? `The local mesh runs at ${HOME_URL} (Agent Messaging Server ${SERVER.version}).` : "The local mesh is not running. Start it with node .adlc/local.mjs up.",
      ...(agents.length ? ["Agents:", ...agents] : caps ? ["No agent runs on it yet."] : [])].join("\n"),
  };
}

/** Stop the local mesh and its agents. What they keep stays on their volumes. */
export async function down({ env = process.env, run = runCommand } = {}) {
  const home = localHome(env);
  const ps = run("docker", ["ps", "-aq", "--filter", `label=${PROJECT}=agent`], { timeout: 30_000 });
  const ids = ps.stdout.trim().split("\n").filter(Boolean);
  if (ids.length) run("docker", ["rm", "-f", ...ids], { timeout: 120_000 });
  if (existsSync(join(home, "ams"))) server(home, run).compose(["down"]);
  rmSync(join(home, "mesh.json"), { force: true });
  return { code: 0, said: "The local mesh is stopped." };
}

const flag = (argv, name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv;
  const dir = resolve(join(HERE, ".."));
  const what = argv[2];
  const job = what === "up" ? up()
    : what === "put" ? put(dir)
    : what === "try" && argv.includes("--via-agentmesh") ? tryFromPublic(dir, { text: flag(argv, "--text") })
    : what === "try" ? tryIt(dir, { text: flag(argv, "--text") })
    : what === "link" ? link({ email: flag(argv, "--email"), name: flag(argv, "--name"), computer: flag(argv, "--computer"), ownAgent: flag(argv, "--own-agent"), instance: flag(argv, "--instance") })
    : what === "status" ? status()
    : what === "down" ? down()
    : Promise.resolve({ code: 2, said: "usage: node .adlc/local.mjs up | put | try [--text <words>] [--via-agentmesh] | link --email <address> --name \"<your name>\" [--own-agent <name>] [--computer <words>] [--instance <url>] | status | down" });
  job.then((r) => { console.log(r.said); process.exitCode = r.code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
