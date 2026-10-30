// The shared caller: reaching the model through scripts/model-caller.mjs.
//
// What is worth pinning: the model is reached via HTTP POST /v1/messages with
// the anthropic-messages protocol; the model name is in the body, anthropic-version
// is set as a header, and x-api-key is present only when MODEL_KEY is not empty;
// the package declares anthropic-messages, openai-chat and gemini (in
// agent-runtime-requirements.json) and its own call sends each in its own
// format; missing or empty settings, a protocol outside the caller's list, one
// outside a narrower list passed, or declared protocols that cannot be read
// (PROTOCOLS_UNREAD), refuse before any request is sent to the stand-in; settings are dynamic and read on
// every run; an answer cut at its limit (stop_reason max_tokens) is a failure
// carrying cutAtLimit and never read as complete; and draft.mjs sends its
// prompt as plain text through the shared caller with remaining seconds as
// its limit and needs no TEXT_API_KEY.
//
// The caller is the shared one, copied byte for byte, and these tests use its
// real interface: callModel(prompt, {env, timeoutMs, protocols, ...}) answers
// {text, model, ...}; cannotCall(env, {protocols}) says why no call can be
// made, or ""; draft.mjs callFor(env) is the package's own call through it,
// passing the protocols the package declares.
//
// Nothing here touches a real network or real model service: all model calls
// go to an in-process stand-in server started on 127.0.0.1 with node:http.
// Run: node --test test/model-caller.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callModel, cannotCall } from "../scripts/model-caller.mjs";
import { PROTOCOLS_UNREAD, askForSpec, callFor, declaredProtocols, whyNoCall } from "../scripts/draft.mjs";

// The caller's refusal for these settings and this package's declared
// protocols, thrown, so a test can assert the words that name the setting.
const validateSettings = (env) => {
  const why = cannotCall(env, { protocols: declaredProtocols() });
  if (why) throw new Error(why);
};

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
    const reply = await callModel("draft an agent", { env, timeoutMs: 30_000 });
    assert.match(reply.text, /"name":\s*"demo"/);
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
    await callModel("ping", { env, timeoutMs: 10_000 });
    assert.equal("x-api-key" in headersSeen, false, "x-api-key should not be present when key is empty");
  });
});

test("a run with MODEL_NAME unset or empty stops before sending and names MODEL_NAME", async () => {
  let requests = 0;
  await withStandIn((req, res) => { requests += 1; res.end(); }, async (endpoint) => {
    const env = { MODEL_NAME: "", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "anthropic-messages" };
    assert.throws(() => validateSettings(env), /MODEL_NAME/);
    await assert.rejects(
      () => callModel("draft", { env, timeoutMs: 10_000 }),
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
    () => callModel("draft", { env, timeoutMs: 10_000 }),
    /MODEL_ENDPOINT/,
  );
});

test("a run with MODEL_PROTOCOL unset or empty stops before sending and names MODEL_PROTOCOL", async () => {
  const env = { MODEL_NAME: "model-1", MODEL_ENDPOINT: "http://127.0.0.1:9", MODEL_PROTOCOL: "" };
  assert.throws(() => validateSettings(env), /MODEL_PROTOCOL/);
  await assert.rejects(
    () => callModel("draft", { env, timeoutMs: 10_000 }),
    /MODEL_PROTOCOL/,
  );
});

// Each format's own answer, as a stand-in for that format gives it.
function answerFor(url, text) {
  if (url.startsWith("/v1/messages")) return { id: "msg_1", type: "message", role: "assistant", model: "test-model", content: [{ type: "text", text }], stop_reason: "end_turn" };
  if (url.startsWith("/chat/completions")) return { id: "c_1", model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] };
  return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], modelVersion: "test-model" };
}

test("the package declares anthropic-messages, openai-chat and gemini, and its own call sends each in its own format", async () => {
  assert.deepEqual(declaredProtocols(), ["anthropic-messages", "openai-chat", "gemini"]);
  const seen = [];
  const handler = async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answerFor(req.url, "{}")));
  };
  await withStandIn(handler, async (endpoint) => {
    const expected = {
      "anthropic-messages": "/v1/messages",
      "openai-chat": "/chat/completions",
      gemini: "/models/test-model:generateContent",
    };
    for (const [protocol, path] of Object.entries(expected)) {
      const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: protocol, MODEL_KEY: "k-1234" };
      assert.equal(whyNoCall(env), "", protocol);
      const before = seen.length;
      // callFor passes the declared protocols itself.
      const out = await callFor(env)({ body: { contents: [{ parts: [{ text: "draft" }] }] } }, { seconds: 10 });
      assert.equal(out.text, "{}", protocol);
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
  });
});

test("a run with MODEL_PROTOCOL outside the caller's list stops before sending and names MODEL_PROTOCOL", async () => {
  let requests = 0;
  await withStandIn((req, res) => { requests += 1; res.end(); }, async (endpoint) => {
    const env = { MODEL_NAME: "model-1", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "bedrock" };
    assert.throws(() => validateSettings(env), /MODEL_PROTOCOL/);
    assert.match(whyNoCall(env), /MODEL_PROTOCOL/);
    await assert.rejects(
      () => callModel("draft", { env, timeoutMs: 10_000 }),
      /MODEL_PROTOCOL/,
    );
    await assert.rejects(
      () => callFor(env)({ body: { contents: [{ parts: [{ text: "draft" }] }] } }, { seconds: 10 }),
      /MODEL_PROTOCOL/,
    );
    assert.equal(requests, 0, "a protocol the caller does not speak was refused without contacting the server");
  });
});

test("a declared protocols list is enforced: with a narrower list passed, a protocol outside it stops before sending and names MODEL_PROTOCOL", async () => {
  let requests = 0;
  await withStandIn((req, res) => { requests += 1; res.end(); }, async (endpoint) => {
    const narrower = ["anthropic-messages"];
    const env = { MODEL_NAME: "model-1", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "openai-chat" };
    assert.match(whyNoCall(env, { protocols: narrower }), /MODEL_PROTOCOL/);
    await assert.rejects(
      () => callModel("draft", { env, timeoutMs: 10_000, protocols: narrower }),
      /MODEL_PROTOCOL/,
    );
    await assert.rejects(
      () => callFor(env, { protocols: narrower })({ body: { contents: [{ parts: [{ text: "draft" }] }] } }, { seconds: 10 }),
      /MODEL_PROTOCOL/,
    );
    assert.equal(requests, 0, "a protocol outside the list passed was refused without contacting the server");
  });
});

test("when the declared protocols cannot be read, nothing is sent and the words are PROTOCOLS_UNREAD", async () => {
  let requests = 0;
  const missing = mkdtempSync(join(tmpdir(), "spec-writer-noreqs-"));
  const empty = mkdtempSync(join(tmpdir(), "spec-writer-noprotocols-"));
  try {
    mkdirSync(join(missing, "scripts"));
    mkdirSync(join(empty, "scripts"));
    writeFileSync(join(empty, "agent-runtime-requirements.json"), JSON.stringify({ systems: [{ name: "text-reasoning", kind: "model" }] }));
    await withStandIn((req, res) => { requests += 1; res.end(); }, async (endpoint) => {
      const env = { MODEL_NAME: "model-1", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "anthropic-messages" };
      for (const dir of [missing, empty]) {
        const protocols = declaredProtocols(join(dir, "scripts"));
        assert.equal(whyNoCall(env, { protocols }), PROTOCOLS_UNREAD, dir);
        await assert.rejects(
          () => callFor(env, { protocols, fetchImpl: async () => { requests += 1; throw new Error("nothing should be sent"); } })({ body: { contents: [{ parts: [{ text: "draft" }] }] } }, { seconds: 10 }),
          (err) => {
            assert.equal(err.message, PROTOCOLS_UNREAD, dir);
            return true;
          },
        );
      }
      assert.equal(requests, 0, "nothing reached the stand-in");
    });
  } finally {
    rmSync(missing, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
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
      await callModel("first", { env: { ...base, MODEL_ENDPOINT: endA }, timeoutMs: 10_000 });
      assert.equal(callsA, 1);
      assert.equal(callsB, 0);

      await callModel("second", { env: { ...base, MODEL_ENDPOINT: endB }, timeoutMs: 10_000 });
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
      () => callModel("draft", { env, timeoutMs: 10_000 }),
      (err) => {
        assert.equal(err.cutAtLimit, true, "the failure says the answer was cut");
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

  // The seconds the step has left are the call's limit: a service slower
  // than that is a failure at that limit, not a wait past the step's time.
  await withStandIn((req, res) => { setTimeout(() => { res.writeHead(200); res.end("{}"); }, 1500); }, async (endpoint) => {
    const env = { MODEL_NAME: "text-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "anthropic-messages", MODEL_KEY: "" };
    await assert.rejects(
      () => callFor(env)({ body: { contents: [{ parts: [{ text: "draft" }] }] } }, { seconds: 0.3 }),
      /within 0\.3 seconds/,
    );
  });
});
