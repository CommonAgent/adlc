// Codex CLI speaks only the OpenAI Responses API (its chat wire was removed in February
// 2026), and Vertex AI serves neither that API nor Claude through its OpenAI-compatible
// endpoint. This bridge lets the rig's Codex reach Claude on Vertex: it takes Codex's
// POST /v1/responses, sends the conversation to Claude's Messages API on Vertex
// (rawPredict), and answers with the Responses events Codex reads. It handles what a rig
// run needs (text, function tools, MCP tool calls, their results) and nothing more.
//
//   node responses-bridge.mjs            listens on 127.0.0.1:$RIG_BRIDGE_PORT (8788)
//
// It lives only as long as the job's container (the Codex `env` line starts it when it is
// not already listening), so nothing runs while the rig is idle. The Google token comes
// from the job's service account (metadata server), or from `RIG_GCLOUD auth
// print-access-token` on a workstation. Project and region: RIG_VERTEX_PROJECT and
// RIG_VERTEX_REGION (default global).
//
// The fleet host runs the same file as a resident pm2 app (deploy/hosts/fleet), so the
// Codex brains there (the ops trio and the Codex bare agent) reach Claude the same way.
// It sets BRIDGE_VERTEX_PROJECT, BRIDGE_VERTEX_REGION and BRIDGE_PORT, which the RIG_
// names override.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";

const PORT = Number(process.env.RIG_BRIDGE_PORT ?? process.env.BRIDGE_PORT ?? 8788);
const PROJECT = process.env.RIG_VERTEX_PROJECT ?? process.env.BRIDGE_VERTEX_PROJECT;
const REGION = process.env.RIG_VERTEX_REGION ?? process.env.BRIDGE_VERTEX_REGION ?? "global";
const HOST = REGION === "global" ? "aiplatform.googleapis.com" : `${REGION}-aiplatform.googleapis.com`;
if (!PROJECT) { console.error("responses-bridge: RIG_VERTEX_PROJECT (or BRIDGE_VERTEX_PROJECT) is not set"); process.exit(2); }

let cached = null;
async function token() {
  if (cached && cached.until > Date.now()) return cached.token;
  if (process.env.RIG_GCLOUD) {
    const t = execFileSync(process.env.RIG_GCLOUD, ["auth", "print-access-token"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
    cached = { token: t, until: Date.now() + 30 * 60_000 };
  } else {
    const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    const j = await r.json();
    cached = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  }
  return cached.token;
}

const textOf = (content) => typeof content === "string" ? content
  : (content ?? []).map((c) => c.text ?? (c.type === "input_image" ? "[image]" : "")).join("");

/** Responses input items -> Anthropic system text and messages (roles alternate). */
function toMessages(body) {
  const system = [body.instructions ?? ""];
  const messages = [];
  const push = (role, block) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  const input = typeof body.input === "string" ? [{ type: "message", role: "user", content: body.input }] : (body.input ?? []);
  for (const it of input) {
    const type = it.type ?? (it.role ? "message" : "");
    if (type === "message") {
      const text = textOf(it.content);
      if (it.role === "system" || it.role === "developer") { system.push(text); continue; }
      if (text) push(it.role === "assistant" ? "assistant" : "user", { type: "text", text });
    } else if (type === "function_call" || type === "custom_tool_call") {
      let input = {};
      try { input = type === "function_call" ? JSON.parse(it.arguments || "{}") : { input: it.input ?? "" }; } catch { input = { raw: it.arguments }; }
      push("assistant", { type: "tool_use", id: it.call_id, name: flatName(it.name, it.namespace), input });
    } else if (type === "function_call_output" || type === "custom_tool_call_output") {
      const out = typeof it.output === "string" ? it.output : (it.output?.content ?? textOf(it.output) ?? JSON.stringify(it.output));
      push("user", { type: "tool_result", tool_use_id: it.call_id, content: typeof out === "string" ? out : JSON.stringify(out) });
    }
    // reasoning, web search and other item types carry nothing Claude needs here.
  }
  if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "(start)" }] });
  return { system: system.filter(Boolean).join("\n\n"), messages };
}

/** The one name Claude sees for a tool, which may sit in a namespace (Codex puts each MCP
 *  server's tools in one): Claude's tool names are flat, 1-128 of [A-Za-z0-9_-]. */
const flatName = (name, namespace) => {
  const full = namespace && !name.startsWith(namespace) ? `${namespace}__${name}` : name;
  return full.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
};

/** Responses tools -> Anthropic tools (function tools, namespaced ones flattened; a freeform
 *  tool takes one string). `names` maps each flat name back to Codex's name and namespace. */
function toTools(tools = [], names = new Map(), namespace = null) {
  const out = [];
  for (const t of tools) {
    if (t.type === "namespace") { out.push(...toTools(t.tools ?? [], names, t.name)); continue; }
    if (t.type !== "function" && t.type !== "custom") continue;
    const name = flatName(t.name, namespace);
    names.set(name, { name: t.name, namespace, custom: t.type === "custom" });
    const description = `${namespace ? `[${namespace}] ` : ""}${t.description ?? ""}`;
    if (t.type === "function") out.push({ name, description, input_schema: t.parameters && Object.keys(t.parameters).length ? t.parameters : { type: "object", properties: {} } });
    else out.push({ name, description, input_schema: { type: "object", properties: { input: { type: "string" } }, required: ["input"] } });
  }
  return out;
}

async function callClaude(body, names) {
  const { system, messages } = toMessages(body);
  const tools = toTools(body.tools, names);
  const req = { anthropic_version: "vertex-2023-10-16", max_tokens: Math.min(body.max_output_tokens ?? 8192, 8192), system, messages };
  if (tools.length) req.tools = tools;
  const url = `https://${HOST}/v1/projects/${PROJECT}/locations/${REGION}/publishers/anthropic/models/${body.model}:rawPredict`;
  const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" }, body: JSON.stringify(req) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message ?? j[0]?.error?.message ?? `HTTP ${r.status}`), { status: r.status });
  return j;
}

let seq = 0;
const id = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Claude's reply -> Responses output items. */
function toOutput(reply, names) {
  const output = [];
  const text = (reply.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  if (text) output.push({ type: "message", id: id("msg"), role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
  for (const c of reply.content ?? []) {
    if (c.type !== "tool_use") continue;
    const t = names.get(c.name) ?? { name: c.name, namespace: null, custom: false };
    const ns = t.namespace ? { namespace: t.namespace } : {};
    if (t.custom) output.push({ type: "custom_tool_call", id: id("ctc"), status: "completed", call_id: c.id, name: t.name, ...ns, input: String(c.input?.input ?? "") });
    else output.push({ type: "function_call", id: id("fc"), status: "completed", call_id: c.id, name: t.name, ...ns, arguments: JSON.stringify(c.input ?? {}) });
  }
  return output;
}

createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ object: "list", data: [], models: [] })); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end("bad json"); return; }
  // What Codex offered, by kind and name, so a run whose model "cannot find" a tool can be read.
  console.error(`responses-bridge: ${req.url} tools: ${(body.tools ?? []).map((t) => `${t.type}:${t.name ?? ""}`).join(" ").slice(0, 2000)}`);
  if (process.env.RIG_BRIDGE_DUMP) (await import("node:fs")).appendFileSync(process.env.RIG_BRIDGE_DUMP, raw + "\n");
  const respId = id("resp");
  const names = new Map();
  let reply;
  try { reply = await callClaude(body, names); }
  catch (e) {
    console.error(`responses-bridge: ${e.message}`);
    res.writeHead(e.status === 429 ? 429 : 502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: e.message, type: "upstream_error" } }));
    return;
  }
  const output = toOutput(reply, names);
  const u = reply.usage ?? {};
  const usage = { input_tokens: u.input_tokens ?? 0, input_tokens_details: { cached_tokens: u.cache_read_input_tokens ?? 0 }, output_tokens: u.output_tokens ?? 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) };
  const response = { id: respId, object: "response", created_at: Math.floor(Date.now() / 1000), model: body.model, status: "completed", output, usage };
  if (body.stream === false) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(response)); return; }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("response.created", { response: { ...response, status: "in_progress", output: [] } });
  output.forEach((item, i) => {
    send("response.output_item.added", { output_index: i, item });
    if (item.type === "message") send("response.output_text.delta", { output_index: i, item_id: item.id, content_index: 0, delta: item.content[0].text });
    send("response.output_item.done", { output_index: i, item });
  });
  send("response.completed", { response });
  res.end();
}).listen(PORT, "127.0.0.1", () => console.error(`responses-bridge: 127.0.0.1:${PORT} -> Claude on Vertex (${PROJECT}, ${REGION})`));
