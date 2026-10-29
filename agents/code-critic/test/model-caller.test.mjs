// The shared model caller connects to an anthropic-messages service.
//   node --test test/model-caller.test.mjs
//
// What is worth pinning: requests use POST /v1/messages with the anthropic-version
// header, the model in the body, and the key in x-api-key only when MODEL_KEY is
// non-empty; missing or empty MODEL_NAME, MODEL_ENDPOINT, or MODEL_PROTOCOL, or a
// protocol other than anthropic-messages stops before sending anything; the settings
// are read on every run so different endpoints reach different stand-ins in the same
// process; an answer cut at max_tokens is a failure that is never treated as whole;
// review.mjs reads modelSettings from the shared caller and reports which setting was
// missing when going without the model; and running the caller directly with missing
// settings exits 2.
//
// Nothing here touches a public network or real model service: all calls target a
// local stand-in server on 127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, modelSettings } from "../scripts/model-caller.mjs";
import { review } from "../scripts/review.mjs";
import { badPackage, readOf } from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

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
    const res = await callModel("hello world", env);
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
    await callModel("hello", env);
    assert.equal(standIn.requests.length, 1);
    assert.equal(standIn.requests[0].headers["x-api-key"], undefined);

    const envWithoutKey = {
      MODEL_NAME: "claude-3-7-sonnet",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    };
    await callModel("hello again", envWithoutKey);
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
    await assert.rejects(async () => callModel("test", envUnset), /MODEL_NAME/);
    assert.equal(standIn.requests.length, 0, "stand-in saw no request");

    const envEmpty = {
      MODEL_NAME: "",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    };
    await assert.rejects(async () => callModel("test", envEmpty), /MODEL_NAME/);
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
  await assert.rejects(async () => callModel("test", envUnset), /MODEL_ENDPOINT/);

  const envEmpty = {
    MODEL_NAME: "test-model",
    MODEL_ENDPOINT: "",
    MODEL_PROTOCOL: "anthropic-messages",
  };
  await assert.rejects(async () => callModel("test", envEmpty), /MODEL_ENDPOINT/);
});

test("a run with MODEL_PROTOCOL unset or empty stops before sending and its words name MODEL_PROTOCOL", async () => {
  const standIn = await startStandIn();
  try {
    const envUnset = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.endpoint,
    };
    await assert.rejects(async () => callModel("test", envUnset), /MODEL_PROTOCOL/);
    assert.equal(standIn.requests.length, 0);

    const envEmpty = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "",
    };
    await assert.rejects(async () => callModel("test", envEmpty), /MODEL_PROTOCOL/);
    assert.equal(standIn.requests.length, 0);
  } finally {
    await standIn.close();
  }
});

test("a run with MODEL_PROTOCOL other than anthropic-messages stops before sending and its words name MODEL_PROTOCOL", async () => {
  const standIn = await startStandIn();
  try {
    const envWrong = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "openai-chat",
    };
    await assert.rejects(async () => callModel("test", envWrong), /MODEL_PROTOCOL/);
    assert.equal(standIn.requests.length, 0);
  } finally {
    await standIn.close();
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
    await callModel("ping 1", { ...base, MODEL_ENDPOINT: standIn1.endpoint });
    assert.equal(standIn1.requests.length, 1);
    assert.equal(standIn2.requests.length, 0);

    await callModel("ping 2", { ...base, MODEL_ENDPOINT: standIn2.endpoint });
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
    await assert.rejects(async () => callModel("test", env), /max_tokens/i);
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

test("modelSettings returns plain settings when valid and throws naming the missing variable", () => {
  const valid = modelSettings({
    MODEL_NAME: "claude-sonnet",
    MODEL_ENDPOINT: "http://127.0.0.1:8000",
    MODEL_PROTOCOL: "anthropic-messages",
    MODEL_KEY: "my-key",
  });
  assert.equal(valid.name, "claude-sonnet");
  assert.equal(valid.endpoint, "http://127.0.0.1:8000");
  assert.equal(valid.protocol, "anthropic-messages");
  assert.equal(valid.key, "my-key");

  assert.throws(() => modelSettings({}), /MODEL_NAME/);
  assert.throws(() => modelSettings({ MODEL_NAME: "x" }), /MODEL_ENDPOINT/);
  assert.throws(() => modelSettings({ MODEL_NAME: "x", MODEL_ENDPOINT: "http://127.0.0.1:8000" }), /MODEL_PROTOCOL/);
});

test("the model caller process exits 2 when required environment settings are missing", () => {
  const res = spawnSync("node", [join(ROOT, "scripts", "model-caller.mjs")], {
    env: {},
    encoding: "utf8",
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /MODEL_/);
});
