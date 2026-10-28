// Call the Gemini model endpoint asking for text or JSON, and read what it returns.
//
// Reads GOOGLE_GENERATIVE_AI_API_KEY and AGENT_MODEL from the environment,
// strips any provider prefix from the model name, and calls the Google Generative
// AI generateContent endpoint. json: true asks the endpoint for JSON via
// generationConfig.responseMimeType. readJson reads JSON from an answer whether
// fenced, plain, or wrapped in prose, throwing an Error with modelFailure: true
// when no whole JSON exists. askJson calls the model for JSON and reads what it said.
//
// No silent truncation (lossless handoffs, owner 2026-10-04, docs/handoff-audit.md
// E1 and E2): every call sets an output budget (generationConfig.maxOutputTokens),
// sized by the job for what it asks (options.maxOutputTokens, the answer's own
// budget), with room added for thinking on a model that thinks, since thinking
// counts against the same limit. Every part of the reply is read, not only the
// first. The finish reason is read: a reply that stopped at its limit
// (MAX_TOKENS) is a failure that says so, never parsed as if whole, and so is a
// reply stopped for any other reason than STOP. readJson never mines a cut
// answer for a complete inner object: an answer that does not parse whole is a
// failure. The harness (Claude Code) wrote this change.
//
// Run configs (2026-10-07, docs/run-config-plan.md): a job's run config may
// choose the model. The job passes it as options.model, which overrides
// AGENT_MODEL for that job only, and modelAvailable checks it can be used
// before any work starts. With no run config nothing here changes.
//
// The model record (2026-10-07, docs/run-config-plan.md phase 2 item 5):
// every call goes through model-record.mjs, which keeps the whole request and
// the whole answer in the job folder's model-record.jsonl, and in a replay
// (AGENT_MODEL_REPLAY) answers the call from a saved job's record instead of
// calling the model; a replay needs no key and never reaches the service.
// With no replay, what is sent, read and returned is exactly as before.
//
// The same file is copied into fact-writer, pitch-writer and scene-writer,
// each beside its copy of model-record.mjs (each package carries its own
// files); keep the copies identical. self-check-writer carries the copy from
// before the model record until its next change.
//
// Claude on Vertex AI (2026-10-08, owner's word "do the other fixes now
// including Haiku"): a model named google-vertex-anthropic/claude-... (the
// provider name the deployment manager places, as in AGENT_MODEL
// google-vertex-anthropic/claude-haiku-5-5) is called on Vertex AI the way
// the platform calls Claude (services/src/shared/vertex-claude.ts): the
// Messages API at the project and location the install placed
// (GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION, or VERTEX_WHERE as
// <project>/<location>), paid for with a token from the service account the
// job runs as (the metadata server), so no key is held. The answer is
// streamed (streamRawPredict), so the connection carries data from the first
// second and node's fetch never gives up waiting for headers on a long
// answer (its 300 s wait killed long Gemini answers, 2026-10-08); the whole
// call has its own time limit, sized for the output it allows
// (claudeTimeoutMs) and said in the error when it runs out. Thinking is set
// by effort (options.effort: low, medium, high; the model's own default is
// medium), never by a token budget, or turned off (options.effort "off",
// thinking disabled); temperature, top_p and top_k are never sent. The output
// budget may go to 128,000 tokens, thinking included. The stop reason is
// read: max_tokens is an answer cut at its limit, refusal is a prompt the
// model declined, and anything but end_turn is an answer that stopped early,
// each a failure that says so. In the model record the call is kept with the
// request as sent, and the answer as the message its stream adds up to (the
// text, the stop reason and the usage), which is all the job reads of it;
// a replay answers it from there as any other call.
//
// Gemini without a key (2026-10-08): an agent installed on Claude carries no
// Gemini key, and a run config may still name a Gemini model (the run config
// "Deck explainer, Oct 6" pins gemini-3.8-flash). Without
// GOOGLE_GENERATIVE_AI_API_KEY, a Gemini model is called on Vertex AI at the
// same place with the job's own token. The request is the one the Gemini API
// is sent, and is recorded and matched as that; Vertex is sent it with each
// content's role named ("user"), which that door requires and the Gemini API
// takes as its default. With a key, nothing about a Gemini call changes.
//
// A long Gemini answer (2026-10-08): a job may ask for a call to be streamed
// (options.stream, scene-writer's scenes call), because node's fetch gave up
// waiting for headers at 300 s and killed the memo's five-minute answers.
// The request is the same (only the door changes, streamGenerateContent),
// the call has its own time limit sized like Claude's, and the record keeps
// the one answer its chunks add up to, so a replay reads it as any other.
// A streamed call also asks for thought summaries (includeThoughts), because
// Gemini otherwise sends nothing, headers included, until it has finished
// thinking: the memo's live run (run_93f4640aac3a196d28) still lost one
// attempt to node's 300 s wait. With them, headers came in under 3 seconds
// and no gap between bytes was over 4 seconds on a 280-second answer.
//
//   needs: node >= 22
//   GOOGLE_GENERATIVE_AI_API_KEY=<key> AGENT_MODEL=<model> node scripts/caller.mjs
import { inReplay, modelExchange } from "./model-record.mjs";

/** The answer budget when a job names none: room for a page of JSON. */
export const DEFAULT_ANSWER_TOKENS = 8192;
/** Room for thinking, added to the answer budget on a model that thinks. */
export const THINKING_ROOM = 16384;
/** The Messages API version Vertex AI is called with. */
export const VERTEX_VERSION = "vertex-2023-10-16";
/** What a JSON answer is asked for on Claude, which has no JSON switch like Gemini's responseMimeType. */
export const JSON_SYSTEM = "Answer with JSON only: one JSON value, with no words before or after it and no code fence.";
/** The effort levels a Claude call may ask for, and "off" for no thinking. */
export const EFFORTS = ["off", "low", "medium", "high"];
/** The metadata server's token door, for a job on Google Cloud. */
export const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export function modelNameOf(model) {
  const raw = String(model ?? "").trim();
  if (!raw) return "";
  return raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
}

/** The model's own id, with opencode's @version suffix taken off (Vertex takes the bare id for current models). */
const bareName = (model) => modelNameOf(model).replace(/@.*$/, "");

/** Whether a model is Claude (called on Vertex AI's Messages API) rather than Gemini. */
export function isClaude(model) {
  return /^claude-/i.test(bareName(model));
}

/**
 * Whether a model thinks before it answers, and so spends part of its output
 * limit on thinking: Gemini 2.5 and later, and Claude. Its output ceiling:
 * 65,536 tokens for those Gemini models, 8,192 for the older ones, and
 * 128,000 for Claude (Haiku 5.5's, Vertex's limit for it).
 */
export function modelShape(model) {
  if (isClaude(model)) return { thinks: true, ceiling: 128000 };
  const m = /gemini-(\d+)(?:\.(\d+))?/i.exec(modelNameOf(model));
  const version = m ? Number(m[1]) + Number(m[2] ?? 0) / 10 : 0;
  const thinks = version >= 2.5;
  return { thinks, ceiling: thinks ? 65536 : 8192 };
}

/**
 * The maxOutputTokens a call sets: the answer's budget, plus thinking room on a
 * model that thinks, never past the model's ceiling.
 */
export function outputBudget(model, answerTokens = DEFAULT_ANSWER_TOKENS, thinkingRoom = THINKING_ROOM) {
  const { thinks, ceiling } = modelShape(model);
  const answer = Math.max(256, Math.ceil(Number(answerTokens) || DEFAULT_ANSWER_TOKENS));
  return Math.min(ceiling, answer + (thinks ? Math.max(0, Number(thinkingRoom) || 0) : 0));
}

/**
 * How long a streamed call may take, whole, in milliseconds: a minute to
 * start, then the output it allows at 50 tokens a second (Haiku 5.5 wrote
 * about 250 a second on dev, 2026-10-08), never more than 15 minutes, which
 * leaves a 20-minute job room to say why.
 */
export function streamTimeoutMs(maxTokens) {
  return Math.min(15 * 60_000, 60_000 + Math.ceil((Number(maxTokens) || 0) / 50) * 1000);
}
export const claudeTimeoutMs = streamTimeoutMs;

/**
 * A streamed Gemini answer (streamGenerateContent, alt=sse), added up into
 * the one answer generateContent would have given: every text part of every
 * chunk joined (a thought part is not the answer), the last finish reason and
 * the last usage. { message } or { status, error } when a chunk carried an
 * error or the stream ended with no finish reason.
 */
export function readGeminiStream(raw) {
  let text = "";
  let finishReason = null;
  let usageMetadata = null;
  let promptFeedback = null;
  let seen = 0;
  for (const line of String(raw ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (!line.startsWith("data:")) continue;
    let c;
    try { c = JSON.parse(line.slice(5).trim()); } catch { continue; }
    seen++;
    if (c?.error) return { status: Number(c.error.code) || 500, error: `${c.error.status ?? "error"}: ${String(c.error.message ?? "the model stopped with an error")}` };
    const cand = c?.candidates?.[0];
    for (const p of Array.isArray(cand?.content?.parts) ? cand.content.parts : []) if (p && p.thought !== true && typeof p.text === "string") text += p.text;
    if (cand?.finishReason) finishReason = cand.finishReason;
    if (c?.usageMetadata) usageMetadata = c.usageMetadata;
    if (c?.promptFeedback) promptFeedback = c.promptFeedback;
  }
  if (promptFeedback?.blockReason && !finishReason) return { message: { promptFeedback, ...(usageMetadata ? { usageMetadata } : {}) } };
  if (!seen || !finishReason) return { status: 502, error: "the answer's stream ended before the answer was finished" };
  return { message: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }], ...(usageMetadata ? { usageMetadata } : {}), ...(promptFeedback ? { promptFeedback } : {}) } };
}

/** Where Vertex AI is called: { project, location }, from the install's variables, or null when it names none. */
export function vertexWhere(env = process.env) {
  const project = String(env.GOOGLE_CLOUD_PROJECT ?? "").trim();
  const location = String(env.GOOGLE_CLOUD_LOCATION ?? "").trim();
  if (project) return { project, location: location || "us" };
  const [p, l] = String(env.VERTEX_WHERE ?? "").trim().split("/");
  return p ? { project: p, location: (l ?? "").trim() || "us" } : null;
}

function vertexHost(location) {
  return location === "global" ? "aiplatform.googleapis.com"
    : location === "us" || location === "eu" ? `aiplatform.${location}.rep.googleapis.com` : `${location}-aiplatform.googleapis.com`;
}

/** The Vertex AI address of a model's door: Claude's streamed Messages API, or Gemini's generateContent. */
export function vertexUrl(model, where, door = isClaude(model) ? "streamRawPredict" : "generateContent") {
  const publisher = isClaude(model) ? "anthropic" : "google";
  return `https://${vertexHost(where.location)}/v1/projects/${where.project}/locations/${where.location}/publishers/${publisher}/models/${bareName(model)}:${door}`;
}

// The job's token, asked of the metadata server once per process.
let heldToken = null;
async function jobToken(fetchImpl) {
  if (heldToken && Date.now() < heldToken.until) return heldToken.token;
  const res = await fetchImpl(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(10_000) });
  if (!res?.ok) throw new Error(`Model call failed with status 503: the metadata server answered ${res?.status ?? "nothing"}, so there is no token for the model`);
  const b = await res.json().catch(() => null);
  if (typeof b?.access_token !== "string" || !b.access_token) throw new Error("Model call failed with status 503: the metadata server gave no token for the model");
  const life = typeof b.expires_in === "number" ? b.expires_in : 600;
  heldToken = { token: b.access_token, until: Date.now() + Math.max(60, life - 300) * 1000 };
  return heldToken.token;
}

/** For tests: forget the job's token. */
export function forgetToken() { heldToken = null; }

const STREAM_ERROR_STATUS = { overloaded_error: 529, rate_limit_error: 429, api_error: 500, timeout_error: 504, invalid_request_error: 400, authentication_error: 401, permission_error: 403, not_found_error: 404 };

/**
 * A streamed Messages API answer, added up into the message it describes:
 * { message } with the text of each text block joined, the stop reason, the
 * stop details and the usage; or { status, error } when the stream said it
 * failed or ended before its message_stop. Thinking blocks are not the answer
 * and are left out.
 */
export function readClaudeStream(raw) {
  const message = { type: "message", model: null, content: [], stop_reason: null, stop_details: null, usage: {} };
  const blocks = new Map();
  let stopped = false;
  for (const chunk of String(raw ?? "").replace(/\r\n/g, "\n").split("\n\n")) {
    const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data) continue;
    let e;
    try { e = JSON.parse(data); } catch { continue; }
    if (e.type === "message_start") {
      message.model = e.message?.model ?? null;
      message.id = e.message?.id;
      Object.assign(message.usage, e.message?.usage ?? {});
    } else if (e.type === "content_block_start") {
      blocks.set(e.index, { type: e.content_block?.type, text: typeof e.content_block?.text === "string" ? e.content_block.text : "" });
    } else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
      const b = blocks.get(e.index) ?? { type: "text", text: "" };
      b.text += String(e.delta.text ?? "");
      blocks.set(e.index, b);
    } else if (e.type === "message_delta") {
      if (e.delta?.stop_reason !== undefined) message.stop_reason = e.delta.stop_reason;
      if (e.delta?.stop_details !== undefined) message.stop_details = e.delta.stop_details;
      Object.assign(message.usage, e.usage ?? {});
    } else if (e.type === "message_stop") {
      stopped = true;
    } else if (e.type === "error") {
      const type = String(e.error?.type ?? "api_error");
      return { status: STREAM_ERROR_STATUS[type] ?? 500, error: `${type}: ${String(e.error?.message ?? "the model stopped with an error")}` };
    }
  }
  if (!stopped) return { status: 502, error: "the answer's stream ended before the message was finished" };
  message.content = [...blocks.entries()].sort((a, b) => a[0] - b[0]).filter(([, b]) => b.type === "text").map(([, b]) => ({ type: "text", text: b.text }));
  return { message };
}

/** The request body for one Claude call. */
export function claudeBody(promptText, { maxTokens, effort, json }) {
  return {
    anthropic_version: VERTEX_VERSION,
    max_tokens: maxTokens,
    stream: true,
    ...(effort === "off" ? { thinking: { type: "disabled" } } : { output_config: { effort } }),
    ...(json ? { system: JSON_SYSTEM } : {}),
    messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
  };
}

/** A model failure: the job records it and the reply says so. */
function failure(message, said, extra = {}) {
  const err = new Error(message);
  err.modelFailure = true;
  err.said = said;
  Object.assign(err, extra);
  return err;
}

function promptOf(arg) {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    const parts = [];
    if (arg.prompt) parts.push(arg.prompt);
    if (arg.pageText) parts.push(`Page Text:\n${arg.pageText}`);
    return parts.length ? parts.join("\n\n") : String(arg.text ?? "");
  }
  return String(arg ?? "");
}

/** One call to Claude on Vertex AI: the answer's text, or a failure that says why. */
async function callClaude(promptText, { env, fetchImpl, model, isJson, options }) {
  const effort = options.effort ?? "medium";
  if (!EFFORTS.includes(effort)) throw new Error(`Refusing to call model: effort ${effort} is not one of ${EFFORTS.join(", ")}.`);
  const where = vertexWhere(env);
  if (!inReplay(env) && !where) throw new Error("Refusing to call model: no Vertex AI project to call Claude in (GOOGLE_CLOUD_PROJECT, or VERTEX_WHERE as <project>/<location>).");
  // A job may give Claude its own thinking room (options.claudeThinkingRoom), apart from Gemini's, whose request stays as it was.
  const limit = outputBudget(model, options.maxOutputTokens, effort === "off" ? 0 : (options.claudeThinkingRoom ?? options.thinkingRoom));
  const body = claudeBody(promptText, { maxTokens: limit, effort, json: isJson });
  const timeout = claudeTimeoutMs(limit);
  const answered = await modelExchange({
    env, service: "vertex-claude", model, body,
    call: async () => {
      const token = await jobToken(fetchImpl);
      let response;
      try {
        response = await fetchImpl(vertexUrl(model, where), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeout),
        });
        const status = Number(response.status ?? (response.ok ? 200 : 500));
        const raw = await response.text();
        if (!response.ok) return { status, text: raw.replace(/Bearer\s+\S+/gi, "Bearer [left out]") };
        const read = readClaudeStream(raw);
        return read.message ? { status, text: JSON.stringify(read.message) } : { status: read.status, text: read.error };
      } catch (e) {
        const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
        // A call that ran out of time, or a connection the service closed, is the model service's failure: a retry may go through.
        throw new Error(timedOut
          ? `Model call failed with status 504: no whole answer within ${Math.round(timeout / 1000)} seconds, the time this call allows for ${limit} output tokens`
          : `Model call failed with status 503: ${String(e?.cause?.message ?? e?.message ?? e)}`);
      }
    },
  });
  if (answered.status < 200 || answered.status > 299) {
    throw new Error(`Model call failed with status ${answered.status}: ${answered.text}`);
  }
  const msg = JSON.parse(answered.text);
  const text = (Array.isArray(msg?.content) ? msg.content : []).filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("");
  const reason = String(msg?.stop_reason ?? "");
  if (reason === "max_tokens") {
    const thought = Number(msg?.usage?.output_tokens_details?.thinking_tokens ?? 0);
    const spent = thought ? ` (${thought} of them spent thinking)` : "";
    throw failure(`Model failure: the model's answer was cut at its limit of ${limit} tokens${spent}, so it was not read.`, text.slice(0, 300), { cutAtLimit: true, limit }); // cut-ok: error text; the answer was refused whole
  }
  if (reason === "refusal") {
    throw failure(`Model failure: the model refused the prompt (refusal${msg?.stop_details?.category ? `, ${msg.stop_details.category}` : ""}).`, "");
  }
  if (reason !== "end_turn" && reason !== "stop_sequence") {
    throw failure(`Model failure: the model stopped its answer early (stop reason ${reason || "none"}), so it was not read.`, text.slice(0, 300), { finishReason: reason || "none" }); // cut-ok: error text; the answer was refused whole
  }
  return text;
}

export async function callModel(arg, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
  const rawModel = options.model ?? env.AGENT_MODEL;
  const hasKey = !!(apiKey && String(apiKey).trim());

  if (!rawModel || !String(rawModel).trim()) {
    throw new Error("Refusing to call model: AGENT_MODEL is absent.");
  }
  const isJson = options.json === true || (arg && typeof arg === "object" && arg.json === true);
  const promptText = promptOf(arg);
  if (isClaude(rawModel)) return callClaude(promptText, { env, fetchImpl, model: bareName(rawModel), isJson, options });

  // Gemini: with the Gemini API key as always, else on Vertex AI where the install says (2026-10-08).
  // A replay is answered from a saved record and needs neither.
  const where = hasKey ? null : vertexWhere(env);
  if (!inReplay(env) && !hasKey && !where) {
    throw new Error("Refusing to call model: GOOGLE_GENERATIVE_AI_API_KEY is absent.");
  }

  const model = modelNameOf(rawModel);
  // A long answer is streamed (options.stream, 2026-10-08), so node's fetch never gives up waiting
  // for headers at 300 s; the request is the same, and so is what the record keeps of it.
  const stream = options.stream === true;
  const door = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const url = hasKey ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:${door}` : null;

  const limit = outputBudget(model, options.maxOutputTokens, options.thinkingRoom);
  const body = {
    contents: [
      {
        parts: [
          { text: promptText },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: limit },
  };
  if (isJson) body.generationConfig.responseMimeType = "application/json";
  // A streamed call asks for the model's thought summaries too (2026-10-08), only so bytes flow while it thinks:
  // without them Gemini sends its headers with the answer's first chunk, after all its thinking, and node's fetch
  // gave up at 300 s on the memo (run_93f4640aac3a196d28). Thought parts are never the answer.
  if (stream) body.generationConfig.thinkingConfig = { includeThoughts: true };

  // The call, kept whole in the job's model record; in a replay, answered from the saved record.
  const answered = await modelExchange({
    env, service: hasKey || inReplay(env) ? "gemini-api" : "vertex", model, body,
    call: async () => {
      const timeout = streamTimeoutMs(limit);
      let response;
      try {
        response = hasKey
          ? await fetchImpl(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": String(apiKey).trim(),
            },
            body: JSON.stringify(body),
            ...(stream ? { signal: AbortSignal.timeout(timeout) } : {}),
          })
          : await fetchImpl(vertexUrl(model, where, door), {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${await jobToken(fetchImpl)}` },
            body: JSON.stringify({ ...body, contents: body.contents.map((c) => ({ role: "user", ...c })) }),
            ...(stream ? { signal: AbortSignal.timeout(timeout) } : {}),
          });
        const status = Number(response.status ?? (response.ok ? 200 : 500));
        if (!response.ok) return { status, text: (await response.text().catch(() => "")).replace(/Bearer\s+\S+/gi, "Bearer [left out]") };
        const raw = typeof response.text === "function" ? await response.text() : JSON.stringify(await response.json());
        if (!stream) return { status, text: raw };
        // Streamed: kept as the one answer its chunks add up to.
        const read = readGeminiStream(raw);
        return read.message ? { status, text: JSON.stringify(read.message) } : { status: read.status, text: read.error };
      } catch (e) {
        if (!stream) throw e;
        const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
        throw new Error(timedOut
          ? `Model call failed with status 504: no whole answer within ${Math.round(timeout / 1000)} seconds, the time this call allows for ${limit} output tokens`
          : `Model call failed with status 503: ${String(e?.cause?.message ?? e?.message ?? e)}`);
      }
    },
  });

  if (answered.status < 200 || answered.status > 299) {
    throw new Error(`Model call failed with status ${answered.status}: ${answered.text}`);
  }

  const data = JSON.parse(answered.text);
  const candidate = data?.candidates?.[0];
  // Every part of the answer, joined; a thought part (only sent when asked for) is not the answer.
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts.filter((p) => p && p.thought !== true && typeof p.text === "string").map((p) => p.text).join("");
  const reason = String(candidate?.finishReason ?? "");
  if (reason === "MAX_TOKENS") {
    const thought = Number(data?.usageMetadata?.thoughtsTokenCount ?? 0);
    const spent = thought ? ` (${thought} of them spent thinking)` : "";
    throw failure(`Model failure: the model's answer was cut at its limit of ${limit} tokens${spent}, so it was not read.`, text.slice(0, 300), { cutAtLimit: true, limit }); // cut-ok: error text; the answer was refused whole
  }
  if (reason && reason !== "STOP" && reason !== "FINISH_REASON_UNSPECIFIED") {
    throw failure(`Model failure: the model stopped its answer early (finish reason ${reason}), so it was not read.`, text.slice(0, 300), { finishReason: reason }); // cut-ok: error text; the answer was refused whole
  }
  if (!candidate && data?.promptFeedback?.blockReason) {
    throw failure(`Model failure: the model refused the prompt (${data.promptFeedback.blockReason}).`, "");
  }
  return text;
}

/**
 * The first whole JSON object or array wrapped in prose, or null. A span that
 * opens is read to its close or not at all: nothing inside it is ever taken on
 * its own, so a cut list is never read as its first complete item.
 */
function extractEmbeddedJson(str) {
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch !== "{" && ch !== "[") { i++; continue; }
    const stack = [ch];
    let inString = false;
    let escape = false;
    let j = i + 1;
    let closed = false;
    for (; j < str.length; j++) {
      const c = str[j];
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{" || c === "[") stack.push(c);
      else if (c === "}" || c === "]") {
        if (stack[stack.length - 1] !== (c === "}" ? "{" : "[")) break;
        stack.pop();
        if (stack.length === 0) { closed = true; break; }
      }
    }
    // An opening never closed runs to the end of the answer: the answer was cut.
    if (!closed && j >= str.length) return null;
    if (closed) {
      try {
        return JSON.parse(str.slice(i, j + 1));
      } catch {
        // Not JSON after all (a bracket in prose): look on past it, never inside it.
      }
    }
    i = j + 1;
  }
  return null;
}

/** Read JSON as it is, inside a code fence, or wrapped in prose; only a whole answer. */
export function readJson(text) {
  const raw = String(text ?? "");
  const trimmed = raw.trim();

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue to search within text
    }
  }

  const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw);
  if (fenceMatch) {
    const fenced = fenceMatch[1].trim();
    try {
      return JSON.parse(fenced);
    } catch {
      const inner = extractEmbeddedJson(fenced);
      if (inner !== null) return inner;
    }
  }

  const extracted = extractEmbeddedJson(raw);
  if (extracted !== null) {
    return extracted;
  }

  const snippet = raw.slice(0, 300); // cut-ok: error text; the whole answer was refused
  throw failure(`Model failure: the model returned no whole JSON: ${snippet}`, snippet);
}

/**
 * Whether a model a run config chose can be used now (run configs,
 * docs/run-config-plan.md): true, or the reason in words. Asks the model
 * service about the model (models.get, which spends no tokens) only when a
 * run config names one; a job with no run config never calls this. A model
 * that is not a Gemini or Claude model, is not offered (a retired model
 * answers 404), or cannot generate content cannot be used, and the job
 * refuses rather than running on another. Claude, and Gemini without a key,
 * are asked on Vertex AI with the smallest real call (one output token, and
 * no thinking setting at all: Sonnet 5.5 and Opus 5.5 refuse "thinking":
 * {"type": "disabled"} with a 400, which made a run config naming Sonnet 5.5
 * look unusable, meme-writer 0.1.4, 2026-10-09; with none sent, Haiku, Sonnet
 * and Opus 5.5 all answer), because Vertex answers a description of a model the project
 * cannot call (its token counter answered for Haiku 5.5 on a project that
 * had not enabled it, 2026-10-08); that call costs about a hundred-thousandth
 * of a dollar.
 */
export async function modelAvailable(model, { env = process.env, fetchImpl = fetch } = {}) {
  const name = modelNameOf(model);
  if (!/^gemini-/i.test(name) && !isClaude(name)) return `this agent calls Gemini and Claude models only, and ${model} is not one`;
  // A replay calls no model, so whether the service offers it now does not matter; nothing is asked.
  if (inReplay(env)) return true;
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (isClaude(name) || !apiKey || !String(apiKey).trim()) {
    const where = vertexWhere(env);
    if (!where) return isClaude(name) ? "no Vertex AI project is set to call Claude in (GOOGLE_CLOUD_PROJECT)" : "GOOGLE_GENERATIVE_AI_API_KEY is absent and no Vertex AI project is set, so no model can be called";
    const tiny = isClaude(name)
      ? { anthropic_version: VERTEX_VERSION, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }
      : { contents: [{ role: "user", parts: [{ text: "ok" }] }], generationConfig: { maxOutputTokens: 16 } };
    let r;
    try {
      r = await fetchImpl(vertexUrl(name, where, isClaude(name) ? "rawPredict" : "generateContent"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await jobToken(fetchImpl)}` },
        body: JSON.stringify(tiny),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      return `the model service could not be asked about it (${String(err?.message ?? err)})`;
    }
    await r.text().catch(() => "");
    if (r.status === 404) return `Vertex AI does not offer it in ${where.project} at ${where.location}; it may not be enabled there, or it may have been retired`;
    if (!r.ok) return `Vertex AI answered ${r.status} when asked about it in ${where.project} at ${where.location}`;
    return true;
  }
  let res;
  try {
    res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}`, {
      headers: { "x-goog-api-key": String(apiKey).trim() },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return `the model service could not be asked about it (${String(err?.message ?? err)})`;
  }
  if (res.status === 404) return "the model service does not offer it; it may have been retired";
  if (!res.ok) return `the model service answered ${res.status} when asked about it`;
  const info = await res.json().catch(() => null);
  const methods = Array.isArray(info?.supportedGenerationMethods) ? info.supportedGenerationMethods : null;
  if (methods && !methods.includes("generateContent")) return "the model service offers it, but not for generating content";
  return true;
}

/** Ask the model endpoint for JSON and return the parsed result. */
export async function askJson(arg, options = {}) {
  const text = await callModel(arg, { ...options, json: true });
  return readJson(text);
}

export const defaultCaller = callModel;
export default callModel;

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const mod = process.env.AGENT_MODEL;
  if (!mod || (!key && !vertexWhere(process.env))) {
    console.error("Required environment variables missing: AGENT_MODEL, and GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_CLOUD_PROJECT");
    process.exit(2);
  }
  const prompt = process.argv.slice(2).join(" ") || "Hello";
  callModel(prompt)
    .then((out) => {
      console.log(out);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
