// The shared model caller: reaching the model over anthropic-messages protocol.
//
// What is worth pinning: the model is reached through POST /v1/messages with
// anthropic-version, model name in JSON body, and x-api-key only when MODEL_KEY
// is not empty; missing or invalid MODEL_NAME, MODEL_ENDPOINT, or MODEL_PROTOCOL
// stops before sending any request; settings are read on every run so endpoints
// can change within one process; answers cut at max_tokens fail immediately;
// process contract exits 2 when required configuration is missing.
// Nothing here touches a real service: all calls go to an in-test HTTP server
// listening on 127.0.0.1.
// Run: node --test test/model-caller.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel } from "../scripts/model-caller.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "..", "scripts", "model-caller.mjs");

function startStandIn(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        endpoint: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test("the model caller sends a post to /v1/messages with model in body and anthropic-version header", async () => {
  let received = null;
  const standIn = await startStandIn(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: '{"verdict":"holds"}' }],
      stop_reason: "end_turn",
    }));
  });

  try {
    const env = {
      MODEL_NAME: "claude-test-v1",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "secret-key-123",
    };
    const out = await callModel({
      prompt: "Judge this reason.",
      env,
    });

    assert.equal(received.method, "POST");
    assert.equal(received.url, "/v1/messages");
    assert.ok(received.headers["anthropic-version"], "anthropic-version header is present");
    assert.equal(received.headers["x-api-key"], "secret-key-123");
    assert.equal(received.body.model, "claude-test-v1");
    assert.ok(out);
  } finally {
    await standIn.close();
  }
});

test("the x-api-key header is omitted when model_key is empty or unset", async () => {
  let receivedHeaders = null;
  const standIn = await startStandIn(async (req, res) => {
    receivedHeaders = req.headers;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_2",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    }));
  });

  try {
    const env = {
      MODEL_NAME: "claude-test-v1",
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "",
    };
    await callModel({ prompt: "hello", env });
    assert.equal(receivedHeaders["x-api-key"], undefined, "x-api-key header must not be set when empty");
  } finally {
    await standIn.close();
  }
});

test("a run with model_name unset or empty stops before sending and names the setting", async () => {
  let calls = 0;
  const standIn = await startStandIn((req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end();
  });

  try {
    for (const val of [undefined, ""]) {
      await assert.rejects(
        () => callModel({
          prompt: "test",
          env: {
            MODEL_NAME: val,
            MODEL_ENDPOINT: standIn.endpoint,
            MODEL_PROTOCOL: "anthropic-messages",
          },
        }),
        /MODEL_NAME/,
      );
    }
    assert.equal(calls, 0, "no request was sent to the stand-in");
  } finally {
    await standIn.close();
  }
});

test("a run with model_endpoint unset or empty stops before sending and names the setting", async () => {
  for (const val of [undefined, ""]) {
    await assert.rejects(
      () => callModel({
        prompt: "test",
        env: {
          MODEL_NAME: "test-model",
          MODEL_ENDPOINT: val,
          MODEL_PROTOCOL: "anthropic-messages",
        },
      }),
      /MODEL_ENDPOINT/,
    );
  }
});

test("a run with model_protocol unset, empty, or other than anthropic-messages stops before sending and names the setting", async () => {
  let calls = 0;
  const standIn = await startStandIn((req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end();
  });

  try {
    for (const val of [undefined, "", "openai-chat", "vertex-ai"]) {
      await assert.rejects(
        () => callModel({
          prompt: "test",
          env: {
            MODEL_NAME: "test-model",
            MODEL_ENDPOINT: standIn.endpoint,
            MODEL_PROTOCOL: val,
          },
        }),
        /MODEL_PROTOCOL/,
      );
    }
    assert.equal(calls, 0, "stand-in received no requests");
  } finally {
    await standIn.close();
  }
});

test("settings are read on every run so two runs in one process reach two different stand-ins", async () => {
  let server1Calls = 0;
  let server2Calls = 0;

  const standIn1 = await startStandIn((req, res) => {
    server1Calls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "one" }], stop_reason: "end_turn" }));
  });
  const standIn2 = await startStandIn((req, res) => {
    server2Calls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "two" }], stop_reason: "end_turn" }));
  });

  try {
    const env1 = {
      MODEL_NAME: "m",
      MODEL_ENDPOINT: standIn1.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    };
    const env2 = {
      MODEL_NAME: "m",
      MODEL_ENDPOINT: standIn2.endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    };

    await callModel({ prompt: "first", env: env1 });
    assert.equal(server1Calls, 1);
    assert.equal(server2Calls, 0);

    await callModel({ prompt: "second", env: env2 });
    assert.equal(server1Calls, 1);
    assert.equal(server2Calls, 1);
  } finally {
    await standIn1.close();
    await standIn2.close();
  }
});

test("an answer the stand-in cuts at max_tokens is a failure that says so", async () => {
  const standIn = await startStandIn((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_cut",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: '{"partial": true' }],
      stop_reason: "max_tokens",
    }));
  });

  try {
    await assert.rejects(
      () => callModel({
        prompt: "test",
        env: {
          MODEL_NAME: "m",
          MODEL_ENDPOINT: standIn.endpoint,
          MODEL_PROTOCOL: "anthropic-messages",
        },
      }),
      /max_tokens/,
    );
  } finally {
    await standIn.close();
  }
});

test("the process contract exits 2 when a required setting is missing", () => {
  const res = spawnSync("node", [scriptPath], {
    env: { ...process.env, MODEL_NAME: "", MODEL_ENDPOINT: "", MODEL_PROTOCOL: "" },
    encoding: "utf8",
  });
  assert.equal(res.status, 2);
  assert.match(`${res.stdout}\n${res.stderr}`, /MODEL_/);
});
