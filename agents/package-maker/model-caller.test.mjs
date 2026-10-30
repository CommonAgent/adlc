// The shared model caller, against a stand-in model service for each protocol.
//   node --test model-caller.test.mjs
//
// What is worth pinning: the four settings are read on every call, with
// TEXT_MODEL and TEXT_API_KEY as older names and none for the endpoint; each
// protocol is spoken at the address its endpoint gives, with the key in its
// own header and nowhere else; an answer is read whole, streamed or not, and a
// cut, refused or early-stopped answer is a failure that says so; a service's
// error carries its status without the key; a call that runs out of time says
// how long it waited. And the file itself: no address, only node's own
// modules, and every copy in a package byte for byte this one.
//
// Every call goes to a stand-in on 127.0.0.1 started here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROTOCOLS, OUTPUT_TOKENS, JSON_SYSTEM, askJson, callModel, callerFor, cannotCall, modelSettings,
  readJson, readStream, replayCaller, timeoutFor, urlFor,
} from "./shared/model-caller.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MASTER = join(HERE, "shared", "model-caller.mjs");

/** A stand-in model service: answer(req, body) gives {status, type, text}.
 *  Every request is kept in `seen` with its path, headers and parsed body. */
async function standIn(answer) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    let body = null;
    try { body = JSON.parse(raw); } catch { body = raw; }
    const r = { method: req.method, url: req.url, headers: req.headers, body };
    seen.push(r);
    const out = await answer(r);
    if (out === "hang") return;
    res.writeHead(out.status ?? 200, { "content-type": out.type ?? "application/json" });
    res.end(typeof out.text === "string" ? out.text : JSON.stringify(out.json));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, seen, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
}

const sse = (events) => events.map((e) => `event: ${e.type ?? "message"}\ndata: ${JSON.stringify(e)}\n\n`).join("");

test("the four settings, the older names for one version, and no older name for the endpoint", () => {
  const s = modelSettings({ MODEL_NAME: "m", MODEL_ENDPOINT: "http://h", MODEL_KEY: "k", MODEL_PROTOCOL: "gemini" });
  assert.deepEqual(s, { name: "m", endpoint: "http://h", key: "k", protocol: "gemini", from: { name: "MODEL_NAME", key: "MODEL_KEY" } });
  const old = modelSettings({ TEXT_MODEL: "t", TEXT_API_KEY: "tk" });
  assert.equal(old.name, "t");
  assert.equal(old.key, "tk");
  assert.deepEqual(old.from, { name: "TEXT_MODEL", key: "TEXT_API_KEY" });
  // An empty MODEL_KEY is a placed credential that is empty: the older key is not read.
  assert.equal(modelSettings({ MODEL_KEY: "", TEXT_API_KEY: "tk" }).key, "");
  assert.equal(modelSettings({ MODEL_NAME: "m", TEXT_MODEL: "t" }).name, "m");
  // AGENT_MODEL is not one of the names this caller reads.
  assert.equal(modelSettings({ AGENT_MODEL: "a" }).name, "");
});

test("each missing or wrong setting is refused in words that name it", () => {
  const ok = { MODEL_NAME: "m", MODEL_ENDPOINT: "http://127.0.0.1:1", MODEL_PROTOCOL: "openai-chat" };
  assert.equal(cannotCall(ok), "");
  assert.equal(cannotCall({ ...ok, MODEL_KEY: "" }), "");
  assert.match(cannotCall({ ...ok, MODEL_NAME: "" }), /^MODEL_NAME is not set/);
  assert.match(cannotCall({ ...ok, MODEL_ENDPOINT: undefined }), /^MODEL_ENDPOINT is not set, so there is nowhere to call the model/);
  assert.match(cannotCall({ TEXT_MODEL: "t", TEXT_API_KEY: "k" }), /^MODEL_ENDPOINT is not set/);
  assert.match(cannotCall({ ...ok, MODEL_ENDPOINT: "ftp://h" }), /not an http or https address/);
  assert.match(cannotCall({ ...ok, MODEL_ENDPOINT: "http://u:p@127.0.0.1" }), /carries a credential/);
  assert.match(cannotCall({ ...ok, MODEL_PROTOCOL: "" }), /^MODEL_PROTOCOL is not set.*anthropic-messages, openai-chat, gemini/);
  assert.match(cannotCall({ ...ok, MODEL_PROTOCOL: "vertex" }), /^MODEL_PROTOCOL vertex is not one this caller speaks/);
  assert.deepEqual(PROTOCOLS, ["anthropic-messages", "openai-chat", "gemini"]);
  // A protocol outside what the package's model system declares is refused too.
  assert.equal(cannotCall(ok, { protocols: ["openai-chat", "gemini"] }), "");
  assert.match(cannotCall(ok, { protocols: ["anthropic-messages"] }), /^MODEL_PROTOCOL openai-chat is not one this package's model system declares: it speaks anthropic-messages/);
  assert.throws(() => callerFor(ok, fetch, { protocols: ["gemini"] }), /not one this package's model system declares/);
});

test("nothing is sent when a setting is missing", async () => {
  let sent = 0;
  await assert.rejects(callModel("hi", { env: { MODEL_NAME: "m", MODEL_PROTOCOL: "gemini" }, fetchImpl: async () => { sent++; } }), /MODEL_ENDPOINT is not set/);
  assert.throws(() => callerFor({ MODEL_ENDPOINT: "http://127.0.0.1:1", MODEL_PROTOCOL: "gemini" }), /MODEL_NAME is not set/);
  assert.equal(sent, 0);
});

test("where each protocol is called: one trailing slash off the endpoint, then the path 12.4.1 gives", () => {
  const at = (protocol, endpoint, o) => urlFor({ protocol, endpoint, name: "the-model" }, o);
  assert.equal(at("anthropic-messages", "http://g:8788"), "http://g:8788/v1/messages");
  assert.equal(at("anthropic-messages", "http://g:8788/"), "http://g:8788/v1/messages");
  assert.equal(at("anthropic-messages", "http://g/api"), "http://g/api/v1/messages");
  assert.equal(at("openai-chat", "http://g/v1"), "http://g/v1/chat/completions");
  assert.equal(at("openai-chat", "http://g/v1/"), "http://g/v1/chat/completions");
  assert.equal(at("gemini", "http://g/v1beta"), "http://g/v1beta/models/the-model:generateContent");
  assert.equal(at("gemini", "http://g/v1beta/", { stream: true }), "http://g/v1beta/models/the-model:streamGenerateContent?alt=sse");
  assert.equal(urlFor({ protocol: "gemini", endpoint: "http://g", name: "models/x" }), "http://g/models/models/x:generateContent");
});

test("anthropic-messages: the key in x-api-key, the prompt as one user turn, the answer read whole", async () => {
  const s = await standIn(() => ({ json: { model: "answered-model", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "Hel" }, { type: "text", text: "lo" }], stop_reason: "end_turn", usage: { input_tokens: 7, output_tokens: 2 } } }));
  try {
    const env = { MODEL_NAME: "the-model", MODEL_ENDPOINT: s.origin, MODEL_KEY: "secret-key", MODEL_PROTOCOL: "anthropic-messages" };
    const out = await callModel("hello", { env, system: "be brief", maxOutputTokens: 500, effort: "low" });
    assert.deepEqual(out, { model: "the-model", protocol: "anthropic-messages", text: "Hello", answered_by: "answered-model", tokens_in: 7, tokens_out: 2 });
    const r = s.seen[0];
    assert.equal(r.url, "/v1/messages");
    assert.equal(r.headers["x-api-key"], "secret-key");
    assert.equal(r.headers["anthropic-version"], "2023-06-01");
    assert.equal(r.headers.authorization, undefined);
    assert.deepEqual(r.body, { model: "the-model", max_tokens: 500, messages: [{ role: "user", content: "hello" }], system: "be brief", output_config: { effort: "low" } });
    assert.doesNotMatch(JSON.stringify(r.body), /secret-key/);
  } finally { await s.close(); }
});

test("anthropic-messages: an empty key sends no key header, which is how a host's gateway is reached", async () => {
  const s = await standIn(() => ({ json: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } }));
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_KEY: "", TEXT_API_KEY: "old-project/old-place", MODEL_PROTOCOL: "anthropic-messages" };
    assert.equal((await callModel("hi", { env, effort: "off", json: true })).text, "ok");
    const r = s.seen[0];
    assert.equal(r.headers["x-api-key"], undefined);
    assert.deepEqual(r.body.thinking, { type: "disabled" });
    assert.equal(r.body.system, JSON_SYSTEM);
    await assert.rejects(callModel("hi", { env, effort: "max" }), /effort max is not one of/);
  } finally { await s.close(); }
});

test("anthropic-messages: a streamed answer is added up into the whole message", async () => {
  const events = [
    { type: "message_start", message: { model: "streamed-model", usage: { input_tokens: 3 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "a long " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
    { type: "message_stop" },
  ];
  const s = await standIn(() => ({ type: "text/event-stream", text: sse(events) }));
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_PROTOCOL: "anthropic-messages" };
    const out = await callModel("hi", { env, stream: true });
    assert.equal(out.text, "a long answer");
    assert.equal(out.answered_by, "streamed-model");
    assert.equal(out.tokens_in, 3);
    assert.equal(out.tokens_out, 4);
    assert.equal(s.seen[0].body.stream, true);
    assert.equal(s.seen[0].headers.accept, "text/event-stream");
  } finally { await s.close(); }
  assert.equal(readStream("anthropic-messages", sse(events.slice(0, -1))).status, 502);
  assert.equal(readStream("anthropic-messages", sse([{ type: "error", error: { type: "overloaded_error", message: "busy" } }])).status, 529);
});

test("anthropic-messages: a cut, refused or early-stopped answer is a failure that says so", async () => {
  for (const [stop, words] of [["max_tokens", /cut at its limit of 64 tokens/], ["refusal", /refused the prompt/], ["pause_turn", /stopped its answer early \(stop reason pause_turn\)/]]) {
    const s = await standIn(() => ({ json: { content: [{ type: "text", text: "part" }], stop_reason: stop } }));
    try {
      const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_PROTOCOL: "anthropic-messages" };
      await assert.rejects(callModel("hi", { env, maxOutputTokens: 64 }), (e) => e.modelFailure === true && words.test(e.message));
    } finally { await s.close(); }
  }
});

test("openai-chat: a bearer key, a system turn, JSON asked for, the answer and its usage read", async () => {
  const s = await standIn(() => ({ json: { model: "answered", choices: [{ message: { role: "assistant", content: "{\"a\":1}" }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 5 } } }));
  try {
    const env = { MODEL_NAME: "chat-model", MODEL_ENDPOINT: `${s.origin}/v1`, MODEL_KEY: "sk-test", MODEL_PROTOCOL: "openai-chat" };
    assert.deepEqual(await askJson("give me a", { env, maxOutputTokens: 100 }), { a: 1 });
    const r = s.seen[0];
    assert.equal(r.url, "/v1/chat/completions");
    assert.equal(r.headers.authorization, "Bearer sk-test");
    assert.deepEqual(r.body, { model: "chat-model", max_tokens: 100, messages: [{ role: "system", content: JSON_SYSTEM }, { role: "user", content: "give me a" }], response_format: { type: "json_object" } });
    const out = await callModel("again", { env });
    assert.equal(out.tokens_in, 11);
    assert.equal(out.tokens_out, 5);
    assert.equal(out.answered_by, "answered");
    assert.equal(s.seen[1].body.max_tokens, OUTPUT_TOKENS);
    assert.equal(s.seen[1].body.effort, undefined);
  } finally { await s.close(); }
});

test("openai-chat: a streamed answer, and an answer cut at its length", async () => {
  const chunks = [
    { model: "s", choices: [{ delta: { role: "assistant", content: "" } }] },
    { model: "s", choices: [{ delta: { content: "one " } }] },
    { model: "s", choices: [{ delta: { content: "two" }, finish_reason: "stop" }] },
    { model: "s", choices: [], usage: { prompt_tokens: 2, completion_tokens: 2 } },
  ];
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  const s = await standIn((r) => (r.body.stream ? { type: "text/event-stream", text: body } : { json: { choices: [{ message: { content: "cu" }, finish_reason: "length" }] } }));
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_PROTOCOL: "openai-chat" };
    const out = await callModel("hi", { env, stream: true });
    assert.equal(out.text, "one two");
    assert.equal(out.tokens_out, 2);
    assert.deepEqual(s.seen[0].body.stream_options, { include_usage: true });
    assert.equal(s.seen[0].headers.authorization, undefined);
    await assert.rejects(callModel("hi", { env }), (e) => e.cutAtLimit === true && /cut at its limit/.test(e.message));
  } finally { await s.close(); }
});

test("gemini: the key in x-goog-api-key, the model in the address, thought parts left out", async () => {
  const s = await standIn(() => ({ json: { modelVersion: "g-answered", candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "the " }, { text: "answer" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 } } }));
  try {
    const env = { MODEL_NAME: "gem-model", MODEL_ENDPOINT: `${s.origin}/v1beta`, MODEL_KEY: "g-key", MODEL_PROTOCOL: "gemini" };
    const out = await callModel("hi", { env, json: true, system: "short", maxOutputTokens: 256 });
    assert.deepEqual(out, { model: "gem-model", protocol: "gemini", text: "the answer", answered_by: "g-answered", tokens_in: 9, tokens_out: 3 });
    const r = s.seen[0];
    assert.equal(r.url, "/v1beta/models/gem-model:generateContent");
    assert.equal(r.headers["x-goog-api-key"], "g-key");
    assert.deepEqual(r.body, {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { maxOutputTokens: 256, responseMimeType: "application/json" },
      systemInstruction: { parts: [{ text: `short\n\n${JSON_SYSTEM}` }] },
    });
  } finally { await s.close(); }
});

test("gemini: a streamed answer, a blocked prompt, and a stop that is not STOP", async () => {
  const chunks = [
    { candidates: [{ content: { parts: [{ text: "hmm", thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: "stre" }] } }] },
    { candidates: [{ content: { parts: [{ text: "amed" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 }, modelVersion: "gs" },
  ];
  const s = await standIn((r) => (r.url.includes("stream") ? { type: "text/event-stream", text: chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join("") }
    : r.body.contents[0].parts[0].text === "blocked" ? { json: { promptFeedback: { blockReason: "SAFETY" } } }
      : { json: { candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "RECITATION" }] } }));
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_PROTOCOL: "gemini" };
    const out = await callModel("hi", { env, stream: true });
    assert.equal(out.text, "streamed");
    assert.equal(out.answered_by, "gs");
    assert.equal(s.seen[0].url, "/models/m:streamGenerateContent?alt=sse");
    assert.deepEqual(s.seen[0].body.generationConfig.thinkingConfig, { includeThoughts: true });
    assert.equal(s.seen[0].headers["x-goog-api-key"], undefined);
    await assert.rejects(callModel("blocked", { env }), /refused the prompt \(SAFETY\)/);
    await assert.rejects(callModel("other", { env }), /finish reason RECITATION/);
  } finally { await s.close(); }
});

test("a prompt of text and pictures goes as one user turn in each protocol's own form", async () => {
  const png = "iVBORw0KGgo=";
  const prompt = [{ type: "text", text: "what is in the frame?" }, { type: "image", media_type: "image/PNG", data: `${png}\n` }, { type: "text", text: "one line" }];
  const answers = {
    "anthropic-messages": { content: [{ type: "text", text: "a cat" }], stop_reason: "end_turn" },
    "openai-chat": { choices: [{ message: { content: "a cat" }, finish_reason: "stop" }] },
    gemini: { candidates: [{ content: { parts: [{ text: "a cat" }] }, finishReason: "STOP" }] },
  };
  const s = await standIn((r) => ({ json: answers[r.url.includes("/v1/messages") ? "anthropic-messages" : r.url.includes("/chat/completions") ? "openai-chat" : "gemini"] }));
  try {
    for (const protocol of PROTOCOLS) {
      const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_KEY: "", MODEL_PROTOCOL: protocol };
      assert.equal((await callModel(prompt, { env })).text, "a cat");
    }
    const [a, o, g] = s.seen.map((r) => r.body);
    assert.deepEqual(a.messages, [{ role: "user", content: [
      { type: "text", text: "what is in the frame?" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
      { type: "text", text: "one line" },
    ] }]);
    assert.deepEqual(o.messages, [{ role: "user", content: [
      { type: "text", text: "what is in the frame?" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
      { type: "text", text: "one line" },
    ] }]);
    assert.deepEqual(g.contents, [{ role: "user", parts: [{ text: "what is in the frame?" }, { inlineData: { mimeType: "image/png", data: png } }, { text: "one line" }] }]);
  } finally { await s.close(); }
});

test("a part the caller cannot send is refused before anything is sent, and a string is sent as before", async () => {
  const s = await standIn(() => ({ json: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } }));
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_KEY: "", MODEL_PROTOCOL: "anthropic-messages" };
    await assert.rejects(callModel([], { env }), /empty list of parts/);
    await assert.rejects(callModel([{ type: "image", media_type: "image/tiff", data: "AAAA" }], { env }), /prompt part 1 is a picture of media type image\/tiff/);
    await assert.rejects(callModel([{ type: "text", text: "hi" }, { type: "image", media_type: "image/png", data: "not base64!" }], { env }), /prompt part 2 is a picture whose bytes are not base64/);
    await assert.rejects(callModel([{ type: "audio", data: "AAAA" }], { env }), /prompt part 1 is neither a text part nor a picture/);
    await assert.rejects(callModel([{ type: "text" }], { env }), /prompt part 1 is a text part with no text/);
    assert.equal(s.seen.length, 0);
    await callModel("plain words", { env });
    assert.equal(s.seen[0].body.messages[0].content, "plain words");
  } finally { await s.close(); }
});

test("a service's error carries its status and what it said, with the key and any token left out", async () => {
  const s = await standIn(() => ({ status: 401, json: { error: { message: "bad key secret-key-123 for Bearer abc.def" } } }));
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_KEY: "secret-key-123", MODEL_PROTOCOL: "openai-chat" };
    await assert.rejects(callModel("hi", { env }), (e) => {
      assert.equal(e.status, 401);
      assert.match(e.message, /^the model service at 127\.0\.0\.1:\d+ answered 401: /);
      assert.doesNotMatch(e.message, /secret-key-123|abc\.def/);
      return true;
    });
  } finally { await s.close(); }
});

test("a call that runs out of time says how long it waited, and one with nowhere to go says so", async () => {
  const s = await standIn(() => "hang");
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_PROTOCOL: "anthropic-messages" };
    await assert.rejects(callModel("hi", { env, timeoutMs: 300 }), (e) => e.status === 504 && /gave no whole answer within 0.3 seconds/.test(e.message));
  } finally { await s.close(); }
  const closed = await standIn(() => ({ json: {} }));
  await closed.close();
  await assert.rejects(callModel("hi", { env: { MODEL_NAME: "m", MODEL_ENDPOINT: closed.origin, MODEL_PROTOCOL: "gemini" } }), (e) => e.status === 503 && /could not be reached/.test(e.message));
  assert.equal(timeoutFor(0), 60_000);
  assert.equal(timeoutFor(5000), 160_000);
  assert.equal(timeoutFor(10_000_000), 15 * 60_000);
});

test("the settings are read again on every call", async () => {
  const a = await standIn(() => ({ json: { content: [{ type: "text", text: "from a" }], stop_reason: "end_turn" } }));
  const b = await standIn(() => ({ json: { content: [{ type: "text", text: "from b" }], stop_reason: "end_turn" } }));
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: a.origin, MODEL_PROTOCOL: "anthropic-messages" };
    const caller = callerFor(env);
    assert.equal((await caller.ask("1")).text, "from a");
    env.MODEL_ENDPOINT = b.origin;
    env.MODEL_NAME = "other";
    assert.equal((await caller.ask("2")).text, "from b");
    assert.equal(caller.model, "other");
    assert.equal(b.seen[0].body.model, "other");
  } finally { await a.close(); await b.close(); }
});

test("the exchange is handed to a job's own wrapper, which may keep or answer it", async () => {
  const s = await standIn(() => ({ json: { content: [{ type: "text", text: "live" }], stop_reason: "end_turn" } }));
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: s.origin, MODEL_PROTOCOL: "anthropic-messages" };
    const kept = [];
    const out = await callModel("hi", { env, exchange: async (x) => { const r = await x.call(); kept.push({ ...x, r }); return r; } });
    assert.equal(out.text, "live");
    assert.equal(kept[0].service, "anthropic-messages");
    assert.equal(kept[0].model, "m");
    assert.equal(kept[0].body.messages[0].content, "hi");
    assert.equal(kept[0].r.status, 200);
    const replayed = await callModel("hi", { env, exchange: async () => ({ status: 200, text: JSON.stringify({ content: [{ type: "text", text: "saved" }], stop_reason: "end_turn" }) }) });
    assert.equal(replayed.text, "saved");
    assert.equal(s.seen.length, 1);
  } finally { await s.close(); }
});

test("a replay answers from files in order and sends nothing; JSON is read only whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "model-caller-"));
  writeFileSync(join(dir, "1.txt"), "first");
  writeFileSync(join(dir, "2.txt"), "second");
  const r = replayCaller(`${join(dir, "1.txt")}, ${join(dir, "2.txt")}`);
  assert.equal((await r.ask()).text, "first");
  assert.equal((await r.ask()).text, "second");
  assert.equal((await r.ask()).text, "second");
  assert.deepEqual(readJson("```json\n{\"a\": [1, 2]}\n```"), { a: [1, 2] });
  assert.deepEqual(readJson("Here it is: {\"b\": true} and that is all."), { b: true });
  assert.throws(() => readJson("{\"items\": [{\"a\": 1}, {\"b\":"), (e) => e.modelFailure === true && /no whole JSON/.test(e.message));
});

test("the caller writes no address and uses only node's own modules", () => {
  const src = readFileSync(MASTER, "utf8");
  assert.doesNotMatch(src, /\b(?:https?|wss?):\/\/[A-Za-z0-9[$]/);
  assert.doesNotMatch(src, /metadata\.google\.internal|googleapis|anthropic\.com|openai\.com/);
  assert.doesNotMatch(src, /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/);
  for (const m of src.matchAll(/^import .* from "([^"]+)";$/gm)) assert.match(m[1], /^node:/, `${m[1]} is not one of node's own modules`);
  assert.doesNotMatch(src, /GOOGLE_|AGENT_MODEL|VERTEX/);
});

test("every package's copy of the caller is this one", () => {
  const canonical = readFileSync(MASTER);
  const agents = join(HERE, "..");
  for (const agent of readdirSync(agents)) {
    const copy = join(agents, agent, "scripts", "model-caller.mjs");
    if (!existsSync(copy)) continue;
    assert.ok(readFileSync(copy).equals(canonical), `${agent}/scripts/model-caller.mjs is not package-maker/shared/model-caller.mjs`);
  }
});
