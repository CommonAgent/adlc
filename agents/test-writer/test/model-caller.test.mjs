// The shared model caller: reaching the model over anthropic-messages.
//   node --test test/model-caller.test.mjs
//
// What is pinned: the model is reached through scripts/model-caller.mjs via
// POST /v1/messages with anthropic-version and the model in the body; x-api-key
// is sent only when MODEL_KEY is non-empty; missing or invalid settings stop
// the run before any request is sent and name the offending variable; settings
// are read on every run rather than cached; an answer cut at max_tokens is a
// failure; no script carries Google/Vertex/Gemini variables, metadata server
// references, or raw network address literals; declarations in agent-runtime-requirements.json
// and plugin.json match the anthropic-messages protocol and shared caller;
// write-suite uses the caller; and model instructions require testing against
// a local stand-in server.
// Nothing here touches a real network: all model requests reach a stand-in
// server on 127.0.0.1 started inside the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { callModel, readSettings } from "../scripts/model-caller.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(here, "..", "scripts");

function startStandIn(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        endpoint: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

test("the model is reached at /v1/messages with post, the model in the body, and anthropic-version header", async () => {
  let received = null;
  const standIn = await startStandIn((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: JSON.parse(body),
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "good response" }],
        stop_reason: "end_turn",
      }));
    });
  });
  try {
    const env = {
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_NAME: "claude-test",
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "secret-key",
    };
    const res = await callModel({ messages: [{ role: "user", content: "hello" }] }, env);
    assert.equal(received.method, "POST");
    assert.equal(received.url, "/v1/messages");
    assert.equal(received.headers["anthropic-version"], "2023-06-01");
    assert.equal(received.headers["x-api-key"], "secret-key");
    assert.equal(received.body.model, "claude-test");
    assert.equal(res.text, "good response");
  } finally {
    await standIn.close();
  }
});

test("the api key is passed in x-api-key only when model_key is set and non-empty", async () => {
  let headers = null;
  const standIn = await startStandIn((req, res) => {
    headers = req.headers;
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
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_NAME: "claude-test",
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "",
    };
    await callModel({ messages: [{ role: "user", content: "hello" }] }, env);
    assert.equal("x-api-key" in headers, false, "x-api-key should not be present when MODEL_KEY is empty");
  } finally {
    await standIn.close();
  }
});

test("an unset or empty model_name, model_endpoint, or model_protocol stops before any request is sent", async () => {
  let requests = 0;
  const standIn = await startStandIn((req, res) => {
    requests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "no" }], stop_reason: "end_turn" }));
  });
  try {
    const good = {
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_NAME: "test-model",
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "",
    };
    for (const [setting, badVal] of [
      ["MODEL_NAME", ""],
      ["MODEL_NAME", undefined],
      ["MODEL_ENDPOINT", ""],
      ["MODEL_ENDPOINT", undefined],
      ["MODEL_PROTOCOL", ""],
      ["MODEL_PROTOCOL", undefined],
    ]) {
      const env = { ...good, [setting]: badVal };
      await assert.rejects(
        callModel({ messages: [{ role: "user", content: "hi" }] }, env),
        new RegExp(setting)
      );
      assert.throws(() => readSettings(env), new RegExp(setting));
      assert.equal(requests, 0, `no request should be sent when ${setting} is missing`);
    }
  } finally {
    await standIn.close();
  }
});

test("a model_protocol other than anthropic-messages stops before anything is sent and names the setting", async () => {
  let requests = 0;
  const standIn = await startStandIn((req, res) => {
    requests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "no" }], stop_reason: "end_turn" }));
  });
  try {
    const env = {
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_NAME: "test-model",
      MODEL_PROTOCOL: "openai-chat",
      MODEL_KEY: "",
    };
    await assert.rejects(
      callModel({ messages: [{ role: "user", content: "hi" }] }, env),
      /MODEL_PROTOCOL/
    );
    assert.throws(() => readSettings(env), /MODEL_PROTOCOL/);
    assert.equal(requests, 0, "no request should be sent when MODEL_PROTOCOL is unsupported");
  } finally {
    await standIn.close();
  }
});

test("settings are read on every run so changing model_endpoint reaches a different stand-in", async () => {
  let hits1 = 0;
  let hits2 = 0;
  const standIn1 = await startStandIn((req, res) => {
    hits1 += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "one" }], stop_reason: "end_turn" }));
  });
  const standIn2 = await startStandIn((req, res) => {
    hits2 += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "two" }], stop_reason: "end_turn" }));
  });
  try {
    const env1 = {
      MODEL_ENDPOINT: standIn1.endpoint,
      MODEL_NAME: "test-model",
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "k",
    };
    const env2 = {
      ...env1,
      MODEL_ENDPOINT: standIn2.endpoint,
    };
    const res1 = await callModel({ messages: [{ role: "user", content: "hi" }] }, env1);
    const res2 = await callModel({ messages: [{ role: "user", content: "hi" }] }, env2);
    assert.equal(hits1, 1);
    assert.equal(hits2, 1);
    assert.equal(res1.text, "one");
    assert.equal(res2.text, "two");
  } finally {
    await standIn1.close();
    await standIn2.close();
  }
});

test("an answer cut at max_tokens is treated as a failure and never accepted as whole", async () => {
  const standIn = await startStandIn((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_cut",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "partially finished answer" }],
      stop_reason: "max_tokens",
    }));
  });
  try {
    const env = {
      MODEL_ENDPOINT: standIn.endpoint,
      MODEL_NAME: "test-model",
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "",
    };
    await assert.rejects(
      callModel({ messages: [{ role: "user", content: "hi" }] }, env),
      /max_tokens|cut at/i
    );
  } finally {
    await standIn.close();
  }
});

test("the caller exits 2 when required environment variables are missing", () => {
  const scriptPath = join(scriptsDir, "model-caller.mjs");
  const r = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, MODEL_NAME: "", MODEL_ENDPOINT: "", MODEL_PROTOCOL: "" },
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr + r.stdout, /MODEL_NAME|MODEL_ENDPOINT|MODEL_PROTOCOL/);
});

test("no script reads google, vertex, or agent_model variables or names the metadata server", () => {
  const scripts = readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"));
  for (const file of scripts) {
    const text = readFileSync(join(scriptsDir, file), "utf8");
    assert.doesNotMatch(text, /AGENT_MODEL/, `${file} reads AGENT_MODEL`);
    assert.doesNotMatch(text, /VERTEX_WHERE/, `${file} reads VERTEX_WHERE`);
    assert.doesNotMatch(text, /GOOGLE_/, `${file} reads a GOOGLE_ variable`);
    assert.doesNotMatch(text, /metadata\.google\.internal/, `${file} names the metadata server`);
    assert.doesNotMatch(text, /169\.254\./, `${file} names the metadata server IP`);
  }
});

test("no script carries a network address literal outside excepted identifier prefixes", () => {
  const scripts = readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"));
  const urlPattern = /(?:https?|wss?):\/\/[a-zA-Z0-9\[]|169\.254\.\d+\.\d+/;
  const excepted = [
    "http://json-schema.org/",
    "https://json-schema.org/",
    "http://www.w3.org/",
    "https://www.w3.org/",
    "http://schema.org/",
    "https://schema.org/",
    "http://xmlns.com/",
  ];
  for (const file of scripts) {
    const text = readFileSync(join(scriptsDir, file), "utf8");
    const matches = text.match(/(?:https?|wss?):\/\/[^\s"'`<>)]+/g) || [];
    for (const url of matches) {
      const isExcepted = excepted.some((prefix) => url.startsWith(prefix));
      assert.ok(isExcepted, `${file} carries unexcepted network address literal: ${url}`);
    }
    assert.doesNotMatch(text, /169\.254\.\d+\.\d+/, `${file} carries a link-local address`);
  }
});

test("the runtime requirements and plugin manifest declare text-reasoning under anthropic-messages with the shared caller", () => {
  const req = JSON.parse(readFileSync(join(here, "..", "agent-runtime-requirements.json"), "utf8"));
  const sys = req.systems?.find((s) => s.name === "text-reasoning" || s.role === "text-reasoning");
  assert.ok(sys, "text-reasoning system declared");
  assert.equal(sys.name, "text-reasoning");
  assert.equal(sys.kind, "model");
  assert.deepEqual(sys.protocols, ["anthropic-messages"]);
  assert.equal(sys.credential, undefined);
  assert.equal(sys.env, undefined);
  assert.equal(sys.settings, undefined);

  const plugin = JSON.parse(readFileSync(join(here, "..", "plugin.json"), "utf8"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  for (const slug of ["write-a-suite", "write-the-suite"]) {
    const s = skills[slug];
    if (s) {
      assert.ok(s.scripts.includes("scripts/model-caller.mjs"), `${slug} does not list scripts/model-caller.mjs`);
      for (const sc of s.scripts) {
        assert.doesNotMatch(sc, /gemini|vertex|google/i, `${slug} still lists retired caller ${sc}`);
      }
    }
  }
});

test("write-suite delegates to the shared caller without vertex tokens or gemini endpoints", () => {
  const text = readFileSync(join(scriptsDir, "write-suite.mjs"), "utf8");
  assert.match(text, /model-caller\.mjs/, "write-suite.mjs must reach model through model-caller.mjs");
  assert.doesNotMatch(text, /googleapis\.com/);
  assert.doesNotMatch(text, /generativelanguage/);
  assert.doesNotMatch(text, /metadata\.google/);
  assert.doesNotMatch(text, /VERTEX/);
});

test("instructions to the model specify that model calls are tested against a local stand-in server", async () => {
  const { INSTRUCTION } = await import("../scripts/write-suite.mjs");
  assert.match(INSTRUCTION, /stand-in model server/i);
  assert.match(INSTRUCTION, /MODEL_ENDPOINT/);
  assert.match(INSTRUCTION, /never a real model service|never reach.*real/i);
});
