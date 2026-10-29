// The shared caller: reaching the model through scripts/model-caller.mjs.
//
// What is worth pinning: the model is reached via HTTP POST /v1/messages with
// the anthropic-messages protocol; the model name is in the body, anthropic-version
// is set as a header, and x-api-key is present only when MODEL_KEY is not empty;
// missing or empty settings or an unsupported protocol refuse before any request
// is sent to the stand-in; settings are dynamic and read on every run; an answer
// cut at its limit (stop_reason max_tokens) is treated as a failure and never
// read as complete; and draft.mjs sends its prompt as plain text through the
// shared caller with remaining seconds as its limit and needs no TEXT_API_KEY.
//
// Nothing here touches a real network or real model service: all model calls
// go to an in-process stand-in server started on 127.0.0.1 with node:http.
// Run: node --test test/model-caller.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { callModel, validateSettings } from "../scripts/model-caller.mjs";
import { askForSpec } from "../scripts/draft.mjs";

function withStandIn(handler, body) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const endpoint = `http://127.0.0.1:${port}`;
      try {
        await body(endpoint);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("the stand-in receives a POST to /v1/messages with anthropic-version, model in body, and x-api-key when set", async () => {
  let seenRequest = null;
  const handler = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    seenRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(bodyText),
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: '{"spec":{"name":"demo"},"blanks":[]}' }],
      stop_reason: "end_turn",
    }));
  };

  await withStandIn(handler, async (endpoint) => {
    const env = {
      MODEL_NAME: "claude-test-v1",
      MODEL_ENDPOINT: endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "secret-key-123",
    };
    const reply = await callModel({ prompt: "draft an agent", env, seconds: 30 });
    assert.match(reply, /"name":\s*"demo"/);
    assert.equal(seenRequest.method, "POST");
    assert.equal(seenRequest.url, "/v1/messages");
    assert.ok(seenRequest.headers["anthropic-version"], "anthropic-version header missing");
    assert.equal(seenRequest.headers["x-api-key"], "secret-key-123");
    assert.equal(seenRequest.body.model, "claude-test-v1");
  });
});

test("when MODEL_KEY is unset or empty, no x-api-key header is sent to the stand-in", async () => {
  let headersSeen = null;
  const handler = async (req, res) => {
    headersSeen = req.headers;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "{}" }],
      stop_reason: "end_turn",
    }));
  };

  await withStandIn(handler, async (endpoint) => {
    const env = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "",
    };
    await callModel({ prompt: "ping", env, seconds: 10 });
    assert.equal("x-api-key" in headersSeen, false, "x-api-key should not be present when key is empty");
  });
});

test("a run with MODEL_NAME unset or empty stops before sending and names MODEL_NAME", async () => {
  let requests = 0;
  await withStandIn((req, res) => { requests += 1; res.end(); }, async (endpoint) => {
    const env = { MODEL_NAME: "", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "anthropic-messages" };
    assert.throws(() => validateSettings(env), /MODEL_NAME/);
    await assert.rejects(
      () => callModel({ prompt: "draft", env, seconds: 10 }),
      (err) => {
        assert.match(err.message, /MODEL_NAME/);
        return true;
      },
    );
    assert.equal(requests, 0, "no network request was made before refusing");
  });
});

test("a run with MODEL_ENDPOINT unset or empty stops before sending and names MODEL_ENDPOINT", async () => {
  const env = { MODEL_NAME: "model-1", MODEL_ENDPOINT: "", MODEL_PROTOCOL: "anthropic-messages" };
  assert.throws(() => validateSettings(env), /MODEL_ENDPOINT/);
  await assert.rejects(
    () => callModel({ prompt: "draft", env, seconds: 10 }),
    /MODEL_ENDPOINT/,
  );
});

test("a run with MODEL_PROTOCOL unset or empty stops before sending and names MODEL_PROTOCOL", async () => {
  const env = { MODEL_NAME: "model-1", MODEL_ENDPOINT: "http://127.0.0.1:9", MODEL_PROTOCOL: "" };
  assert.throws(() => validateSettings(env), /MODEL_PROTOCOL/);
  await assert.rejects(
    () => callModel({ prompt: "draft", env, seconds: 10 }),
    /MODEL_PROTOCOL/,
  );
});

test("a run with MODEL_PROTOCOL other than anthropic-messages stops before sending and names MODEL_PROTOCOL", async () => {
  let requests = 0;
  await withStandIn((req, res) => { requests += 1; res.end(); }, async (endpoint) => {
    const env = { MODEL_NAME: "model-1", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "openai-chat" };
    assert.throws(() => validateSettings(env), /MODEL_PROTOCOL/);
    await assert.rejects(
      () => callModel({ prompt: "draft", env, seconds: 10 }),
      /MODEL_PROTOCOL/,
    );
    assert.equal(requests, 0, "unsupported protocol was refused without contacting server");
  });
});

test("settings are read on every run so different MODEL_ENDPOINT values reach different stand-ins", async () => {
  let callsA = 0;
  let callsB = 0;
  const replyJson = JSON.stringify({
    id: "m", type: "message", role: "assistant", content: [{ type: "text", text: "{}" }], stop_reason: "end_turn",
  });

  await withStandIn((req, res) => { callsA += 1; res.writeHead(200, { "content-type": "application/json" }); res.end(replyJson); }, async (endA) => {
    await withStandIn((req, res) => { callsB += 1; res.writeHead(200, { "content-type": "application/json" }); res.end(replyJson); }, async (endB) => {
      const base = { MODEL_NAME: "m", MODEL_PROTOCOL: "anthropic-messages", MODEL_KEY: "" };
      await callModel({ prompt: "first", env: { ...base, MODEL_ENDPOINT: endA }, seconds: 10 });
      assert.equal(callsA, 1);
      assert.equal(callsB, 0);

      await callModel({ prompt: "second", env: { ...base, MODEL_ENDPOINT: endB }, seconds: 10 });
      assert.equal(callsA, 1);
      assert.equal(callsB, 1);
    });
  });
});

test("an answer with stop_reason max_tokens is refused as cut at limit and never treated as whole", async () => {
  const handler = (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_cut",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: '{"spec":{"name":"incomp' }],
      stop_reason: "max_tokens",
    }));
  };

  await withStandIn(handler, async (endpoint) => {
    const env = { MODEL_NAME: "m", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "anthropic-messages", MODEL_KEY: "" };
    await assert.rejects(
      () => callModel({ prompt: "draft", env, seconds: 10 }),
      (err) => {
        assert.match(err.message, /max_tokens|cut at its limit/);
        return true;
      },
    );
  });
});

test("draft.mjs sends prompt as plain text through the shared caller with remaining seconds and needs no TEXT_API_KEY", async () => {
  let promptSeen = null;
  const spec = {
    name: "tone-teller",
    version: "0.1.0",
    jobs: [{
      slug: "tell-tone", title: "Tell tone", offered: true,
      how: { control: "script", intelligence: "none", cost: "none", contract: "full" },
      when: "when asked", good: "an analysis of tone", empty: "say so", does: "Analyzes tone.",
    }],
    refuses: ["refusing act 0, because it is wrong, and it says so", "refusing act 1, because it is wrong, and it says so", "refusing act 2, because it is wrong, and it says so", "refusing act 3, because it is wrong, and it says so"],
    records: [{ name: "the signed job manifest" }],
    price: { model: "free" },
    systems: [],
  };

  const handler = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    promptSeen = body.messages[0].content;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "m",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify({ spec, blanks: [] }) }],
      stop_reason: "end_turn",
    }));
  };

  await withStandIn(handler, async (endpoint) => {
    const env = {
      MODEL_NAME: "text-model",
      MODEL_ENDPOINT: endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "k",
    };
    const asked = { asked: "v1", said: "Analyze the tone of incoming messages", attached: [], missing_files: [] };
    const out = await askForSpec({ asked, env, seconds: 120 });
    assert.equal(out.spec.name, "tone-teller");
    assert.equal(typeof promptSeen, "string", "prompt must be sent as plain text");
    assert.match(promptSeen, /Analyze the tone of incoming messages/);
    assert.equal("TEXT_API_KEY" in env, false);
  });
});
