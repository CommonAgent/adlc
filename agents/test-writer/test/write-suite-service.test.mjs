// Which service the model is reached through, and what comes back from it.
//   node --test test/write-suite-service.test.mjs
//
// The model is a setting (TEXT_MODEL). A google-vertex-anthropic/ name is
// Claude on Vertex, and is the default; a bare name is a Gemini model and goes
// to Google; any other name with a provider in front is refused before a call.
// Nothing here touches the network: the functions build the call and read the
// answer, and main sends. An answer cut at the output limit is refused by
// name, because a cut JSON answer otherwise reads as "not JSON" and the real
// reason is lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL, OUTPUT_TOKENS, suiteRequest, httpRequestFor, serviceOf, textOf } from "../scripts/write-suite.mjs";

const KEY = "not-a-real-key-0000";

test("a vertex name is Claude on Vertex and the default, a bare name is google's, and any other provider is none", () => {
  assert.equal(MODEL, "google-vertex-anthropic/claude-sonnet-5-5");
  assert.equal(serviceOf("gemini-3.8-flash"), "google");
  assert.equal(serviceOf("anthropic/claude-sonnet-5.5"), "none");
  assert.equal(serviceOf("  "), "vertex", "a blank name falls back like the default model does");
});

test("the output limit is generous enough for a whole long answer", () => {
  assert.ok(Number.isInteger(OUTPUT_TOKENS) && OUTPUT_TOKENS >= 32000, "a long spec or suite must not be cut");
});

test("a model from any other provider is refused in words and no call is built", () => {
  const request = suiteRequest({ env: { TEXT_MODEL: "anthropic/claude-sonnet-5.5" } });
  assert.throws(() => httpRequestFor(request, KEY), /not one this agent reaches/);
});

test("a gemini model goes to google as before, with the same output limit", () => {
  const request = suiteRequest({ env: { TEXT_MODEL: "gemini-3.8-flash" } });
  const h = httpRequestFor(request, KEY);
  assert.equal(h.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(h.headers["x-goog-api-key"], KEY);
  const body = JSON.parse(h.body);
  assert.deepEqual(body.contents, request.body.contents);
  assert.equal(body.generationConfig.maxOutputTokens, OUTPUT_TOKENS);
  assert.ok(!h.body.includes(KEY), "the key never travels in the body");
});

test("a google answer gives its text and what it used", () => {
  const got = textOf("google", {
    modelVersion: "gemini-3.8-flash",
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"a\"" }, { text: ":1}" }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
  });
  assert.equal(got.text, "{\"a\":1}");
  assert.equal(got.answered_by, "gemini-3.8-flash");
  assert.deepEqual(got.usage, { tokens_in: 100, tokens_out: 20, cost: null });
});

test("an answer cut at the output limit is refused as cut, from either service", () => {
  assert.throws(() => textOf("vertex", { content: [{ type: "text", text: "{\"sp" }], stop_reason: "max_tokens" }), /cut/);
  assert.throws(() => textOf("google", { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }), /cut/);
});

// Claude on Google Vertex AI (since 2026-09-29).
test("a google-vertex-anthropic model goes to Vertex with a token, the credential only saying where", async () => {
  const m = await import("../scripts/write-suite.mjs");
  const model = "google-vertex-anthropic/claude-sonnet-5-5";
  assert.equal(m.serviceOf(model), "vertex");
  const request = { model, body: { contents: [{ parts: [{ text: "a" }, { text: "b" }] }] } };
  const h = m.httpRequestFor(request, "langbench-1528148150979/us", "ya29.not-real");
  assert.equal(h.url, "https://aiplatform.us.rep.googleapis.com/v1/projects/langbench-1528148150979/locations/us/publishers/anthropic/models/claude-sonnet-5-5:rawPredict");
  assert.equal(h.headers.authorization, "Bearer ya29.not-real");
  const body = JSON.parse(h.body);
  assert.deepEqual(body.messages, [{ role: "user", content: "a\n\nb" }]);
  assert.equal(body.anthropic_version, "vertex-2023-10-16");
  assert.equal(body.model, undefined);
  const got = m.textOf("vertex", { model: "claude-sonnet-5-5", content: [{ type: "text", text: "x" }], usage: { input_tokens: 1000000, output_tokens: 0 } }, model);
  assert.deepEqual(got, { text: "x", answered_by: model, usage: { tokens_in: 1000000, tokens_out: 0, cost: 2.2 } });
  assert.throws(() => m.textOf("vertex", { stop_reason: "max_tokens" }, model), /cut at the output limit/);
  assert.equal(await m.metadataToken(async () => new Response(JSON.stringify({ access_token: "ya29.y" }))), "ya29.y");
});
