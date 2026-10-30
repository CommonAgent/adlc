// The bridge's Gemini format and its Speech-to-Text v2 passthrough, against a
// stand-in Vertex and a stand-in Speech service on 127.0.0.1.
//   node --test host/test/gemini-and-speech.test.mjs
//
// What is worth pinning: the shared caller on MODEL_PROTOCOL gemini, set to the
// bridge with no key, reaches Vertex's publishers/google/models/<model> as the
// machine; the key header and a key in the address go nowhere; a streamed answer
// comes back as events; what an agent sends today (a system instruction, JSON
// output, an inline image, the google_search tool) arrives under Vertex's names,
// with a role on every content; and the Speech passthrough carries recognize for
// the bridge's own project and refuses every other project, action and API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.BRIDGE_LISTEN = "0";
const { bridgeHandler, geminiPath, speechPath, speechOrigin, vertexGeminiBody } = await import("../responses-bridge.mjs");
const { callModel } = await import("../../agents/package-maker/shared/model-caller.mjs");

const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
};

async function standIn(answer) {
  const seen = [];
  const s = await listen(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const r = { url: req.url, headers: req.headers, raw, body: raw ? JSON.parse(raw) : null };
    seen.push(r);
    const out = answer(r);
    res.writeHead(out.status ?? 200, { "content-type": out.type ?? "application/json" });
    res.end(out.text ?? JSON.stringify(out.json));
  });
  return { ...s, seen };
}

async function bridgeTo(vertex, speech) {
  return listen(bridgeHandler({ origin: "http://unused.invalid", project: "the-project", region: "global", token: async () => "machine-token", fetchImpl: fetch,
    geminiOrigin: vertex.origin, geminiRegion: "global", speechProject: "the-project", speechOrigin: () => speech?.origin ?? "http://unused.invalid" }));
}

const ANSWER = { candidates: [{ content: { role: "model", parts: [{ text: "from gemini" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 }, modelVersion: "gemini-3.8-flash" };

test("a gemini call reaches Vertex's Google model as the machine, and no key travels", async () => {
  const vertex = await standIn(() => ({ json: ANSWER }));
  const bridge = await bridgeTo(vertex);
  try {
    const env = { MODEL_NAME: "gemini-3.8-flash", MODEL_ENDPOINT: bridge.origin, MODEL_KEY: "should-not-travel", MODEL_PROTOCOL: "gemini" };
    const out = await callModel("hello", { env, maxOutputTokens: 100, system: "be brief", json: true });
    assert.equal(out.text, "from gemini");
    assert.equal(out.tokens_in, 5);
    const r = vertex.seen[0];
    assert.equal(r.url, "/v1/projects/the-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent");
    assert.equal(r.headers.authorization, "Bearer machine-token");
    assert.equal(r.headers["x-goog-api-key"], undefined);
    assert.doesNotMatch(JSON.stringify(r), /should-not-travel/);
    assert.equal(r.body.contents[0].role, "user");
    assert.equal(r.body.generationConfig.responseMimeType, "application/json");
    assert.match(r.body.systemInstruction.parts[0].text, /be brief/);
  } finally { await bridge.close(); await vertex.close(); }
});

test("a streamed gemini call goes to the streamed door with alt=sse and comes back as events", async () => {
  const sse = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "streamed " }] } }] })}\n\ndata: ${JSON.stringify({ ...ANSWER, candidates: [{ content: { parts: [{ text: "through" }] }, finishReason: "STOP" }] })}\n\n`;
  const vertex = await standIn(() => ({ type: "text/event-stream", text: sse }));
  const bridge = await bridgeTo(vertex);
  try {
    const env = { MODEL_NAME: "gemini-3.8-flash", MODEL_ENDPOINT: bridge.origin, MODEL_KEY: "", MODEL_PROTOCOL: "gemini" };
    const out = await callModel("hi", { env, stream: true });
    assert.equal(out.text, "streamed through");
    assert.equal(vertex.seen[0].url, "/v1/projects/the-project/locations/global/publishers/google/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  } finally { await bridge.close(); await vertex.close(); }
});

test("what agents send today arrives under Vertex's names: images, JSON, a system instruction, google_search", async () => {
  const vertex = await standIn(() => ({ json: ANSWER }));
  const bridge = await bridgeTo(vertex);
  try {
    const body = {
      contents: [{ parts: [{ text: "what is this?" }, { inline_data: { mime_type: "image/png", data: "iVBORw0KGgo=" } }] }],
      system_instruction: { parts: [{ text: "answer plainly" }] },
      generation_config: { response_mime_type: "application/json", response_schema: { type: "object", properties: { snake_case_field: { type: "string" } } }, max_output_tokens: 50 },
      tools: [{ google_search: {} }],
    };
    const r = await fetch(`${bridge.origin}/models/google%2Fgemini-3.8-flash:generateContent?key=in-the-address`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": "k" }, body: JSON.stringify(body) });
    assert.equal(r.status, 200);
    const seen = vertex.seen[0];
    assert.equal(seen.url, "/v1/projects/the-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent");
    assert.deepEqual(seen.body, {
      contents: [{ role: "user", parts: [{ text: "what is this?" }, { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }] }],
      systemInstruction: { parts: [{ text: "answer plainly" }] },
      generationConfig: { responseMimeType: "application/json", responseSchema: { type: "object", properties: { snake_case_field: { type: "string" } } }, maxOutputTokens: 50 },
      tools: [{ googleSearch: {} }],
    });
    assert.equal(seen.headers["x-goog-api-key"], undefined);
  } finally { await bridge.close(); await vertex.close(); }
});

test("the web searcher's googleSearch with a time range passes as it is, and Vertex's failure comes back with its status", async () => {
  const vertex = await standIn((r) => (r.body.tools ? { json: ANSWER } : { status: 404, json: { error: { code: 404, message: "Publisher model not found", status: "NOT_FOUND" } } }));
  const bridge = await bridgeTo(vertex);
  try {
    const tool = { googleSearch: { timeRangeFilter: { startTime: "2026-10-01T00:00:00Z", endTime: "2026-10-29T00:00:00Z" } } };
    const ok = await fetch(`${bridge.origin}/models/gemini-3.8-flash:generateContent`, { method: "POST", body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "news" }] }], tools: [tool] }) });
    assert.equal(ok.status, 200);
    assert.deepEqual(vertex.seen[0].body.tools, [tool]);
    const missing = await fetch(`${bridge.origin}/models/gemini-retired:generateContent`, { method: "POST", body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "x" }] }] }) });
    assert.equal(missing.status, 404);
  } finally { await bridge.close(); await vertex.close(); }
});

test("the pieces: Gemini paths, Vertex's body, Speech paths and hosts", () => {
  assert.equal(geminiPath("/models/x:countTokens"), null);
  assert.deepEqual(geminiPath("/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse"), { model: "gemini-3.8-flash", method: "streamGenerateContent", alt: "sse" });
  assert.equal(vertexGeminiBody({ contents: "just words" }).contents[0].role, "user");
  assert.deepEqual(vertexGeminiBody({ contents: [{ role: "model", parts: [] }] }).contents[0].role, "model");
  assert.equal(speechPath("/v2/projects/p-roj1/locations/us/recognizers/_:recognize").location, "us");
  for (const bad of ["/v2/projects/p-roj1/locations/us/recognizers/_:batchRecognize", "/v2/projects/p-roj1/locations/us/recognizers",
    "/v2/projects/p-roj1/locations/us/operations/x", "/v2/projects/p-roj1/locations/us/recognizers/_:recognize?x=1", "/v2/projects/../locations/us/recognizers/_:recognize"]) {
    assert.equal(speechPath(bad), null, bad);
  }
  assert.equal(speechOrigin("us"), "https://us-speech.googleapis.com");
  assert.equal(speechOrigin("global"), "https://speech.googleapis.com");
});

test("Speech-to-Text v2 recognize passes for the bridge's own project, as the machine", async () => {
  const speech = await standIn(() => ({ json: { results: [{ alternatives: [{ transcript: "hello world" }] }], metadata: { totalBilledDuration: "3s" } } }));
  const bridge = await bridgeTo({ origin: "http://unused.invalid" }, speech);
  try {
    const body = { config: { autoDecodingConfig: {}, model: "chirp_3", languageCodes: ["en-US"] }, content: "AAAA" };
    const r = await fetch(`${bridge.origin}/v2/projects/the-project/locations/us/recognizers/_:recognize`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer agent-should-not-travel" }, body: JSON.stringify(body) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).results[0].alternatives[0].transcript, "hello world");
    const seen = speech.seen[0];
    assert.equal(seen.url, "/v2/projects/the-project/locations/us/recognizers/_:recognize");
    assert.equal(seen.headers.authorization, "Bearer machine-token");
    assert.deepEqual(seen.body, body);
  } finally { await bridge.close(); await speech.close(); }
});

test("the passthrough refuses another project, another action and any other Google API", async () => {
  const speech = await standIn(() => ({ json: {} }));
  const bridge = await bridgeTo({ origin: "http://unused.invalid" }, speech);
  try {
    const post = (path) => fetch(`${bridge.origin}${path}`, { method: "POST", body: "{}" });
    assert.equal((await post("/v2/projects/someone-else/locations/us/recognizers/_:recognize")).status, 403);
    assert.equal((await post("/v2/projects/the-project/locations/us/recognizers/_:batchRecognize")).status, 403);
    assert.equal((await post("/v2/projects/the-project/locations/us/operations/op1")).status, 403);
    assert.equal((await post("/v1/projects/the-project/locations/us/publishers/google/models/x:predict")).status, 404);
    assert.equal((await post("/v1beta/files")).status, 404);
    assert.equal(speech.seen.length, 0);
  } finally { await bridge.close(); await speech.close(); }
});
