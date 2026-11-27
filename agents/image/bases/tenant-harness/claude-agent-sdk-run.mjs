#!/usr/bin/env node
// The Claude Agent SDK as a harness (docs/harness-contract.md in the
// AgentMesh repository): one framed prompt in, the work's words out.
//
// It meets the contract's four parts this way:
//   1. the package: a plugin made for Claude Code is loaded as one
//      ({type: "local"}), so its skills, commands and sub-agents work as they
//      were built to; its MCP servers come only from the package's mcp.json
//      (strictMcpConfig), which the platform wrote for the try;
//   2. one message in, one delivery out: the prompt is the one argument, the
//      work files in MESH_JOB_DIR, and the final words are printed for the
//      runner to use when nothing was filed;
//   3. the model only through the tenant model door: ANTHROPIC_BASE_URL is the
//      door, the key a placeholder, and no telemetry, error reports, update
//      checks or other traffic (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC);
//   4. inside what it is given: no settings from disk, all hooks off, nobody
//      asked (dontAsk: what is not allowed is refused), files only in its home,
//      the job folder, the declared directories, PLUGIN_DATA and /tmp, and no
//      server-side web search, which would reach the web around the egress door.
//
//   environment: ANTHROPIC_BASE_URL, AGENT_PACKAGE, MESH_JOB_DIR, AGENT_HOME,
//     PLUGIN_DATA, AGENT_DIRECTORY_<NAME>, AGENT_JOB_SECONDS, HARNESS_MODEL
//     (the name the door is asked for; it puts the House Stack model in),
//     HARNESS_MAX_TURNS, and MCP_<NAME>_TOKEN for a remote server the person
//     connected.
//   exit: 0 answered, 3 no answer.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The tools the work may use without asking. A tool not here is refused,
 *  because nobody is there to answer (dontAsk). Writing files is not among
 *  them: it is allowed only in the directories it was given (editRules). */
export const ALLOWED = ["Read", "Glob", "Grep", "LS", "Bash", "WebFetch", "TodoWrite", "Task", "Skill", "SlashCommand"];

/** Writing files (Edit, Write, MultiEdit and NotebookEdit all answer to Edit
 *  rules), only under the directories it was given; "//" starts a rule at the
 *  filesystem root. A bare "Write" would allow it everywhere: the contract
 *  check caught that, a write to /opt going through. */
export function editRules(dirs) {
  return [...new Set(dirs.filter(Boolean).map((d) => String(d).replace(/\/+$/, "")))].map((d) => `Edit(/${d}/**)`);
}

/** Removed outright: web search runs on the model's side and would reach the
 *  web without passing the egress door. */
export const DISALLOWED = ["WebSearch"];

const envName = (server) => `MCP_${String(server).toUpperCase().replace(/[^A-Z0-9]/g, "_")}_TOKEN`;

/** The package's mcp.json (Agent Plugins 1.0.0, Section 7.2) as the SDK's
 *  servers: a remote server over HTTPS, with the person's token when they
 *  connected one, and a program inside the package, its paths spelled from
 *  ${PLUGIN_ROOT} and ${PLUGIN_DATA}. Anything else is left out. */
export function mcpServersFrom(pkg, env = process.env, read = (f) => readFileSync(f, "utf8")) {
  let doc;
  try { doc = JSON.parse(read(join(pkg, "mcp.json"))); } catch { return {}; }
  const out = {};
  const expand = (s) => String(s).replaceAll("${PLUGIN_ROOT}", pkg).replaceAll("${PLUGIN_DATA}", env.PLUGIN_DATA ?? "");
  for (const [name, s] of Object.entries(doc?.mcpServers ?? {})) {
    if (!s || typeof s !== "object") continue;
    if (typeof s.url === "string") {
      let u;
      try { u = new URL(s.url); } catch { continue; }
      if (u.protocol !== "https:") continue;
      const token = env[envName(name)];
      out[name] = { type: s.type === "sse" ? "sse" : "http", url: s.url, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
    } else if (typeof s.command === "string" && s.command && !/\s/.test(s.command)) {
      out[name] = {
        type: "stdio", command: s.command, args: (Array.isArray(s.args) ? s.args : []).map(expand),
        env: { ...Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, expand(v)])), PLUGIN_ROOT: pkg, PLUGIN_DATA: env.PLUGIN_DATA ?? "" },
      };
    }
  }
  return out;
}

/** The directories it may use besides its home. */
export function grantedDirs(env = process.env) {
  const dirs = [env.MESH_JOB_DIR, env.PLUGIN_DATA, "/tmp"];
  for (const [k, v] of Object.entries(env)) if (k.startsWith("AGENT_DIRECTORY_") && v) dirs.push(v);
  return [...new Set(dirs.filter(Boolean))];
}

/** The options for query(), from the environment. Pure, for the check. */
export function optionsFor(env = process.env) {
  const pkg = env.AGENT_PACKAGE || "/opt/agent/plugin";
  const servers = mcpServersFrom(pkg, env);
  const isClaudePlugin = existsSync(join(pkg, ".claude-plugin", "plugin.json"));
  return {
    cwd: env.AGENT_HOME || process.cwd(),
    model: env.HARNESS_MODEL || "house-stack",
    maxTurns: Math.max(1, Number(env.HARNESS_MAX_TURNS) || 60),
    settingSources: [],
    settings: { disableAllHooks: true },
    permissionMode: "dontAsk",
    allowedTools: [...ALLOWED, ...editRules([env.AGENT_HOME || process.cwd(), ...grantedDirs(env)]), ...Object.keys(servers).map((n) => `mcp__${n}`)],
    disallowedTools: DISALLOWED,
    additionalDirectories: grantedDirs(env),
    mcpServers: servers,
    strictMcpConfig: true,
    ...(isClaudePlugin ? { plugins: [{ type: "local", path: pkg }] } : {}),
    env: {
      ...env,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || "the-model-door-takes-no-key",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: env.HARNESS_MAX_OUTPUT_TOKENS || "16000",
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
  };
}

async function main() {
  const prompt = process.argv[2] ?? "";
  if (!prompt) { process.stderr.write("claude-agent-sdk-run: no prompt; the runner passes the framed message as the one argument\n"); process.exit(3); }
  if (!process.env.ANTHROPIC_BASE_URL) { process.stderr.write("claude-agent-sdk-run: ANTHROPIC_BASE_URL is not set, so there is no model door to call\n"); process.exit(3); }
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const abort = new AbortController();
  const seconds = Math.max(30, Number(process.env.AGENT_JOB_SECONDS) || 840);
  const timer = setTimeout(() => abort.abort(), seconds * 1000);
  let result = null;
  try {
    for await (const m of query({ prompt, options: { ...optionsFor(process.env), abortController: abort, stderr: (d) => process.stderr.write(d) } })) {
      if (m.type === "result") result = m;
    }
  } catch (e) {
    process.stderr.write(`claude-agent-sdk-run: ${e?.message ?? e}\n`);
  } finally {
    clearTimeout(timer);
  }
  if (!result) process.exit(3);
  if (typeof result.result === "string" && result.result.trim()) process.stdout.write(`${result.result.trim()}\n`);
  process.exit(result.subtype === "success" && !result.is_error ? 0 : 3);
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) await main();
