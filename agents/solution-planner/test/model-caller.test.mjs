// The shared model caller reaches the text-reasoning service through the
// anthropic-messages protocol.
//
// What is worth pinning: the caller posts to /v1/messages with the model name,
// an anthropic-version header, and x-api-key only when MODEL_KEY is present;
// missing or invalid settings stop before any request is dispatched; settings
// are read on every run so different endpoints reach different servers; an
// answer cut at its token limit is treated as a failure; no script reads retired
// Google or metadata server variables or carries literal network addresses; and
// the package declarations match the anthropic-messages text-reasoning system.
// Nothing here touches an external network: all calls reach a stand-in server
// running on 127.0.0.1.
// Run: node --test test/model-caller.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, cutAtLimit } from "../scripts/model-caller.mjs";

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
    await callModel({
      env,
      messages: [{ role: "user", content: "hi" }],
      prompt: "hi",
    });
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
    await callModel({
      env: {
        MODEL_NAME: "m",
        MODEL_ENDPOINT: standIn.url,
        MODEL_PROTOCOL: "anthropic-messages",
        MODEL_KEY: "my-key-value",
      },
      messages: [{ role: "user", content: "1" }],
      prompt: "1",
    });
    assert.equal(seenHeaders[0]["x-api-key"], "my-key-value");

    await callModel({
      env: {
        MODEL_NAME: "m",
        MODEL_ENDPOINT: standIn.url,
        MODEL_PROTOCOL: "anthropic-messages",
        MODEL_KEY: "",
      },
      messages: [{ role: "user", content: "2" }],
      prompt: "2",
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
        () => callModel({
          env: { MODEL_NAME: name, MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: "anthropic-messages" },
          messages: [{ role: "user", content: "x" }],
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
      () => callModel({
        env: { MODEL_NAME: "m", MODEL_ENDPOINT: ep, MODEL_PROTOCOL: "anthropic-messages" },
        messages: [{ role: "user", content: "x" }],
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
        () => callModel({
          env: { MODEL_NAME: "m", MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: proto },
          messages: [{ role: "user", content: "x" }],
        }),
        /MODEL_PROTOCOL/
      );
    }
    assert.equal(calls, 0);
  } finally {
    await standIn.close();
  }
});

test("an unsupported model protocol stops before sending any request to the stand-in", async () => {
  let calls = 0;
  const standIn = await standInServer(() => { calls += 1; });
  try {
    await assert.rejects(
      () => callModel({
        env: { MODEL_NAME: "m", MODEL_ENDPOINT: standIn.url, MODEL_PROTOCOL: "openai-chat" },
        messages: [{ role: "user", content: "x" }],
      }),
      /MODEL_PROTOCOL/
    );
    assert.equal(calls, 0);
  } finally {
    await standIn.close();
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
    await callModel({ env: { ...base, MODEL_ENDPOINT: standInA.url }, messages: [{ role: "user", content: "hi" }] });
    assert.equal(countA, 1);
    assert.equal(countB, 0);

    await callModel({ env: { ...base, MODEL_ENDPOINT: standInB.url }, messages: [{ role: "user", content: "hi" }] });
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
      () => callModel({ env, messages: [{ role: "user", content: "hi" }] }),
      (err) => {
        assert.match(err.message, /limit/i);
        if (typeof cutAtLimit === "function") {
          assert.equal(cutAtLimit(err), true);
        }
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

test("the runtime requirements declare the text-reasoning system with anthropic-messages protocol", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const reqs = JSON.parse(readFileSync(join(root, "agent-runtime-requirements.json"), "utf8"));
  const list = reqs.systems ?? reqs;
  const textReasoning = list.find((s) => s.name === "text-reasoning");
  assert.ok(textReasoning, "text-reasoning is declared in runtime requirements");
  assert.equal(textReasoning.kind, "model");
  assert.deepEqual(textReasoning.protocols, ["anthropic-messages"]);
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
