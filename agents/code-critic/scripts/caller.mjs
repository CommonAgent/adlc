// The one place this package reaches a model: the configured model, turned
// into a call, and the answer read back.
//
// WHICH MODEL IS NEVER WRITTEN HERE. The install places the model as a
// setting of the text-reasoning system, TEXT_MODEL, or as the model the host
// runs every agent on, AGENT_MODEL; this file reads the first that is set and
// refuses in words when neither is. There is no default, because a model
// named in a package is a rebuild waiting to happen: models are retired on
// somebody else's schedule, and Brand reader shipped with one written into a
// script and answered 404 the day it went (owner, 2026-10-27).
//
// How the name is read. A name starting google-vertex-anthropic/ is Claude on
// Google Vertex AI: no key, a token from the machine the job runs on, and the
// place to call given either as the credential (<project>/<location>) or as
// GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION, which the deployment
// manager places for that provider. A bare name, or one starting google/, is
// a Gemini model reached with a key: TEXT_API_KEY, the credential the
// text-reasoning system is bound with, else GOOGLE_GENERATIVE_AI_API_KEY, the
// key the host lends for that provider. Any other provider is refused in
// words. The two endpoints below are those providers' own published wire,
// the binding's and not a system's, so a review of this package holds them
// to that and nothing else.
//
// Nothing is silently cut: an answer stopped at its output limit is a
// failure that says so, never read as if it were whole.
//
//   needs: node >= 22; TEXT_MODEL or AGENT_MODEL; and TEXT_API_KEY (or the
//   host's provider key) for a keyed model
//   TEXT_MODEL=<model> TEXT_API_KEY=<key> PROMPT_FILE=<text> node caller.mjs

const trim = (s) => String(s ?? "").trim();

export const VERTEX = "google-vertex-anthropic";
const GEMINI_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** The most one answer may hold. A review of a whole package runs long. */
export const OUTPUT_TOKENS = 32000;

/** The configured model and the variable it came from, or null. */
export function configuredModel(env = {}) {
  for (const variable of ["TEXT_MODEL", "AGENT_MODEL"]) {
    const model = trim(env[variable]);
    if (model) return { model, variable };
  }
  return null;
}

/** Which service a model name is reached at: vertex, gemini, or none. */
export function serviceOf(model) {
  const m = trim(model);
  if (!m) return "none";
  if (m.startsWith(`${VERTEX}/`)) return "vertex";
  if (!m.includes("/") || m.startsWith("google/")) return "gemini";
  return "none";
}

/** Why a call cannot be made with these settings, or "" when it can. */
export function cannotCall(env = {}) {
  const c = configuredModel(env);
  if (!c) return "no model is configured: the install places one as TEXT_MODEL (the text-reasoning system's setting) or AGENT_MODEL, and this package names none of its own";
  const service = serviceOf(c.model);
  if (service === "none") return `the configured model ${c.model} names a provider this package does not reach: name a ${VERTEX}/<id> model (Claude on Vertex AI) or a Gemini model`;
  if (service === "gemini" && !trim(env.TEXT_API_KEY) && !trim(env.GOOGLE_GENERATIVE_AI_API_KEY)) {
    return "the text-reasoning credential is not placed: TEXT_API_KEY (or the host's GOOGLE_GENERATIVE_AI_API_KEY) is empty";
  }
  if (service === "vertex" && !vertexPlace(env)) {
    return "there is nowhere to call Claude on Vertex AI: the credential is <project>/<location>, or GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are placed";
  }
  return "";
}

/** Where to call Vertex: {project, location}, or null. */
export function vertexPlace(env = {}) {
  const [p, l] = trim(env.TEXT_API_KEY).split("/");
  if (p && l) return { project: p, location: l };
  const project = trim(env.GOOGLE_CLOUD_PROJECT), location = trim(env.GOOGLE_CLOUD_LOCATION);
  return project && location ? { project, location } : null;
}

export function vertexUrl(model, place) {
  const id = trim(model).slice(VERTEX.length + 1);
  const { project, location } = place;
  const host = location === "global" ? "aiplatform.googleapis.com"
    : location === "us" || location === "eu" ? `aiplatform.${location}.rep.googleapis.com` : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${id}:rawPredict`;
}

/** The HTTP call for a prompt, as plain values. Nothing is sent here. For a
 *  Vertex model `token` pays; for a keyed one the key goes in a header and
 *  nowhere in the body. */
export function httpRequestFor(prompt, env = {}, { token = "", outputTokens = OUTPUT_TOKENS } = {}) {
  const why = cannotCall(env);
  if (why) throw new Error(why);
  const { model } = configuredModel(env);
  if (serviceOf(model) === "vertex") {
    return {
      url: vertexUrl(model, vertexPlace(env)),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ anthropic_version: "vertex-2023-10-16", max_tokens: outputTokens, messages: [{ role: "user", content: String(prompt) }] }),
    };
  }
  const name = model.startsWith("google/") ? model.slice("google/".length) : model;
  return {
    url: `${GEMINI_ROOT}/${encodeURIComponent(name)}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": trim(env.TEXT_API_KEY) || trim(env.GOOGLE_GENERATIVE_AI_API_KEY) },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: String(prompt) }] }], generationConfig: { maxOutputTokens: outputTokens } }),
  };
}

const countOf = (n) => (Number.isFinite(n) ? n : null);

/** The text of an answer, which model gave it, and what it used. An answer
 *  cut at its limit throws, saying so. */
export function answerOf(service, data) {
  if (service === "vertex") {
    if (data?.stop_reason === "max_tokens") throw new Error("the answer was cut at the output limit");
    const u = data?.usage ?? {};
    return {
      text: (Array.isArray(data?.content) ? data.content : []).filter((c) => c?.type === "text").map((c) => c.text ?? "").join(""),
      answered_by: trim(data?.model) ? `${VERTEX}/${trim(data.model)}` : null,
      tokens_in: countOf(u.input_tokens), tokens_out: countOf(u.output_tokens),
    };
  }
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("the answer was cut at the output limit");
  const u = data?.usageMetadata ?? {};
  return {
    text: (candidate?.content?.parts ?? []).filter((p) => !p?.thought).map((p) => p.text ?? "").join(""),
    answered_by: trim(data?.modelVersion) || null,
    tokens_in: countOf(u.promptTokenCount), tokens_out: countOf(u.candidatesTokenCount),
  };
}

/** A token from the metadata server of the machine the job runs on. */
export async function metadataToken(fetchImpl = fetch) {
  const r = await fetchImpl(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!r.ok) throw new Error(`the metadata server answered ${r.status}, so there is no token for Vertex`);
  const d = await r.json();
  if (!trim(d?.access_token)) throw new Error("the metadata server gave no token for Vertex");
  return d.access_token;
}

/** One call. Returns {text, model, answered_by, tokens_in, tokens_out}. */
export async function callModel(prompt, { env = process.env, fetchImpl = fetch, outputTokens = OUTPUT_TOKENS } = {}) {
  const why = cannotCall(env);
  if (why) throw new Error(why);
  const { model } = configuredModel(env);
  const service = serviceOf(model);
  const token = service === "vertex" ? await metadataToken(fetchImpl) : "";
  const req = httpRequestFor(prompt, env, { token, outputTokens });
  const r = await fetchImpl(req.url, { method: "POST", headers: req.headers, body: req.body });
  if (!r.ok) {
    const said = await r.text().catch(() => "");
    throw new Error(`the text-reasoning service answered ${r.status}${said ? `: ${said.slice(0, 300)}` : ""}`);
  }
  return { model, ...answerOf(service, await r.json()) };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { readFileSync } = await import("node:fs");
  if (!process.env.PROMPT_FILE) { console.error("PROMPT_FILE is required"); process.exit(2); }
  try {
    const out = await callModel(readFileSync(process.env.PROMPT_FILE, "utf8"));
    console.log(JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exitCode = 1;
  }
}
