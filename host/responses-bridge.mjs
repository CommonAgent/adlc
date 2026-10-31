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
//
// THE MODEL GATEWAY FOR AGENTS. The same bridge also serves POST /v1/messages, Claude's
// Messages API as an agent's model caller speaks it (MODEL_PROTOCOL anthropic-messages).
// Common Agent 12.6 rule 2 keeps addresses and credentials out of a package, so an agent
// does not fetch a Google token or know where Vertex is: the host places MODEL_ENDPOINT
// (this bridge, http://127.0.0.1:8788), MODEL_PROTOCOL anthropic-messages, MODEL_NAME (the
// Claude model's id) and an empty MODEL_KEY. The bridge holds the machine's Google
// identity, keeps the token fresh, and passes each request to Vertex as it came: the model
// moves from the body into the address (a google-vertex-anthropic/ in front of it, as older
// settings wrote it, is taken off), the version becomes Vertex's, and a streamed request
// (stream: true) goes to streamRawPredict and is streamed back. Vertex's status and answer
// come back unchanged. A key the agent sends is never passed on. It listens on loopback
// only, so only what runs on this machine reaches it.
//
// GEMINI'S FORMAT, THE SAME WAY. The bridge also serves MODEL_PROTOCOL gemini as
// Common Agent 12.4.1's table defines it: POST /models/<MODEL_NAME>:generateContent,
// or :streamGenerateContent for an answer that streams, under MODEL_ENDPOINT. The
// x-goog-api-key header, where a caller sends one, is ignored and never passed on.
// Each call goes to Vertex AI's publishers/google/models/<model> in the bridge's
// project and its Gemini region (BRIDGE_GEMINI_REGION, else the region it was
// started with), signed in as the machine. What differs between the Gemini API
// and Vertex is mapped (vertexGeminiRequest): a content with no role is the
// user's, as the Gemini API reads it and Vertex refuses it; the snake_case
// spellings the Gemini API takes are given their Vertex names; a system
// instruction given as words is made a content; the tool google_search is
// googleSearch; and no query parameter but alt=sse is passed, so a key written
// into the address goes nowhere.
//
// SPEECH-TO-TEXT V2, AND NOTHING ELSE OF GOOGLE'S. An agent that turns speech into
// words reaches Speech-to-Text v2 at a declared setting (STT_ENDPOINT, this
// bridge) with no credential: POST /v2/projects/<project>/locations/<location>/
// recognizers/<recognizer>:recognize goes to <location>-speech.googleapis.com with
// the machine's token added. Only that path, and only for the bridge's own
// project (BRIDGE_SPEECH_PROJECT, else the Vertex project): any other project,
// recognizer action or Google API is refused, so the bridge is never a way into
// some other project or service.
//
// BRIDGE_LISTEN=0 loads the file without serving, for its tests.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";

const PORT = Number(process.env.RIG_BRIDGE_PORT ?? process.env.BRIDGE_PORT ?? 8788);
const PROJECT = process.env.RIG_VERTEX_PROJECT ?? process.env.BRIDGE_VERTEX_PROJECT;
const REGION = process.env.RIG_VERTEX_REGION ?? process.env.BRIDGE_VERTEX_REGION ?? "global";
const GEMINI_REGION = process.env.BRIDGE_GEMINI_REGION || REGION;
const SPEECH_PROJECT = process.env.BRIDGE_SPEECH_PROJECT || PROJECT;
/** The largest request the bridge reads: a Speech-to-Text v2 recognize carries at
 *  most ten megabytes of sound, which base64 makes about fourteen. */
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

/** Where Vertex AI is reached for a region: the global host, a multi-region's own host
 *  (us, eu), or the region's host. */
export function vertexOrigin(region) {
  const host = region === "global" ? "aiplatform.googleapis.com"
    : region === "us" || region === "eu" ? `aiplatform.${region}.rep.googleapis.com` : `${region}-aiplatform.googleapis.com`;
  return `https://${host}`;
}

let cached = null;
async function token() {
  if (cached && cached.until > Date.now()) return cached.token;
  if (process.env.RIG_GCLOUD) {
    const t = execFileSync(process.env.RIG_GCLOUD, ["auth", "print-access-token"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
    cached = { token: t, until: Date.now() + 30 * 60_000 };
  } else {
    const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`the metadata server answered ${r.status}, so there is no Google token`);
    const j = await r.json();
    if (!j?.access_token) throw new Error("the metadata server gave no Google token");
    cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in ?? 600) - 60) * 1000 };
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

async function callClaude(body, names, deps) {
  const { system, messages } = toMessages(body);
  const tools = toTools(body.tools, names);
  const req = { anthropic_version: "vertex-2023-10-16", max_tokens: Math.min(body.max_output_tokens ?? 8192, 8192), system, messages };
  if (tools.length) req.tools = tools;
  const url = `${deps.origin}/v1/projects/${deps.project}/locations/${deps.region}/publishers/anthropic/models/${body.model}:rawPredict`;
  const r = await deps.fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${await deps.token()}`, "content-type": "application/json" }, body: JSON.stringify(req) });
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

/** The model id Vertex is asked for: the id alone, without the provider older settings
 *  wrote in front of it (google-vertex-anthropic/<id>) or opencode's @default suffix. */
export const vertexModelId = (name) => String(name ?? "").trim().replace(/^google-vertex-anthropic\//, "").replace(/@default$/, "");

/** A Messages API request as Vertex takes it: the model moves from the body into the
 *  address, the version is Vertex's, and a streamed request goes to the streamed door.
 *  thinking.block_binding is left out: Anthropic's own client (@ai-sdk/anthropic, the
 *  one opencode loads for a harness on the host's gateway, technical debt 619) sends
 *  it with adaptive thinking, and Vertex refuses the whole request over it with 400
 *  "thinking.adaptive.block_binding: Extra inputs are not permitted" (dev, 2026-10-30).
 *  The rest of the thinking block passes as it came. */
export function vertexMessagesRequest(body, { origin, project, region }) {
  const { model, ...rest } = body ?? {};
  if (rest.thinking && typeof rest.thinking === "object" && "block_binding" in rest.thinking) {
    const { block_binding: _left, ...thinking } = rest.thinking;
    rest.thinking = thinking;
  }
  const id = vertexModelId(model);
  const door = rest.stream === true ? "streamRawPredict" : "rawPredict";
  return {
    model: id,
    url: `${origin}/v1/projects/${project}/locations/${region}/publishers/anthropic/models/${encodeURIComponent(id)}:${door}`,
    body: { ...rest, anthropic_version: "vertex-2023-10-16" },
  };
}

const messagesError = (res, status, type, message) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type, message } }));
};

/** POST /v1/messages: an agent's Messages API call, passed to Vertex as the machine,
 *  and Vertex's answer passed back as it came, streamed when the request asked. */
async function messagesDoor(raw, res, deps) {
  let body;
  try { body = JSON.parse(raw); } catch { return messagesError(res, 400, "invalid_request_error", "the request is not JSON"); }
  if (!vertexModelId(body?.model)) return messagesError(res, 400, "invalid_request_error", "the request names no model: the agent's MODEL_NAME is the Claude model's id");
  const v = vertexMessagesRequest(body, deps);
  let r;
  try {
    r = await deps.fetchImpl(v.url, { method: "POST", headers: { authorization: `Bearer ${await deps.token()}`, "content-type": "application/json" }, body: JSON.stringify(v.body) });
  } catch (e) {
    console.error(`responses-bridge: messages ${v.model}: ${e.message}`);
    return messagesError(res, 502, "api_error", `the model gateway could not reach Vertex AI: ${String(e?.cause?.message ?? e?.message ?? e).replace(/Bearer\s+\S+/gi, "Bearer [left out]")}`);
  }
  console.error(`responses-bridge: messages ${v.model}${v.body.stream ? " (streamed)" : ""} -> ${r.status}`);
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json", ...(v.body.stream ? { "cache-control": "no-cache" } : {}) });
  if (r.body) for await (const chunk of r.body) res.write(chunk);
  res.end();
}

// ── Gemini's format ──────────────────────────────────────────────────────

/** POST /models/<model>:generateContent or :streamGenerateContent (12.4.1), with the
 *  Gemini API's own /v1beta or /v1 in front accepted too: {model, method, alt} or null. */
export function geminiPath(url) {
  const m = /^\/(?:v1beta\/|v1\/)?models\/([^/:?]+):(generateContent|streamGenerateContent)(?:\?(.*))?$/.exec(String(url ?? ""));
  if (!m) return null;
  const query = new URLSearchParams(m[3] ?? "");
  return { model: vertexGeminiModelId(decodeURIComponent(m[1])), method: m[2], alt: query.get("alt") === "sse" ? "sse" : null };
}

/** The model id Vertex is asked for: the id alone, without google/ or models/ in front. */
export const vertexGeminiModelId = (name) => String(name ?? "").trim().replace(/^google\//, "").replace(/^models\//, "");

const camel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
/** An object's own keys in camelCase, one level, values untouched. */
const camelKeys = (o) => (o && typeof o === "object" && !Array.isArray(o)
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [camel(k), v])) : o);
const camelPart = (p) => {
  const q = camelKeys(p);
  if (q && typeof q === "object") {
    for (const k of ["inlineData", "fileData", "functionCall", "functionResponse", "executableCode", "codeExecutionResult", "videoMetadata"]) {
      if (q[k] && typeof q[k] === "object") q[k] = camelKeys(q[k]);
    }
  }
  return q;
};
const camelContent = (c, role) => {
  const q = camelKeys(typeof c === "string" ? { parts: [{ text: c }] } : c) ?? {};
  return { ...q, ...(role && !q.role ? { role } : {}), parts: (Array.isArray(q.parts) ? q.parts : []).map(camelPart) };
};
/** generationConfig's own keys and those of its few small members; a response
 *  schema's property names are the caller's and are never touched. */
const camelConfig = (g) => {
  const q = camelKeys(g);
  if (q && typeof q === "object") {
    for (const k of ["thinkingConfig", "speechConfig", "imageConfig", "mediaResolution"]) if (q[k] && typeof q[k] === "object") q[k] = camelKeys(q[k]);
  }
  return q;
};
const TOOL_NAMES = { google_search: "googleSearch", google_search_retrieval: "googleSearchRetrieval", code_execution: "codeExecution",
  url_context: "urlContext", function_declarations: "functionDeclarations", enterprise_web_search: "enterpriseWebSearch" };
const camelTool = (t) => (t && typeof t === "object" && !Array.isArray(t)
  ? Object.fromEntries(Object.entries(t).map(([k, v]) => [TOOL_NAMES[k] ?? camel(k), k === "function_declarations" || k === "functionDeclarations" ? v : camelKeys(v)])) : t);

/** A Gemini API generateContent body as Vertex takes it (see GEMINI'S FORMAT above). */
export function vertexGeminiBody(body) {
  const b = camelKeys(body ?? {}) ?? {};
  const out = { ...b };
  out.contents = (Array.isArray(b.contents) ? b.contents : b.contents ? [b.contents] : []).map((c) => camelContent(c, "user"));
  if (b.systemInstruction !== undefined) out.systemInstruction = camelContent(b.systemInstruction);
  if (b.generationConfig !== undefined) out.generationConfig = camelConfig(b.generationConfig);
  if (Array.isArray(b.tools)) out.tools = b.tools.map(camelTool);
  if (b.toolConfig !== undefined) out.toolConfig = camelKeys(b.toolConfig);
  if (Array.isArray(b.safetySettings)) out.safetySettings = b.safetySettings.map(camelKeys);
  // The model is in the address on both sides; a body naming one is not Vertex's.
  delete out.model;
  return out;
}

/** The call Vertex takes for one Gemini request: {model, url, body}. */
export function vertexGeminiRequest(path, body, { origin, project, region }) {
  const id = path.model;
  const url = `${origin}/v1/projects/${project}/locations/${region}/publishers/google/models/${encodeURIComponent(id)}:${path.method}${path.alt ? "?alt=sse" : ""}`;
  return { model: id, url, body: vertexGeminiBody(body) };
}

const googleError = (res, status, message, reason = "INVALID_ARGUMENT") => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: status, message, status: reason } }));
};

/** Pass Vertex's answer back as it came, streamed when it streams. */
async function passBack(r, res, streamed) {
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json", ...(streamed ? { "cache-control": "no-cache" } : {}) });
  if (r.body) for await (const chunk of r.body) res.write(chunk);
  res.end();
}

/** POST /models/<model>:generateContent: a Gemini call, to Vertex as the machine. */
async function geminiDoor(path, raw, res, deps) {
  let body;
  try { body = JSON.parse(raw); } catch { return googleError(res, 400, "the request is not JSON"); }
  if (!path.model) return googleError(res, 400, "the request names no model: the agent's MODEL_NAME is the Gemini model's id");
  const v = vertexGeminiRequest(path, body, { origin: deps.geminiOrigin ?? deps.origin, project: deps.project, region: deps.geminiRegion ?? deps.region });
  let r;
  try {
    r = await deps.fetchImpl(v.url, { method: "POST", headers: { authorization: `Bearer ${await deps.token()}`, "content-type": "application/json" }, body: JSON.stringify(v.body) });
  } catch (e) {
    console.error(`responses-bridge: gemini ${v.model}: ${e.message}`);
    return googleError(res, 502, `the model gateway could not reach Vertex AI: ${String(e?.cause?.message ?? e?.message ?? e).replace(/Bearer\s+\S+/gi, "Bearer [left out]")}`, "UNAVAILABLE");
  }
  console.error(`responses-bridge: gemini ${v.model} ${path.method}${path.alt ? " (sse)" : ""} -> ${r.status}`);
  return passBack(r, res, path.method === "streamGenerateContent");
}

// ── Speech-to-Text v2 ────────────────────────────────────────────────────

/** POST /v2/projects/<project>/locations/<location>/recognizers/<recognizer>:recognize:
 *  {project, location, path} or null for anything else. */
export function speechPath(url) {
  const m = /^\/v2\/projects\/([a-z][a-z0-9-]{4,61}[a-z0-9])\/locations\/([a-z][a-z0-9-]{0,30})\/recognizers\/([A-Za-z0-9_-]{1,63}):recognize$/.exec(String(url ?? ""));
  return m ? { project: m[1], location: m[2], path: m[0] } : null;
}

/** Where Speech-to-Text v2 is reached for a location: the global host, or the location's own. */
export const speechOrigin = (location) => `https://${location === "global" ? "" : `${location}-`}speech.googleapis.com`;

/** The Speech-to-Text v2 passthrough: only recognize, only for the bridge's own project. */
async function speechDoor(url, raw, res, deps) {
  const p = speechPath(url);
  if (!p) return googleError(res, 403, "this gateway passes on Speech-to-Text v2 recognize calls only (/v2/projects/<project>/locations/<location>/recognizers/<recognizer>:recognize), and nothing else", "PERMISSION_DENIED");
  if (p.project !== deps.speechProject) return googleError(res, 403, `this gateway passes on Speech-to-Text calls for project ${deps.speechProject} only`, "PERMISSION_DENIED");
  const target = `${(deps.speechOrigin ?? speechOrigin)(p.location)}${p.path}`;
  let r;
  try {
    r = await deps.fetchImpl(target, { method: "POST", headers: { authorization: `Bearer ${await deps.token()}`, "content-type": "application/json" }, body: raw });
  } catch (e) {
    console.error(`responses-bridge: speech ${p.location}: ${e.message}`);
    return googleError(res, 502, `the gateway could not reach Speech-to-Text: ${String(e?.cause?.message ?? e?.message ?? e).replace(/Bearer\s+\S+/gi, "Bearer [left out]")}`, "UNAVAILABLE");
  }
  console.error(`responses-bridge: speech ${p.location} recognize -> ${r.status}`);
  return passBack(r, res, false);
}

/** The bridge's request handler, given where Vertex is, the project and region, the token
 *  and the fetch it uses. */
export function bridgeHandler(deps) {
  return async (req, res) => {
    if (req.method !== "POST") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ object: "list", data: [], models: [] })); return; }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) { res.writeHead(413, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: 413, message: "the request is larger than this gateway takes" } })); req.destroy(); return; }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = req.url ?? "";
    if (/^\/v1\/messages(\?|$)/.test(url)) return messagesDoor(raw, res, deps);
    const gemini = geminiPath(url);
    if (gemini) return geminiDoor(gemini, raw, res, deps);
    if (/^\/v2\//.test(url)) return speechDoor(url, raw, res, deps);
    // A Gemini or Google address this bridge does not serve is refused, never
    // taken for a Codex call.
    if (/^\/(v1beta|v1\/projects|models)\//.test(url)) return googleError(res, 404, `this gateway does not serve ${url.split("?")[0]}`, "NOT_FOUND");
    let body;
    try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end("bad json"); return; }
    // What Codex offered, by kind and name, so a run whose model "cannot find" a tool can be read.
    console.error(`responses-bridge: ${req.url} tools: ${(body.tools ?? []).map((t) => `${t.type}:${t.name ?? ""}`).join(" ").slice(0, 2000)}`);
    if (process.env.RIG_BRIDGE_DUMP) (await import("node:fs")).appendFileSync(process.env.RIG_BRIDGE_DUMP, raw + "\n");
    const respId = id("resp");
    const names = new Map();
    let reply;
    try { reply = await callClaude(body, names, deps); }
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
  };
}

if (process.env.BRIDGE_LISTEN !== "0") {
  if (!PROJECT) { console.error("responses-bridge: RIG_VERTEX_PROJECT (or BRIDGE_VERTEX_PROJECT) is not set"); process.exit(2); }
  createServer(bridgeHandler({ origin: vertexOrigin(REGION), project: PROJECT, region: REGION, token, fetchImpl: fetch,
    geminiOrigin: vertexOrigin(GEMINI_REGION), geminiRegion: GEMINI_REGION, speechProject: SPEECH_PROJECT }))
    .listen(PORT, "127.0.0.1", () => console.error(`responses-bridge: 127.0.0.1:${PORT} -> Vertex (${PROJECT}, ${REGION}; Gemini ${GEMINI_REGION}): /v1/responses for Codex, /v1/messages and /models/<model>:generateContent for agents, Speech-to-Text v2 recognize for ${SPEECH_PROJECT}`));
}
