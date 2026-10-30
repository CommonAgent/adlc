// The shared model caller: reaching the model over anthropic-messages.
//   node --test test/model-caller.test.mjs
//
// What is pinned: the model is reached through scripts/model-caller.mjs via
// POST /v1/messages with anthropic-version and the model in the body; x-api-key
// is sent only when MODEL_KEY is non-empty; missing or invalid settings stop
// the run before any request is sent and name the offending variable; a
// protocol outside the package's declared anthropic-messages is refused when
// the declared protocols are passed; settings are read on every run rather
// than cached; an answer cut at max_tokens is a failure (cutAtLimit); the
// caller's own command line exits 2 only without PROMPT_FILE, and with a
// setting missing names it and sends nothing; no script carries
// Google/Vertex/Gemini variables, metadata server
// references, or raw network address literals; declarations in agent-runtime-requirements.json
// and plugin.json match the anthropic-messages protocol and shared caller;
// write-suite uses the caller; and model instructions require testing against
// a local stand-in server.
// The caller is called as it really is: callModel(prompt, { env, ... }), and
// cannotCall(env, { protocols }) for the refusal before anything is sent.
// Nothing here touches a real network: all model requests reach a stand-in
// server on 127.0.0.1 started inside the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { callModel, cannotCall } from "../scripts/model-caller.mjs";
import { declaredProtocols } from "../scripts/write-suite.mjs";

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
    const res = await callModel("hello", { env });
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
    await callModel("hello", { env });
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
        callModel("hi", { env }),
        new RegExp(setting)
      );
      assert.match(cannotCall(env), new RegExp(setting));
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
    // The package declares anthropic-messages for text-reasoning, and the job
    // passes those protocols to the caller; the caller refuses any other.
    const protocols = declaredProtocols();
    assert.deepEqual(protocols, ["anthropic-messages"]);
    await assert.rejects(
      callModel("hi", { env, protocols }),
      /MODEL_PROTOCOL/
    );
    assert.match(cannotCall(env, { protocols }), /MODEL_PROTOCOL/);
    // A protocol the caller does not speak at all is refused even with none passed.
    const unknown = { ...env, MODEL_PROTOCOL: "smoke-signals" };
    await assert.rejects(callModel("hi", { env: unknown }), /MODEL_PROTOCOL/);
    assert.match(cannotCall(unknown), /MODEL_PROTOCOL/);
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
    const res1 = await callModel("hi", { env: env1 });
    const res2 = await callModel("hi", { env: env2 });
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
      callModel("hi", { env }),
      (err) => {
        assert.match(err.message, /max_tokens|cut at/i);
        assert.equal(err.cutAtLimit, true, "a cut answer says so in cutAtLimit");
        return true;
      }
    );
  } finally {
    await standIn.close();
  }
});

test("the caller exits 2 without PROMPT_FILE, and with the settings missing names them and sends nothing", () => {
  const scriptPath = join(scriptsDir, "model-caller.mjs");
  const blank = { ...process.env, MODEL_NAME: "", TEXT_MODEL: "", MODEL_ENDPOINT: "", MODEL_PROTOCOL: "" };
  delete blank.PROMPT_FILE;
  const r = spawnSync(process.execPath, [scriptPath], { env: blank, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr + r.stdout, /PROMPT_FILE is required/);
  const at = mkdtempSync(join(tmpdir(), "test-writer-caller-"));
  try {
    const prompt = join(at, "prompt.txt");
    writeFileSync(prompt, "hello");
    const s = spawnSync(process.execPath, [scriptPath], { env: { ...blank, PROMPT_FILE: prompt }, encoding: "utf8" });
    assert.equal(s.status, 1, "a missing setting is an error, not a call made wrong");
    const out = JSON.parse(s.stdout.trim());
    assert.equal(out.ok, false);
    assert.match(out.error, /MODEL_NAME|MODEL_ENDPOINT|MODEL_PROTOCOL/);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
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
