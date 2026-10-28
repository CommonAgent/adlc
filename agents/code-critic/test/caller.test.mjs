// The caller: the configured model, and nothing else.
//   node --test test/caller.test.mjs
//
// What is worth pinning: the model is read from TEXT_MODEL, then AGENT_MODEL,
// and with neither there is no call and the reason says so, because this
// package names no model of its own; a Vertex name is called with a token
// from the machine and a place, a Gemini name with its key in a header and
// never in the body; any other provider is refused in words; an answer cut
// at its limit throws rather than being read as whole.
//
// Nothing here reaches a network: fetch is handed in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerOf, callModel, cannotCall, configuredModel, httpRequestFor, serviceOf } from "../scripts/caller.mjs";

test("the model is the configured one, TEXT_MODEL first, and there is no default", () => {
  assert.deepEqual(configuredModel({ TEXT_MODEL: "a", AGENT_MODEL: "b" }), { model: "a", variable: "TEXT_MODEL" });
  assert.deepEqual(configuredModel({ AGENT_MODEL: "google/b" }), { model: "google/b", variable: "AGENT_MODEL" });
  assert.equal(configuredModel({}), null);
  assert.match(cannotCall({}), /no model is configured/);
});

test("a provider this package does not reach is refused in words", () => {
  assert.equal(serviceOf("openai/x"), "none");
  assert.match(cannotCall({ TEXT_MODEL: "openai/x", TEXT_API_KEY: "k" }), /names a provider this package does not reach/);
});

test("a Gemini name is called with its key in a header, never in the body", () => {
  const env = { TEXT_MODEL: "some-model", TEXT_API_KEY: "the-key" };
  const req = httpRequestFor("hello", env);
  assert.match(req.url, /models\/some-model:generateContent$/);
  assert.equal(req.headers["x-goog-api-key"], "the-key");
  assert.doesNotMatch(req.body, /the-key/);
  const viaHost = httpRequestFor("hello", { AGENT_MODEL: "google/other", GOOGLE_GENERATIVE_AI_API_KEY: "host-key" });
  assert.match(viaHost.url, /models\/other:generateContent$/);
  assert.equal(viaHost.headers["x-goog-api-key"], "host-key");
  assert.match(cannotCall({ TEXT_MODEL: "some-model" }), /credential is not placed/);
});

test("a Vertex name is called at the place it is given, with the machine's token", async () => {
  const env = { TEXT_MODEL: "google-vertex-anthropic/some-claude@default", GOOGLE_CLOUD_PROJECT: "p", GOOGLE_CLOUD_LOCATION: "us" };
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, opts });
    if (/metadata/.test(url)) return { ok: true, json: async () => ({ access_token: "tok" }) };
    return { ok: true, json: async () => ({ model: "some-claude", content: [{ type: "text", text: "<<<NONE>>>" }], usage: { input_tokens: 3, output_tokens: 1 } }) };
  };
  const out = await callModel("hello", { env, fetchImpl });
  assert.equal(out.text, "<<<NONE>>>");
  assert.equal(out.answered_by, "google-vertex-anthropic/some-claude");
  assert.match(seen[1].url, /aiplatform\.us\.rep\.googleapis\.com\/v1\/projects\/p\/locations\/us\/publishers\/anthropic\/models\/some-claude@default:rawPredict/);
  assert.equal(seen[1].opts.headers.authorization, "Bearer tok");
  assert.match(cannotCall({ TEXT_MODEL: "google-vertex-anthropic/x" }), /nowhere to call/);
});

test("an answer cut at its limit throws", () => {
  assert.throws(() => answerOf("gemini", { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "half" }] } }] }), /cut at the output limit/);
  assert.throws(() => answerOf("vertex", { stop_reason: "max_tokens" }), /cut/);
  assert.equal(answerOf("gemini", { candidates: [{ content: { parts: [{ text: "a", thought: true }, { text: "b" }] } }] }).text, "b");
});

test("a service that answers an error is said with its status", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "model not found" });
  await assert.rejects(callModel("x", { env: { TEXT_MODEL: "m", TEXT_API_KEY: "k" }, fetchImpl }), /answered 404: model not found/);
});
