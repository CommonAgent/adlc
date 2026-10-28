// Which service the model is reached through, and what comes back from it.
//   node --test test/draft-service.test.mjs
//
// The model is a setting (TEXT_MODEL, else AGENT_MODEL), and there is no
// default. A google-vertex-anthropic/ name is Claude on Vertex; a bare name is a Gemini model and goes
// to Google; any other name with a provider in front is refused before a call.
// Nothing here touches the network: the functions build the call and read the
// answer, and main sends. An answer cut at the output limit is refused by
// name, because a cut JSON answer otherwise reads as "not JSON" and the real
// reason is lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_MODEL, OUTPUT_TOKENS, draftRequest, httpRequestFor, serviceOf, textOf } from "../scripts/draft.mjs";

const KEY = "not-a-real-key-0000";

test("a vertex name is Claude on Vertex, a bare name is google's, and any other provider or no name is none", () => {
  assert.equal(serviceOf("google-vertex-anthropic/some-model"), "vertex");
  assert.equal(serviceOf("gemini-3.8-flash"), "google");
  assert.equal(serviceOf("anthropic/claude-sonnet-5.5"), "none");
  assert.equal(serviceOf("  "), "none", "a blank name is no model: there is no default");
});

test("with no model configured, no call is built and the reason names both settings", () => {
  assert.throws(() => httpRequestFor(draftRequest({ env: {} }), KEY), (e) => e.message === NO_MODEL);
  assert.match(NO_MODEL, /TEXT_MODEL/);
  assert.match(NO_MODEL, /AGENT_MODEL/);
});

test("the output limit is generous enough for a whole long answer", () => {
  assert.ok(Number.isInteger(OUTPUT_TOKENS) && OUTPUT_TOKENS >= 32000, "a long spec or suite must not be cut");
});

test("a model from any other provider is refused in words and no call is built", () => {
  const request = draftRequest({ env: { TEXT_MODEL: "anthropic/claude-sonnet-5.5" } });
  assert.throws(() => httpRequestFor(request, KEY), /not one this agent reaches/);
});

test("a gemini model goes to google as before, with the same output limit", () => {
  const request = draftRequest({ env: { TEXT_MODEL: "gemini-3.8-flash" } });
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

// Claude on Google Vertex AI (since 2026-09-29):
// the credential says where to call, a token from the job's own service
// account pays, and the tokens are recorded with no cost stated.
test("a google-vertex-anthropic model goes to Vertex with a token, the credential only saying where", async () => {
  const { metadataToken, vertexCost } = await import("../scripts/draft.mjs");
  const model = "google-vertex-anthropic/claude-sonnet-5-5";
  assert.equal(serviceOf(model), "vertex");
  const request = draftRequest({ env: { TEXT_MODEL: model } });
  const h = httpRequestFor(request, "langbench-1528148150979/us", "ya29.not-real");
  assert.equal(h.url, "https://aiplatform.us.rep.googleapis.com/v1/projects/langbench-1528148150979/locations/us/publishers/anthropic/models/claude-sonnet-5-5:rawPredict");
  assert.equal(h.headers.authorization, "Bearer ya29.not-real");
  const body = JSON.parse(h.body);
  assert.equal(body.anthropic_version, "vertex-2023-10-16");
  assert.equal(body.model, undefined, "the model is in the address");
  assert.equal(body.max_tokens, OUTPUT_TOKENS);
  assert.throws(() => httpRequestFor(request, "no-slash", "t"), /<project>\/<location>/);
  const got = textOf("vertex", { model: "claude-sonnet-5-5", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{\"a\":1}" }], stop_reason: "end_turn", usage: { input_tokens: 10000, output_tokens: 1000 } }, model);
  assert.equal(got.text, "{\"a\":1}");
  assert.equal(got.answered_by, model);
  assert.deepEqual(got.usage, { tokens_in: 10000, tokens_out: 1000, cost: null });
  assert.throws(() => textOf("vertex", { content: [], stop_reason: "max_tokens" }, model), /cut at the output limit/);
  assert.equal(vertexCost("google-vertex-anthropic/some-model@20251001", 1_000_000, 0), null);
  const seen = [];
  const tok = await metadataToken(async (url, init) => { seen.push([url, init.headers["Metadata-Flavor"]]); return new Response(JSON.stringify({ access_token: "ya29.x" })); });
  assert.equal(tok, "ya29.x");
  assert.deepEqual(seen, [["http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", "Google"]]);
  await assert.rejects(metadataToken(async () => new Response("", { status: 404 })), /metadata server answered 404/);
});
