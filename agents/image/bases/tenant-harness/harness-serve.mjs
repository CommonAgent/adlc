#!/usr/bin/env node
// A harness, served for a try (docs/harness-contract.md in the AgentMesh
// repository; docs/try-mode-plan.md there, "Trial for plugins").
//
// WHY THIS EXISTS. A try runs an outside agent as one container with the
// tenant host and the mesh adapter on top, and the adapter hands each message
// to the agent's own server over HTTP (http-agent.mjs). A plugin has no
// server: it is skills, commands and MCP servers that a person's own tool
// runs. So the harness image it is tried in carries this one, which takes a
// message over HTTP, runs the harness once on it (the contract's one message
// in, one delivery out) and answers with what the work delivered.
//
//   GET  /health            200 when it can take a message
//   POST /message {text}     runs the harness once; answers {reply, files}
//
// The harness is the program the base names in AGENT_HARNESS_BIN (opencode's
// wrapper, or the Claude Agent SDK's runner), called with the framed prompt as
// its one argument, in a job folder of its own. What it files in the job
// folder is the delivery; what it printed is used only when it filed nothing.
//
//   needs: node >= 22, AGENT_HARNESS_BIN, AGENT_PACKAGE (the plugin, read only)
//   environment: HARNESS_PORT (default 8080), HARNESS_LABEL, AGENT_JOB_SECONDS
//     (default 900), and whatever the adapter gave the server: the model door
//     (ANTHROPIC_BASE_URL) and, once the person connected something, the
//     egress door as HTTPS_PROXY with the keys' settings.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { join, relative } from "node:path";

export const ANSWER_FILE = "answer.md";
export const OUT_DIR = "out";
const MAX_BODY = 256 * 1024;
const MAX_REPLY = 200_000;

/** The skills the plugin carries: each folder under skills/ with a SKILL.md,
 *  its name and the one line its front matter says it is for. */
export function skillsOf(pkg, read = (f) => readFileSync(f, "utf8")) {
  const dir = join(pkg, "skills");
  let names = [];
  try { names = readdirSync(dir).filter((n) => existsSync(join(dir, n, "SKILL.md"))).sort(); } catch { return []; }
  return names.map((n) => {
    let text = "";
    try { text = read(join(dir, n, "SKILL.md")); } catch { /* unreadable: named only */ }
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    const desc = /^description:\s*(.+)$/m.exec(fm)?.[1]?.replace(/^["']|["']$/g, "").trim() ?? "";
    return { name: n, description: desc.slice(0, 300) };
  });
}

/** The framed prompt: who it is, where its skills are, where the delivery
 *  goes, and the person's words last. The same for every harness. */
export function framedPrompt({ label, pkg, jobDir, text, skills }) {
  const list = skills.length
    ? skills.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`).join("\n")
    : "(none)";
  return [
    `You are ${label || "this plugin"}, being tried on AgentMesh. You work as the plugin at ${pkg}.`,
    "",
    `Its skills are in ${pkg}/skills. Each folder has a SKILL.md that says when to use it and how. Before you act, read the SKILL.md of each skill that fits the request, and follow it.`,
    "",
    "Its skills:",
    list,
    "",
    `Work in ${jobDir} and /tmp, and nowhere else. Nobody can answer a question while you work, so do the work with what you have.`,
    `When you are done, write your answer for the person to ${join(jobDir, ANSWER_FILE)}: the result itself, in Markdown, not a description of the steps you took. Put any file you make for the person in ${join(jobDir, OUT_DIR)}.`,
    "",
    "The request:",
    text,
  ].join("\n");
}

/** The files the work made for the person, relative to the job folder. */
export function filesIn(jobDir) {
  const out = [];
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (out.length < 50) out.push({ path: relative(jobDir, p).replace(/\\/g, "/"), bytes: st.size });
    }
  };
  walk(join(jobDir, OUT_DIR));
  return out;
}

/** Run the harness once; resolves {code, stdout, stderr}. */
export function runHarness(bin, prompt, env, { timeoutMs, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const argv = bin.endsWith(".mjs") ? [process.execPath, bin, prompt] : [bin, prompt];
    const child = spawnImpl(argv[0], argv.slice(1), { env, cwd: env.AGENT_HOME, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { if (stdout.length < 1_000_000) stdout += d; });
    child.stderr?.on("data", (d) => { if (stderr.length < 200_000) stderr += d; });
    const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* gone */ } }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 3, stdout, stderr }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 3, stdout, stderr: `${stderr}${e.message}` }); });
  });
}

/** One message: a job folder, the harness once, the delivery. */
export async function answerOne(text, env = process.env, { run = runHarness, now = Date.now } = {}) {
  const pkg = env.AGENT_PACKAGE || "/opt/agent/plugin";
  const bin = env.AGENT_HARNESS_BIN || "";
  if (!bin || !existsSync(bin)) return { status: 500, body: { error: `the harness is not in this image (AGENT_HARNESS_BIN names ${bin || "nothing"})` } };
  const id = `${now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const root = env.HARNESS_JOBS || "/tmp/harness";
  const jobDir = join(root, "jobs", id);
  const home = join(root, "home");
  const data = join(root, "plugin-data");
  for (const d of [jobDir, join(jobDir, OUT_DIR), home, data]) mkdirSync(d, { recursive: true });
  const seconds = Math.max(60, Math.min(3000, Number(env.AGENT_JOB_SECONDS) || 900));
  const prompt = framedPrompt({ label: env.HARNESS_LABEL || "", pkg, jobDir, text, skills: skillsOf(pkg) });
  const childEnv = {
    ...env,
    MESH_JOB_DIR: jobDir, MESH_JOB_OUT: join(jobDir, OUT_DIR), AGENT_HOME: home, HOME: home,
    PLUGIN_ROOT: pkg, PLUGIN_DATA: data, AGENT_JOB_SECONDS: String(seconds - 15),
    // opencode reaches the model door as a gateway provider (opencode-config.mjs
    // gatewayProvider), at the address the adapter named for the door.
    ...(env.MODEL_PROTOCOL && !env.MODEL_ENDPOINT && env.ANTHROPIC_BASE_URL ? { MODEL_ENDPOINT: env.ANTHROPIC_BASE_URL } : {}),
  };
  const r = await run(bin, prompt, childEnv, { timeoutMs: seconds * 1000 });
  const answerPath = join(jobDir, ANSWER_FILE);
  const filed = existsSync(answerPath) ? readFileSync(answerPath, "utf8").trim() : "";
  const printed = String(r.stdout ?? "").trim();
  const reply = (filed || printed).slice(0, MAX_REPLY);
  if (r.code !== 0 && !filed) {
    process.stderr.write(`${JSON.stringify({ severity: "ERROR", message: `[harness-serve] the harness exited ${r.code}: ${String(r.stderr).slice(-2000)}` })}\n`);
    return { status: 502, body: { error: reply || `The harness stopped without an answer (exit ${r.code}).` } };
  }
  return { status: 200, body: { reply: reply || "The work finished and wrote no answer.", files: filesIn(jobDir) } };
}

export function serve(env = process.env) {
  const port = Number(env.HARNESS_PORT || 8080);
  let busy = 0;
  const server = createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, busy });
    if (req.method !== "POST" || req.url !== "/message") return send(404, { error: "GET /health or POST /message" });
    let raw = "";
    req.on("data", (d) => { raw += d; if (raw.length > MAX_BODY) req.destroy(); });
    req.on("end", async () => {
      let text = "";
      try { text = String(JSON.parse(raw).text ?? "").trim(); } catch { return send(400, { error: "the body is JSON with text" }); }
      if (!text) return send(400, { error: "the message has no words" });
      busy += 1;
      try {
        const a = await answerOne(text, env);
        send(a.status, a.body);
      } catch (e) {
        send(500, { error: `the harness could not be run: ${e.message}` });
      } finally {
        busy -= 1;
      }
    });
  });
  server.listen(port, "127.0.0.1", () => process.stdout.write(`harness-serve: listening on 127.0.0.1:${port} for ${env.AGENT_HARNESS || "a harness"}\n`));
  return server;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) serve();
