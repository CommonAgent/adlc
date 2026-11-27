// The configuration the harness gives opencode for one message: which
// directories outside the agent's home this container may touch, and the
// host's model gateway when the model is one (gatewayProvider).
//
// WHY THIS EXISTS. opencode treats anything outside its project directory as
// an external directory and asks before reading or writing it. Nobody is there
// to answer in a container, so it auto-rejects, and the critic's first real run
// on Cloud Run ended with "Read /mesh/jobs/explainer-critic/critic-run-1/
// script.json failed: the user rejected permission" and no review at all. On a
// host the question never comes up: the fleet's job folders and record
// directories sit under the agent's own home, which is the project directory.
// In a container they are on a mount, because 12.7.1 wants storage that
// outlives a single run and a container's filesystem outlives nothing, so they
// are outside the home by construction.
//
// IT GRANTS THE BOUND DIRECTORIES AND NOT THE MOUNT. One bucket serves the
// whole fleet, so /mesh also holds every other agent's records and every other
// agent's job folders. A blanket allow on external directories would hand all
// of them to whichever agent happened to be reading, which is a worse failure
// than the one it fixes and a silent one. What this grants is the job folder
// for THIS message and the directories this deployment bound for THIS agent,
// by name, out of the same variables the entrypoint reads. Every other
// external directory is denied outright rather than asked about, and
// configFor says why the difference ends or saves a run.
//
// It is a file of its own rather than a line inside the harness script so that
// the base's build can run it and check what it produced, and so a test can
// read the rule without a container.
//
//   node opencode-config.mjs      prints the configuration as JSON
import { readFileSync } from "node:fs";

export const SCHEMA = "https://opencode.ai/config.json";

const trimmed = (p) => String(p).replace(/\/+$/, "");

/** Every directory this container was told to use that is not under the
 *  agent's home: the job folder for this message, and one per directory role
 *  the install file declares (12.7.1). Read from the environment and never
 *  guessed: a path guessed from a name is a path the deployment did not bind,
 *  and granting it would be granting somebody else's folder. */
export function boundDirectories(env = process.env) {
  const out = [];
  if (env.MESH_JOB_DIR) out.push(env.MESH_JOB_DIR);
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("AGENT_DIRECTORY_") && value) out.push(value);
  }
  // The agent's own state folder on the mount, which holds its package
  // beside its directories. It is derived and never guessed: only when a
  // bound directory sits under <mount>/state/<this agent's name>/ is that
  // parent granted, and it is this agent's folder by construction. Without
  // it, a model reading its own skill file at /mesh/state/code-writer/... was
  // refused and delivered nothing (code-writer, 2026-09-22).
  const name = String(env.AGENT_NAME ?? "").trim();
  if (name) {
    for (const dir of out.map(trimmed)) {
      const m = /^(.*\/state\/)([^/]+)\/[^/]+$/.exec(dir);
      if (m && m[2] === name) out.push(`${m[1]}${name}`);
    }
  }
  // A try in the tenant sandbox (HARNESS_READS_MCP_JSON): the plugin it runs,
  // outside its home and read only in the image, and the plugin's own data
  // folder (Agent Plugins 1.0.0, Section 9). The contract check caught the
  // first: opencode refused to read the plugin's own skill.
  if (env.HARNESS_READS_MCP_JSON === "1") {
    if (env.AGENT_PACKAGE) out.push(env.AGENT_PACKAGE);
    if (env.PLUGIN_DATA) out.push(env.PLUGIN_DATA);
  }
  return [...new Set(out.map(trimmed).filter(Boolean))].sort();
}

/** The configuration, as opencode reads it from OPENCODE_CONFIG_CONTENT.
 *
 *  Three spellings per directory, because opencode does not ask about the file
 *  it is opening: it asks about the file's parent with a star after it. So a
 *  grant on the directory alone does not cover a file inside it, and a grant on
 *  its immediate children does not cover the per-job folder the critic makes
 *  under its records directory.
 *
 *  THE CATCH-ALL IS A DENY, AND IT COMES FIRST. A directory nobody bound must
 *  still be refused, and it used to be refused by leaving opencode's own
 *  default in place, which is to ask. That turned out to be the wrong kind of
 *  refusal. `opencode run` has nobody to ask, so it answers every question
 *  itself with a rejection (cli/cmd/run.ts:801-819 in 1.18.30), and a
 *  rejected question stops the whole run (session/processor.ts:200 marks the
 *  turn blocked and :694 stops on it). A denied rule is different: the tool
 *  fails with an ordinary error the model reads, and the model carries on
 *  with the folders it was given. Converted agents on 2026-09-24 globbed
 *  /mesh looking for their files, were auto-rejected, and exited 3 with
 *  nothing delivered. With the deny they would have been told no and gone on.
 *
 *  The order is the rule. opencode takes the LAST rule that matches and keeps
 *  the keys in the order they are written, so "*" goes first and every allow
 *  after it wins over it. Written the other way round, the deny would win over
 *  the allows and the job folder itself would be refused.
 *
 *  What the grant allows is unchanged: /tmp and the bound directories, three
 *  spellings each. What the deny takes away from opencode's own defaults is
 *  nothing it needs in a container. Its rules come before these, so the deny
 *  covers them, but the one for its truncated tool output is added again after
 *  everything configured (agent/agent.ts:297-310), and its data, config and
 *  skill folders are under HOME, which the entrypoint sets to the agent's home,
 *  the project directory, so they are never external in the first place. */
export function configFor(env = process.env) {
  // First, so that every allow below wins over it.
  const external = { "*": "deny" };
  // The container's own scratch space, which is nobody else's: a Cloud Run
  // task's /tmp is in its own memory and gone when the task ends. The
  // code-writer's first run (2026-09-22) staged the suite it was handed under
  // /tmp/SUITE, opencode asked about /tmp/SUITE/* along with the job folder,
  // nobody answered, and the whole request was refused: no scripts, no
  // delivery. Every package's scripts take a WORK or WORKSPACE directory and
  // a model left to choose one chooses /tmp.
  for (const dir of ["/tmp", ...boundDirectories(env)]) {
    external[dir] = "allow";
    external[`${dir}/*`] = "allow";
    external[`${dir}/**`] = "allow";
  }
  const provider = gatewayProvider(env);
  const mcp = mcpFromPackage(env);
  // A try in the tenant sandbox (HARNESS_READS_MCP_JSON): no update checks and
  // no sharing, which would reach the network around the egress door.
  const sandbox = env.HARNESS_READS_MCP_JSON === "1" ? { autoupdate: false, share: "disabled" } : {};
  return { $schema: SCHEMA, ...sandbox, ...(provider ? { provider } : {}), ...(mcp ? { mcp } : {}), permission: { external_directory: external } };
}

// THE PACKAGE'S MCP SERVERS, for a try in the tenant sandbox
// (docs/harness-contract.md in the AgentMesh repository). Only when the image
// says so (HARNESS_READS_MCP_JSON=1): the fleet's hosts write the servers into
// the harness's configuration at install, and this leaves them alone. The
// package's mcp.json (Agent Plugins 1.0.0, Section 7.2), which the platform
// wrote for the try, becomes opencode's: a remote server over HTTPS, with the
// person's token as its Authorization header when they connected one
// (MCP_<NAME>_TOKEN), and a program inside the package, its paths spelled from
// ${PLUGIN_ROOT} and ${PLUGIN_DATA}. Anything else is left out.
export const mcpTokenVar = (server) => `MCP_${String(server).toUpperCase().replace(/[^A-Z0-9]/g, "_")}_TOKEN`;

export function mcpFromPackage(env = process.env, read = (f) => readFileSync(f, "utf8")) {
  if (env.HARNESS_READS_MCP_JSON !== "1" || !env.AGENT_PACKAGE) return null;
  const pkg = trimmed(env.AGENT_PACKAGE);
  let doc;
  try { doc = JSON.parse(read(`${pkg}/mcp.json`)); } catch { return null; }
  const expand = (v) => String(v).replaceAll("${PLUGIN_ROOT}", pkg).replaceAll("${PLUGIN_DATA}", env.PLUGIN_DATA ?? "");
  const out = {};
  for (const [name, s] of Object.entries(doc?.mcpServers ?? {})) {
    if (!s || typeof s !== "object") continue;
    if (typeof s.url === "string") {
      let u;
      try { u = new URL(s.url); } catch { continue; }
      if (u.protocol !== "https:") continue;
      const token = env[mcpTokenVar(name)];
      out[name] = { type: "remote", url: s.url, enabled: true, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
    } else if (typeof s.command === "string" && s.command && !/s/.test(s.command)) {
      const args = (Array.isArray(s.args) ? s.args : []).map(expand);
      out[name] = { type: "local", command: [s.command, ...args], enabled: true, environment: { ...Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, expand(v)])), PLUGIN_ROOT: pkg, PLUGIN_DATA: env.PLUGIN_DATA ?? "" } };
    }
  }
  return Object.keys(out).length ? out : null;
}

// THE HOST'S MODEL GATEWAY (technical debt 619). Where the owner's instruction
// names no model, the deployment gives the harness the host's model setting
// as model-gateway/<model>, with MODEL_ENDPOINT and MODEL_PROTOCOL on the job
// (steps.py keyless_vars) and the job's own gateway on that loopback port.
// opencode knows no such provider until its configuration names one. The
// client opencode loads for each protocol, and the path Common Agent 12.4.1
// adds that the client does not add itself; the same table as install.py's
// GATEWAY_CLIENTS, which writes the host's configuration.
export const GATEWAY_PROVIDER = "model-gateway";
export const GATEWAY_CLIENTS = {
  "anthropic-messages": ["@ai-sdk/anthropic", "/v1"],
  "openai-chat": ["@ai-sdk/openai-compatible", "/v1"],
  gemini: ["@ai-sdk/google", ""],
};

/** The provider block naming the host's gateway, or null when the model is
 *  not one or the job was not told where the gateway is. Each variable is
 *  read by its exact name. */
/** The model's context and answer limits, when the deployment says them
 *  (MODEL_CONTEXT_TOKENS, MODEL_OUTPUT_TOKENS): opencode compacts a session
 *  before the context limit, which keeps a call under the model door's cap. */
export function limitOf(env = process.env) {
  const context = Number(env.MODEL_CONTEXT_TOKENS);
  const output = Number(env.MODEL_OUTPUT_TOKENS);
  return Number.isInteger(context) && context > 0 && Number.isInteger(output) && output > 0 ? { limit: { context, output } } : {};
}

export function gatewayProvider(env = process.env) {
  const model = String(env.AGENT_MODEL ?? "");
  if (!model.startsWith(`${GATEWAY_PROVIDER}/`)) return null;
  const endpoint = String(env.MODEL_ENDPOINT ?? "").trim().replace(/\/+$/, "");
  const client = GATEWAY_CLIENTS[String(env.MODEL_PROTOCOL ?? "").trim()];
  if (!endpoint || !client) return null;
  const name = model.slice(GATEWAY_PROVIDER.length + 1);
  return {
    [GATEWAY_PROVIDER]: {
      npm: client[0],
      name: "The host's model gateway",
      // The gateway takes no key; the client insists on one, so it is given a word that is not a key.
      options: { baseURL: endpoint + client[1], apiKey: "no-key-needed" },
      models: { [name]: { name, ...limitOf(env) } },
    },
  };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  process.stdout.write(JSON.stringify(configFor(process.env)));
}
