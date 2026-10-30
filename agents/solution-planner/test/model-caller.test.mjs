// The shared model caller reaches the text-reasoning service in the format
// MODEL_PROTOCOL names: anthropic-messages, openai-chat or gemini.
//
// What is worth pinning: the caller posts to /v1/messages with the model name,
// an anthropic-version header, and x-api-key only when MODEL_KEY is present;
// missing or invalid settings, a protocol outside the caller's list or outside
// a narrower list passed, and declared protocols that cannot be read
// (PROTOCOLS_UNREAD) stop before any request is dispatched; each of the three
// declared protocols is sent in its own format; settings
// are read on every run so different endpoints reach different servers; an
// answer cut at its token limit is treated as a failure; no script reads retired
// Google or metadata server variables or carries literal network addresses; and
// the package declarations name the three protocols for text-reasoning.
// Nothing here touches an external network: all calls reach a stand-in server
// running on 127.0.0.1.
// Run: node --test test/model-caller.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel } from "../scripts/model-caller.mjs";
import { PROTOCOLS_UNREAD, askModel, cannotAsk, declaredProtocols } from "../scripts/ask.mjs";

function standInServer(onMessage) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch {}
      if (onMessage) {
        onMessage({ method: req.method, url: req.url, headers: req.headers, body, text }, res);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: body?.model || "test-model",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("a request to the stand-in sends post /v1/messages with the anthropic version and model name", async () => {
  let seen = null;
  const standIn = await standInServer((reqInfo, res) => {
    seen = reqInfo;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
  });
  try {
    const env = {
      MODEL_NAME: "claude-test",
      MODEL_ENDPOINT: standIn.url,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "secret-key",
    };
    await callModel("hi", { env });
    assert.ok(seen, "stand-in received a request");
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, "/v1/messages");
    assert.ok(seen.headers["anthropic-version"], "anthropic-version header present");
    assert.equal(seen.body.model, "claude-test");
  } finally {
    await standIn.close();
  }
});

test("the api key is passed in the x-api-key header only when model key is non-empty", async () => {
  const seenHeaders = [];
  const standIn = await standInServer((reqInfo, res) => {
    seenHeaders.push(reqInfo.headers);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "m",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 5 },
    }));
  });
  try {
    await callModel("1", {
      env: {
        MODEL_NAME: "m",
        MODEL_ENDPOINT: standIn.url,
        MODEL_PROTOCOL: "anthropic-messages",
        MODEL_KEY: "my-key-value",
      },
    });
    assert.equal(seenHeaders[0]["x-api-key"], "my-key-value");

    await callModel("2", {
      env: {
        MODEL_NAME: "m",
        MODEL_ENDPOINT: standIn.url,
        MODEL_PROTOCOL: "anthropic-messages",
        MODEL_KEY: "",
      },
    });
    assert.equal(seenHeaders[1]["x-api-key"], undefined);
  } finally {
    await standIn.close();
  }
});

test("a missing or empty model name stops before sending any request to the stand-in", async () => {
  let calls = 0;
  const standIn = await standInServer(() => { calls += 1; });
  try {
    for (const name of [undefined, ""]) {
      await assert.rejects(
        () => callModel("x", {
          env: { MODEL_NAME: name, MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: "anthropic-messages" },
        }),
        /MODEL_NAME/
      );
    }
    assert.equal(calls, 0);
  } finally {
    await standIn.close();
  }
});

test("a missing or empty model endpoint stops before sending any request to the stand-in", async () => {
  for (const ep of [undefined, ""]) {
    await assert.rejects(
      () => callModel("x", {
        env: { MODEL_NAME: "m", MODEL_ENDPOINT: ep, MODEL_PROTOCOL: "anthropic-messages" },
      }),
      /MODEL_ENDPOINT/
    );
  }
});

test("a missing or empty model protocol stops before sending any request to the stand-in", async () => {
  let calls = 0;
  const standIn = await standInServer(() => { calls += 1; });
  try {
    for (const proto of [undefined, ""]) {
      await assert.rejects(
        () => callModel("x", {
          env: { MODEL_NAME: "m", MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: proto },
        }),
        /MODEL_PROTOCOL/
      );
    }
    assert.equal(calls, 0);
  } finally {
    await standIn.close();
  }
});

// Each format's own answer, as a stand-in for that format gives it.
function answerFor(url, text) {
  if (url.startsWith("/v1/messages")) return { id: "msg_1", type: "message", role: "assistant", model: "test-model", content: [{ type: "text", text }], stop_reason: "end_turn" };
  if (url.startsWith("/chat/completions")) return { id: "c_1", model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] };
  return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], modelVersion: "test-model" };
}

test("the package declares anthropic-messages, openai-chat and gemini, and each is accepted and sent in its own format", async () => {
  const seen = [];
  const standIn = await standInServer((req, res) => {
    seen.push(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answerFor(req.url, "ok")));
  });
  try {
    // ask.mjs reads these and passes them to the caller.
    const protocols = declaredProtocols();
    assert.deepEqual(protocols, ["anthropic-messages", "openai-chat", "gemini"]);
    const expected = {
      "anthropic-messages": "/v1/messages",
      "openai-chat": "/chat/completions",
      gemini: "/models/test-model:generateContent",
    };
    for (const [protocol, path] of Object.entries(expected)) {
      const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: protocol, MODEL_KEY: "k-1234" };
      assert.equal(cannotAsk(env), "", protocol);
      const before = seen.length;
      const out = await callModel("x", { env, protocols });
      assert.equal(out.text, "ok", protocol);
      assert.equal(seen.length, before + 1, `${protocol} sent one request`);
      assert.equal(seen[before].method, "POST", protocol);
      assert.equal(seen[before].url, path, protocol);
    }
    const [anthropic, openai, gemini] = seen;
    assert.ok(anthropic.headers["anthropic-version"]);
    assert.equal(anthropic.headers["x-api-key"], "k-1234");
    assert.equal(anthropic.body.model, "test-model");
    assert.equal(openai.headers.authorization, "Bearer k-1234");
    assert.equal(openai.body.model, "test-model");
    assert.ok(Array.isArray(gemini.body.contents));
    assert.equal(gemini.headers["x-goog-api-key"], "k-1234");
  } finally {
    await standIn.close();
  }
});

test("an unsupported model protocol stops before sending any request to the stand-in", async () => {
  let calls = 0;
  const standIn = await standInServer(() => { calls += 1; });
  try {
    // A protocol outside the caller's closed list is refused, with the declared list passed or none.
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: "bedrock" };
    await assert.rejects(() => callModel("x", { env, protocols: declaredProtocols() }), /MODEL_PROTOCOL bedrock/);
    await assert.rejects(() => callModel("x", { env }), /MODEL_PROTOCOL bedrock/);
    assert.match(cannotAsk(env), /MODEL_PROTOCOL bedrock/);
    const asked = await askModel({ prompt: "x", env });
    assert.equal(asked.failed, true);
    assert.match(asked.error, /MODEL_PROTOCOL bedrock/);
    assert.deepEqual(asked.calls, []);
    assert.equal(calls, 0);
  } finally {
    await standIn.close();
  }
});

test("a declared protocols list is enforced: with a narrower list passed, a protocol outside it stops before sending", async () => {
  let calls = 0;
  const standIn = await standInServer(() => { calls += 1; });
  try {
    const narrower = ["anthropic-messages"];
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: "openai-chat" };
    await assert.rejects(() => callModel("x", { env, protocols: narrower }), /MODEL_PROTOCOL openai-chat/);
    assert.match(cannotAsk(env, { protocols: narrower }), /MODEL_PROTOCOL openai-chat/);
    const asked = await askModel({ prompt: "x", env, protocols: narrower });
    assert.equal(asked.failed, true);
    assert.match(asked.error, /MODEL_PROTOCOL openai-chat/);
    assert.deepEqual(asked.calls, []);
    assert.equal(calls, 0);
  } finally {
    await standIn.close();
  }
});

test("when the declared protocols cannot be read, nothing is sent and the words are PROTOCOLS_UNREAD", async () => {
  let calls = 0;
  const standIn = await standInServer((req, res) => { calls += 1; res.writeHead(200); res.end(); });
  const missing = mkdtempSync(join(tmpdir(), "solution-planner-noreqs-"));
  const empty = mkdtempSync(join(tmpdir(), "solution-planner-noprotocols-"));
  try {
    mkdirSync(join(missing, "scripts"));
    mkdirSync(join(empty, "scripts"));
    writeFileSync(join(empty, "agent-runtime-requirements.json"), JSON.stringify({ systems: [{ name: "text-reasoning", kind: "model" }] }));
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: "anthropic-messages" };
    for (const dir of [missing, empty]) {
      const protocols = declaredProtocols(join(dir, "scripts"));
      assert.equal(cannotAsk(env, { protocols }), PROTOCOLS_UNREAD, dir);
      const asked = await askModel({ prompt: "x", env, protocols, fetchImpl: async () => { calls += 1; throw new Error("nothing should be sent"); } });
      assert.equal(asked.failed, true);
      assert.deepEqual(asked.problems, [PROTOCOLS_UNREAD], dir);
      assert.deepEqual(asked.calls, []);
    }
    assert.equal(calls, 0, "nothing reached the stand-in");
  } finally {
    await standIn.close();
    rmSync(missing, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test("the endpoint setting is read on every run so different endpoints reach different servers", async () => {
  let countA = 0;
  let countB = 0;
  const standInA = await standInServer((_, res) => {
    countA += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "a", content: [{ type: "text", text: "a" }], stop_reason: "end_turn", usage: {} }));
  });
  const standInB = await standInServer((_, res) => {
    countB += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "b", content: [{ type: "text", text: "b" }], stop_reason: "end_turn", usage: {} }));
  });
  try {
    const base = { MODEL_NAME: "m", MODEL_PROTOCOL: "anthropic-messages" };
    await callModel("hi", { env: { ...base, MODEL_ENDPOINT: standInA.url } });
    assert.equal(countA, 1);
    assert.equal(countB, 0);

    await callModel("hi", { env: { ...base, MODEL_ENDPOINT: standInB.url } });
    assert.equal(countA, 1);
    assert.equal(countB, 1);
  } finally {
    await standInA.close();
    await standInB.close();
  }
});

test("an answer cut at its limit fails and indicates it was cut at its limit", async () => {
  const standIn = await standInServer((_, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_cut",
      type: "message",
      role: "assistant",
      model: "m",
      content: [{ type: "text", text: '{"format":"build-plan-v1"' }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 100 },
    }));
  });
  try {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: "anthropic-messages" };
    await assert.rejects(
      () => callModel("hi", { env }),
      (err) => {
        assert.match(err.message, /cut at its limit/i);
        assert.equal(err.cutAtLimit, true, "the caller marks a cut answer on the error it throws");
        return true;
      }
    );
  } finally {
    await standIn.close();
  }
});

test("no script reads retired google variables or names the metadata server", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const scriptsDir = join(root, "scripts");
  const files = readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"));
  for (const file of files) {
    const text = readFileSync(join(scriptsDir, file), "utf8");
    assert.equal(text.includes("metadata.google.internal"), false, `${file} names the metadata server`);
    assert.equal(text.includes("computeMetadata"), false, `${file} references computeMetadata`);
    assert.equal(text.includes("AGENT_MODEL"), false, `${file} references AGENT_MODEL`);
    assert.equal(text.includes("VERTEX_WHERE"), false, `${file} references VERTEX_WHERE`);
    assert.equal(/GOOGLE_[A-Z_]+/.test(text), false, `${file} references a GOOGLE_ variable`);
  }
});

test("no script under scripts carries a forbidden network address literal", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const scriptsDir = join(root, "scripts");
  const files = readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"));
  const forbidden = /(?:https?|wss?):\/\/(?!(?:www\.w3\.org|json-schema\.org|schemas\.xmlsoap\.org|schema\.org))[a-zA-Z0-9\[]|169\.254\./;
  for (const file of files) {
    const text = readFileSync(join(scriptsDir, file), "utf8");
    assert.equal(forbidden.test(text), false, `${file} carries a network address literal`);
  }
});

test("the runtime requirements declare the text-reasoning system with anthropic-messages, openai-chat and gemini", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const reqs = JSON.parse(readFileSync(join(root, "agent-runtime-requirements.json"), "utf8"));
  const list = reqs.systems ?? reqs;
  const textReasoning = list.find((s) => s.name === "text-reasoning");
  assert.ok(textReasoning, "text-reasoning is declared in runtime requirements");
  assert.equal(textReasoning.kind, "model");
  assert.deepEqual(textReasoning.protocols, ["anthropic-messages", "openai-chat", "gemini"]);
  assert.equal(textReasoning.credential, undefined);
  assert.equal(textReasoning.env, undefined);
  assert.equal(textReasoning.settings, undefined);
});

test("the plugin manifest lists the shared model caller and removes retired callers", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const plugin = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
  const text = JSON.stringify(plugin);
  assert.ok(text.includes("scripts/model-caller.mjs"), "plugin.json lists scripts/model-caller.mjs");
  assert.equal(text.includes("vertex-caller"), false, "plugin.json still lists vertex caller");
  assert.equal(text.includes("gemini-caller"), false, "plugin.json still lists gemini caller");
});
