// The shared model caller connects to the service in the format MODEL_PROTOCOL names.
//   node --test test/model-caller.test.mjs
//
// What is worth pinning: requests use POST /v1/messages with the anthropic-version
// header, the model in the body, and the key in x-api-key only when MODEL_KEY is
// non-empty; the package declares anthropic-messages, openai-chat and gemini, and
// each is sent in its own format; missing or empty MODEL_NAME, MODEL_ENDPOINT, or
// MODEL_PROTOCOL, a protocol outside the caller's list, one outside a narrower
// declared list, or declared protocols that cannot be read, stops before sending
// anything; the settings are read on every run (callModel's `env` option) so
// different endpoints reach different stand-ins in the same process; an answer cut
// at max_tokens is a failure (cutAtLimit) that is never treated as whole;
// modelSettings returns the plain settings and cannotCall names the missing one;
// review.mjs reads the shared caller and reports which setting was missing when
// going without the model; and running the caller directly without PROMPT_FILE
// exits 2, while missing model settings exit 1 naming the setting.
//
// Nothing here touches a public network or real model service: all calls target a
// local stand-in server on 127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, cannotCall, modelSettings } from "../scripts/model-caller.mjs";
import { PROTOCOLS_UNREAD, declaredProtocols, review } from "../scripts/review.mjs";
import { badPackage, readOf } from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
// The formats the package's model system declares, as a job passes them to the caller.
const DECLARED = JSON.parse(readFileSync(join(ROOT, "agent-runtime-requirements.json"), "utf8"))
  .systems.find((s) => s.kind === "model").protocols;

function startStandIn({ reply, status = 200 } = {}) {
  const defaultReply = {
    id: "msg_standin_1",
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [{ type: "text", text: "<<<NONE>>>" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 10 },
  };
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch {}
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsed,
      });
      res.writeHead(status, { "content-type": "application/json" });
      const payload = reply !== undefined
        ? (typeof reply === "function" ? reply(req, parsed) : reply)
        : defaultReply;
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const endpoint = `http://127.0.0.1:${port}`;
      resolve({
        endpoint,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("the stand-in receives POST /v1/messages with model in body, anthropic-version header, and x-api-key when key is provided", async () => {
  const standIn = await startStandIn();
  try {
    const env = {
      MODEL_NAME: "claude-3-7-sonnet",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "secret-key-123",
    };
    const res = await callModel("hello world", { env: env });
    assert.equal(standIn.requests.length, 1);
    const req = standIn.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/messages");
    assert.equal(req.body.model, "claude-3-7-sonnet");
    assert.ok(req.headers["anthropic-version"], "anthropic-version header is present");
    assert.equal(req.headers["x-api-key"], "secret-key-123");
    assert.equal(res.text, "<<<NONE>>>");
  } finally {
    await standIn.close();
  }
});

test("the x-api-key header is absent when MODEL_KEY is empty or omitted", async () => {
  const standIn = await startStandIn();
  try {
    const env = {
      MODEL_NAME: "claude-3-7-sonnet",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "",
    };
    await callModel("hello", { env: env });
    assert.equal(standIn.requests.length, 1);
    assert.equal(standIn.requests[0].headers["x-api-key"], undefined);

    const envWithoutKey = {
      MODEL_NAME: "claude-3-7-sonnet",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    };
    await callModel("hello again", { env: envWithoutKey });
    assert.equal(standIn.requests.length, 2);
    assert.equal(standIn.requests[1].headers["x-api-key"], undefined);
  } finally {
    await standIn.close();
  }
});

test("a run with MODEL_NAME unset or empty stops before sending and its words name MODEL_NAME", async () => {
  const standIn = await startStandIn();
  try {
    const envUnset = {
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    };
    await assert.rejects(async () => callModel("test", { env: envUnset }), /MODEL_NAME/);
    assert.equal(standIn.requests.length, 0, "stand-in saw no request");

    const envEmpty = {
      MODEL_NAME: "",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    };
    await assert.rejects(async () => callModel("test", { env: envEmpty }), /MODEL_NAME/);
    assert.equal(standIn.requests.length, 0);
  } finally {
    await standIn.close();
  }
});

test("a run with MODEL_ENDPOINT unset or empty stops before sending and its words name MODEL_ENDPOINT", async () => {
  const envUnset = {
    MODEL_NAME: "test-model",
    MODEL_PROTOCOL: "anthropic-messages",
  };
  await assert.rejects(async () => callModel("test", { env: envUnset }), /MODEL_ENDPOINT/);

  const envEmpty = {
    MODEL_NAME: "test-model",
    MODEL_ENDPOINT: "",
    MODEL_PROTOCOL: "anthropic-messages",
  };
  await assert.rejects(async () => callModel("test", { env: envEmpty }), /MODEL_ENDPOINT/);
});

test("a run with MODEL_PROTOCOL unset or empty stops before sending and its words name MODEL_PROTOCOL", async () => {
  const standIn = await startStandIn();
  try {
    const envUnset = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.endpoint,
    };
    await assert.rejects(async () => callModel("test", { env: envUnset }), /MODEL_PROTOCOL/);
    assert.equal(standIn.requests.length, 0);

    const envEmpty = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "",
    };
    await assert.rejects(async () => callModel("test", { env: envEmpty }), /MODEL_PROTOCOL/);
    assert.equal(standIn.requests.length, 0);
  } finally {
    await standIn.close();
  }
});

// Each format's own answer, as a stand-in for that format gives it.
function answerFor(url, text = "<<<NONE>>>") {
  if (url.startsWith("/v1/messages")) {
    return { id: "msg_standin", type: "message", role: "assistant", model: "test-model", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
  }
  if (url.startsWith("/chat/completions")) {
    return { id: "chat_standin", model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } };
  }
  return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }, modelVersion: "test-model" };
}

test("the package's model system declares exactly anthropic-messages, openai-chat and gemini, and the review sends each in its own format", async () => {
  assert.deepEqual(DECLARED, ["anthropic-messages", "openai-chat", "gemini"]);
  const standIn = await startStandIn({ reply: (req) => answerFor(req.url) });
  try {
    const expected = {
      "anthropic-messages": "/v1/messages",
      "openai-chat": "/chat/completions",
      gemini: "/models/test-model:generateContent",
    };
    const { read, texts } = readOf(badPackage());
    for (const [protocol, path] of Object.entries(expected)) {
      const before = standIn.requests.length;
      const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.endpoint, MODEL_PROTOCOL: protocol, MODEL_KEY: "k-1234" };
      // review.mjs reads the declared protocols itself.
      const out = await review({ read, texts, sent: [] }, { env });
      assert.equal(out.error, null, `${protocol}: ${out.error}`);
      assert.equal(out.none, true, protocol);
      assert.equal(standIn.requests.length, before + 1, `${protocol} sent one request`);
      const req = standIn.requests[before];
      assert.equal(req.method, "POST", protocol);
      assert.equal(req.url, path, protocol);
    }
    const [anthropic, openai, gemini] = standIn.requests;
    assert.equal(anthropic.body.model, "test-model");
    assert.ok(anthropic.headers["anthropic-version"]);
    assert.equal(anthropic.headers["x-api-key"], "k-1234");
    assert.equal(openai.body.model, "test-model");
    assert.ok(Array.isArray(openai.body.messages));
    assert.equal(openai.headers.authorization, "Bearer k-1234");
    assert.ok(Array.isArray(gemini.body.contents));
    assert.equal(gemini.headers["x-goog-api-key"], "k-1234");
  } finally {
    await standIn.close();
  }
});

test("a MODEL_PROTOCOL outside the caller's list stops before sending and its words name MODEL_PROTOCOL", async () => {
  const standIn = await startStandIn();
  try {
    const envWrong = { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.endpoint, MODEL_PROTOCOL: "bedrock" };
    await assert.rejects(async () => callModel("test", { env: envWrong }), /MODEL_PROTOCOL/);
    await assert.rejects(async () => callModel("test", { env: envWrong, protocols: DECLARED }), /MODEL_PROTOCOL/);
    assert.equal(standIn.requests.length, 0);

    const { read, texts } = readOf(badPackage());
    const out = await review({ read, texts, sent: [] }, { env: envWrong });
    assert.match(out.error, /MODEL_PROTOCOL/);
    assert.deepEqual(out.calls, []);
    assert.equal(standIn.requests.length, 0, "the review sent nothing to the stand-in");
  } finally {
    await standIn.close();
  }
});

test("a declared protocols list is enforced: with a narrower list passed, a protocol outside it stops before sending and names MODEL_PROTOCOL", async () => {
  const standIn = await startStandIn();
  try {
    const narrower = ["anthropic-messages"];
    const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.endpoint, MODEL_PROTOCOL: "openai-chat" };
    await assert.rejects(async () => callModel("test", { env, protocols: narrower }), /MODEL_PROTOCOL/);
    assert.equal(standIn.requests.length, 0);

    const { read, texts } = readOf(badPackage());
    const out = await review({ read, texts, sent: [] }, { env, protocols: narrower });
    assert.match(out.error, /MODEL_PROTOCOL/);
    assert.deepEqual(out.calls, []);
    assert.equal(standIn.requests.length, 0, "the review sent nothing to the stand-in");
  } finally {
    await standIn.close();
  }
});

test("when the declared protocols cannot be read, the review sends nothing and its words are PROTOCOLS_UNREAD", async () => {
  const standIn = await startStandIn();
  const missing = mkdtempSync(join(tmpdir(), "code-critic-noreqs-"));
  const empty = mkdtempSync(join(tmpdir(), "code-critic-noprotocols-"));
  try {
    writeFileSync(join(empty, "agent-runtime-requirements.json"), JSON.stringify({ systems: [{ name: "text-reasoning", kind: "model" }] }));
    const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.endpoint, MODEL_PROTOCOL: "anthropic-messages" };
    const { read, texts } = readOf(badPackage());
    for (const dir of [missing, empty]) {
      const out = await review({ read, texts, sent: [] }, { env, protocols: declaredProtocols([dir]) });
      assert.equal(out.error, PROTOCOLS_UNREAD, dir);
      assert.deepEqual(out.calls, []);
    }
    assert.equal(standIn.requests.length, 0, "nothing reached the stand-in");
  } finally {
    await standIn.close();
    rmSync(missing, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test("the settings are read on every run so different endpoints reach different stand-ins", async () => {
  const standIn1 = await startStandIn();
  const standIn2 = await startStandIn();
  try {
    const base = {
      MODEL_NAME: "test-model",
      MODEL_PROTOCOL: "anthropic-messages",
    };
    await callModel("ping 1", { env: { ...base, MODEL_ENDPOINT: standIn1.endpoint } });
    assert.equal(standIn1.requests.length, 1);
    assert.equal(standIn2.requests.length, 0);

    await callModel("ping 2", { env: { ...base, MODEL_ENDPOINT: standIn2.endpoint } });
    assert.equal(standIn1.requests.length, 1);
    assert.equal(standIn2.requests.length, 1);
  } finally {
    await standIn1.close();
    await standIn2.close();
  }
});

test("an answer cut at the token limit with stop_reason max_tokens is rejected and never treated as whole", async () => {
  const standIn = await startStandIn({
    reply: {
      id: "msg_cut",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text: "<<<FINDING>>>\nplace: scripts/make.mjs:1\nrule: test\nclaim: partial" }],
      stop_reason: "max_tokens",
    },
  });
  try {
    const env = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    };
    await assert.rejects(async () => callModel("test", { env: env }), (err) => {
      assert.equal(err.cutAtLimit, true, "the failure says the answer was cut");
      assert.match(err.message, /cut at its limit/);
      assert.match(err.message, /not read/);
      return true;
    });
    assert.equal(standIn.requests.length, 1);
  } finally {
    await standIn.close();
  }
});

test("review.mjs reads modelSettings and goes without the model naming the missing setting", async () => {
  const { read, texts } = readOf(badPackage());
  const outMissingEndpoint = await review(
    { read, texts, sent: [] },
    { env: { MODEL_NAME: "test-model", MODEL_PROTOCOL: "anthropic-messages" } },
  );
  assert.match(outMissingEndpoint.error, /MODEL_ENDPOINT/);
  assert.deepEqual(outMissingEndpoint.calls, []);

  const outMissingName = await review(
    { read, texts, sent: [] },
    { env: { MODEL_ENDPOINT: "http://127.0.0.1:9999", MODEL_PROTOCOL: "anthropic-messages" } },
  );
  assert.match(outMissingName.error, /MODEL_NAME/);
  assert.deepEqual(outMissingName.calls, []);
});

test("modelSettings returns plain settings when valid and cannotCall names the missing variable", () => {
  const settings = {
    MODEL_NAME: "claude-sonnet",
    MODEL_ENDPOINT: "http://127.0.0.1:8000",
    MODEL_PROTOCOL: "anthropic-messages",
    MODEL_KEY: "my-key",
  };
  const valid = modelSettings(settings);
  assert.equal(valid.name, "claude-sonnet");
  assert.equal(valid.endpoint, "http://127.0.0.1:8000");
  assert.equal(valid.protocol, "anthropic-messages");
  assert.equal(valid.key, "my-key");
  assert.equal(cannotCall(settings, { protocols: DECLARED }), "");

  assert.doesNotThrow(() => modelSettings({}), "modelSettings only reads; it never refuses");
  assert.equal(modelSettings({}).name, "");
  assert.match(cannotCall({}), /^MODEL_NAME/);
  assert.match(cannotCall({ MODEL_NAME: "x" }), /^MODEL_ENDPOINT/);
  assert.match(cannotCall({ MODEL_NAME: "x", MODEL_ENDPOINT: "http://127.0.0.1:8000" }), /^MODEL_PROTOCOL/);
});

test("the model caller process exits 2 without PROMPT_FILE, and 1 naming the setting when one is missing", () => {
  const caller = join(ROOT, "scripts", "model-caller.mjs");
  const bare = spawnSync(process.execPath, [caller], { env: {}, encoding: "utf8" });
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /PROMPT_FILE is required/);

  const dir = mkdtempSync(join(tmpdir(), "code-critic-caller-"));
  try {
    const prompt = join(dir, "prompt.txt");
    writeFileSync(prompt, "hello");
    const res = spawnSync(process.execPath, [caller], { env: { PROMPT_FILE: prompt }, encoding: "utf8" });
    assert.equal(res.status, 1);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /MODEL_NAME/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
