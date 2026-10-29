// The bridge's model gateway for agents: the shared model caller, set to the
// bridge with no key, reaches a stand-in Vertex as the machine.
//   node --test host/test/responses-bridge.test.mjs
//
// What is worth pinning: the agent sends a plain Messages API call and never a
// Google token; the bridge moves the model into Vertex's address (taking off
// the provider older settings wrote in front), sets Vertex's version, signs in
// with the machine's token, never passes on a key the agent sent, streams a
// streamed answer back, and hands Vertex's own status back on a failure.
//
// Nothing here reaches a network: Vertex is a stand-in on 127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.BRIDGE_LISTEN = "0";
const { bridgeHandler, vertexMessagesRequest, vertexModelId, vertexOrigin } = await import("../responses-bridge.mjs");
const { callModel } = await import("../../agents/package-maker/shared/model-caller.mjs");

const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
};

/** A stand-in Vertex that keeps each request and answers with answer(req). */
async function standInVertex(answer) {
  const seen = [];
  const s = await listen(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const r = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
    seen.push(r);
    const out = answer(r);
    res.writeHead(out.status ?? 200, { "content-type": out.type ?? "application/json" });
    res.end(out.text ?? JSON.stringify(out.json));
  });
  return { ...s, seen };
}

async function bridgeTo(vertex) {
  let tokens = 0;
  const b = await listen(bridgeHandler({ origin: vertex.origin, project: "the-project", region: "global", token: async () => { tokens++; return "machine-token"; }, fetchImpl: fetch }));
  return { ...b, tokens: () => tokens };
}

test("an agent's call reaches Vertex as the machine, with the model in the address", async () => {
  const vertex = await standInVertex(() => ({ json: { model: "claude-x", content: [{ type: "text", text: "from vertex" }], stop_reason: "end_turn", usage: { input_tokens: 4, output_tokens: 2 } } }));
  const bridge = await bridgeTo(vertex);
  try {
    const env = { MODEL_NAME: "google-vertex-anthropic/claude-x", MODEL_ENDPOINT: bridge.origin, MODEL_KEY: "", MODEL_PROTOCOL: "anthropic-messages" };
    const out = await callModel("hello", { env, maxOutputTokens: 100 });
    assert.equal(out.text, "from vertex");
    assert.equal(out.tokens_in, 4);
    const r = vertex.seen[0];
    assert.equal(r.url, "/v1/projects/the-project/locations/global/publishers/anthropic/models/claude-x:rawPredict");
    assert.equal(r.headers.authorization, "Bearer machine-token");
    assert.deepEqual(r.body, { max_tokens: 100, messages: [{ role: "user", content: "hello" }], anthropic_version: "vertex-2023-10-16" });
    assert.equal(bridge.tokens(), 1);
  } finally { await bridge.close(); await vertex.close(); }
});

test("a key the agent sends is never passed on", async () => {
  const vertex = await standInVertex(() => ({ json: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } }));
  const bridge = await bridgeTo(vertex);
  try {
    const env = { MODEL_NAME: "claude-x", MODEL_ENDPOINT: bridge.origin, MODEL_KEY: "should-not-travel", MODEL_PROTOCOL: "anthropic-messages" };
    await callModel("hi", { env });
    const r = vertex.seen[0];
    assert.equal(r.headers["x-api-key"], undefined);
    assert.equal(r.headers.authorization, "Bearer machine-token");
    assert.doesNotMatch(JSON.stringify(r), /should-not-travel/);
  } finally { await bridge.close(); await vertex.close(); }
});

test("a streamed call goes to the streamed door and comes back as events", async () => {
  const events = [
    { type: "message_start", message: { model: "claude-x", usage: { input_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "streamed through" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  ];
  const vertex = await standInVertex(() => ({ type: "text/event-stream", text: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("") }));
  const bridge = await bridgeTo(vertex);
  try {
    const env = { MODEL_NAME: "claude-x", MODEL_ENDPOINT: bridge.origin, MODEL_PROTOCOL: "anthropic-messages" };
    const out = await callModel("hi", { env, stream: true });
    assert.equal(out.text, "streamed through");
    assert.match(vertex.seen[0].url, /claude-x:streamRawPredict$/);
    assert.equal(vertex.seen[0].body.stream, true);
  } finally { await bridge.close(); await vertex.close(); }
});

test("Vertex's failure comes back with its own status, and a request with no model is refused", async () => {
  const vertex = await standInVertex(() => ({ status: 404, json: [{ error: { code: 404, message: "Publisher model not found" } }] }));
  const bridge = await bridgeTo(vertex);
  try {
    const env = { MODEL_NAME: "claude-retired", MODEL_ENDPOINT: bridge.origin, MODEL_PROTOCOL: "anthropic-messages" };
    await assert.rejects(callModel("hi", { env }), (e) => e.status === 404 && /answered 404: .*Publisher model not found/.test(e.message));
    const r = await fetch(`${bridge.origin}/v1/messages`, { method: "POST", body: JSON.stringify({ messages: [] }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error.message, /names no model/);
  } finally { await bridge.close(); await vertex.close(); }
});

test("the pieces: the model id, the request Vertex takes, and where each region is reached", () => {
  assert.equal(vertexModelId("google-vertex-anthropic/claude-x@default"), "claude-x");
  assert.equal(vertexModelId("claude-x"), "claude-x");
  const v = vertexMessagesRequest({ model: "claude-x", max_tokens: 5, messages: [] }, { origin: "http://v", project: "p", region: "us-east5" });
  assert.equal(v.url, "http://v/v1/projects/p/locations/us-east5/publishers/anthropic/models/claude-x:rawPredict");
  assert.deepEqual(v.body, { max_tokens: 5, messages: [], anthropic_version: "vertex-2023-10-16" });
  assert.match(vertexOrigin("global"), /\/\/aiplatform\.googleapis\.com$/);
  assert.match(vertexOrigin("us"), /\/\/aiplatform\.us\.rep\.googleapis\.com$/);
  assert.match(vertexOrigin("us-east5"), /\/\/us-east5-aiplatform\.googleapis\.com$/);
});
