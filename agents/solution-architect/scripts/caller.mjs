// The caller: the one way this package reaches its text-reasoning system.
//
// A model is a bound system (references/architecture-standard.md, section 3).
// Which model answers is configuration, never code: the install places it from
// the text-reasoning binding as TEXT_MODEL (AGENT_MODEL is read the same way
// where a host places that instead), and a run config may change it for one
// job. Nothing in this file names a model or a version, not as a default and
// not in a price table, and an empty setting is refused in words rather than
// filled in. The package maker refuses a new agent whose scripts name one.
//
// Two doors, chosen by the shape of the configured name, the same two every
// lifecycle agent uses:
//   - a name that starts google-vertex-anthropic/ is Claude on Google Vertex
//     AI, paid for with a token from the machine the job runs on; the
//     credential (TEXT_API_KEY) is then where to call, <project>/<location>;
//   - a bare name is a Gemini model reached at Google, and the credential is
//     its key.
// Any other name with a provider in front is refused in words.
//
//   needs: node >= 22; TEXT_API_KEY and TEXT_MODEL, placed by the install
import { readFileSync } from "node:fs";

const trim = (s) => String(s ?? "").trim();

/** The configured model, or "" when the install placed none. */
export const modelOf = (env = {}) => trim(env.TEXT_MODEL) || trim(env.AGENT_MODEL);

export const NO_MODEL = "TEXT_MODEL is not set, so no model is called: the text-reasoning binding chooses the model at install, and this package names none.";

export const VERTEX = "google-vertex-anthropic";
export const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** The most one answer may carry. An architecture answer is a few thousand
 *  tokens; the limit is far above it so a cut answer is never the reason. */
export const OUTPUT_TOKENS = 32000;

/** Which door a configured name goes through: "vertex", "google", or "none"
 *  for a name this package does not reach. An empty name is "none". */
export function serviceOf(model) {
  const m = trim(model);
  if (!m) return "none";
  if (m.startsWith(`${VERTEX}/`)) return "vertex";
  return m.includes("/") ? "none" : "google";
}

function vertexUrl(model, key) {
  const [project, location] = trim(key).split("/");
  if (!project || !location) throw new Error("the text-reasoning credential for a Vertex model is <project>/<location>");
  const id = trim(model).slice(VERTEX.length + 1).replace(/@default$/, "");
  const host = location === "global" ? "aiplatform.googleapis.com"
    : location === "us" || location === "eu" ? `aiplatform.${location}.rep.googleapis.com` : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${id}:rawPredict`;
}

/** The call as HTTP: url, headers and body, for one prompt. The key goes in a
 *  header and nowhere else. Pure; `ask` sends it. */
export function httpRequestFor({ model, prompt, key, token = "" }) {
  const service = serviceOf(model);
  if (service === "none") {
    throw new Error(trim(model)
      ? `the model ${trim(model)} is not one this agent reaches: configure a ${VERTEX}/<id> name or a bare Gemini name`
      : NO_MODEL);
  }
  if (service === "vertex") {
    return {
      url: vertexUrl(model, key),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ anthropic_version: "vertex-2023-10-16", max_tokens: OUTPUT_TOKENS, messages: [{ role: "user", content: prompt }] }),
    };
  }
  return {
    url: `${GOOGLE_URL}/${encodeURIComponent(trim(model))}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: OUTPUT_TOKENS, responseMimeType: "application/json" } }),
  };
}

const count = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Number(n));

/** The text that came back, the model that answered and what the call used.
 *  An answer cut at its limit is refused by name. */
export function textOf(service, data) {
  if (service === "vertex") {
    if (data?.stop_reason === "max_tokens") throw new Error("the text-reasoning answer was cut at the output limit");
    const text = (Array.isArray(data?.content) ? data.content : []).filter((c) => c?.type === "text").map((c) => c.text ?? "").join("");
    return { text, answered_by: trim(data?.model) ? `${VERTEX}/${trim(data.model)}` : null, tokens_in: count(data?.usage?.input_tokens), tokens_out: count(data?.usage?.output_tokens) };
  }
  const c = data?.candidates?.[0];
  if (c?.finishReason === "MAX_TOKENS") throw new Error("the text-reasoning answer was cut at the output limit");
  return {
    text: (c?.content?.parts ?? []).map((p) => p?.text ?? "").join(""),
    answered_by: trim(data?.modelVersion) || null,
    tokens_in: count(data?.usageMetadata?.promptTokenCount),
    tokens_out: count(data?.usageMetadata?.candidatesTokenCount),
  };
}

async function metadataToken(fetchImpl) {
  const r = await fetchImpl(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!r.ok) throw new Error(`the metadata server answered ${r.status}, so there is no token for Vertex`);
  const d = await r.json();
  if (!trim(d?.access_token)) throw new Error("the metadata server gave no token for Vertex");
  return d.access_token;
}

/** A caller for one job: `ask(prompt)` answers {text, answered_by, tokens_in,
 *  tokens_out}. Throws in words when the model or the credential is missing,
 *  before anything is sent. */
export function callerFor(env = process.env, fetchImpl = fetch) {
  const model = modelOf(env);
  if (!model) throw new Error(NO_MODEL);
  const key = trim(env.TEXT_API_KEY);
  if (!key) throw new Error("TEXT_API_KEY is not set: it is the text-reasoning credential the install places");
  const service = serviceOf(model);
  if (service === "none") httpRequestFor({ model, prompt: "", key });
  return {
    model,
    service,
    async ask(prompt) {
      const token = service === "vertex" ? await metadataToken(fetchImpl) : "";
      const http = httpRequestFor({ model, prompt, key, token });
      const r = await fetchImpl(http.url, { method: "POST", headers: http.headers, body: http.body });
      if (!r.ok) throw new Error(`the text-reasoning service answered ${r.status}`);
      const d = await r.json();
      if (d?.error) throw new Error(`the text-reasoning service refused: ${trim(d.error.message) || "no reason given"}`);
      return textOf(service, d);
    },
  };
}

/** A caller that answers from files instead of the service, in order, for a
 *  test or a replay: ANSWERS_FROM names the files, comma separated. Nothing is
 *  sent anywhere. */
export function replayCaller(paths) {
  const files = String(paths ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  let i = 0;
  return {
    model: "replay",
    service: "replay",
    async ask() {
      const p = files[Math.min(i, files.length - 1)];
      i += 1;
      return { text: readFileSync(p, "utf8"), answered_by: "replay", tokens_in: null, tokens_out: null };
    },
  };
}
