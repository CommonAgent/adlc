// The shared model caller: reaching the model in the format MODEL_PROTOCOL names.
//   node --test test/model-caller.test.mjs
//
// What is pinned: the model is reached through scripts/model-caller.mjs via
// POST /v1/messages with anthropic-version and the model in the body; x-api-key
// is sent only when MODEL_KEY is non-empty; missing or invalid settings stop
// the run before any request is sent and name the offending variable; the
// package declares anthropic-messages, openai-chat and gemini and each is sent
// in its own format; a protocol outside the caller's list, or outside a
// narrower list passed, is refused, and declared protocols that cannot be read
// stop the job before it sends (PROTOCOLS_UNREAD); settings are read on every run rather
// than cached; an answer cut at max_tokens is a failure (cutAtLimit); the
// caller's own command line exits 2 only without PROMPT_FILE, and with a
// setting missing names it and sends nothing; no script carries
// Google/Vertex/Gemini variables, metadata server
// references, or raw network address literals; declarations in agent-runtime-requirements.json
// and plugin.json name the three protocols and the shared caller;
// write-suite uses the caller; and model instructions require testing against
// a local stand-in server.
// The caller is called as it really is: callModel(prompt, { env, ... }), and
// cannotCall(env, { protocols }) for the refusal before anything is sent.
// Nothing here touches a real network: all model requests reach a stand-in
// server on 127.0.0.1 started inside the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { callModel, cannotCall } from "../scripts/model-caller.mjs";
import { PROTOCOLS_UNREAD, callFor, declaredProtocols, whyNoCall } from "../scripts/write-suite.mjs";

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

// Each format's own answer, as a stand-in for that format gives it.
function answerFor(url, text) {
  if (url.startsWith("/v1/messages")) return { id: "msg_1", type: "message", role: "assistant", model: "test-model", content: [{ type: "text", text }], stop_reason: "end_turn" };
  if (url.startsWith("/chat/completions")) return { id: "c_1", model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] };
  return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], modelVersion: "test-model" };
}

test("the package declares anthropic-messages, openai-chat and gemini, and each is accepted and sent in its own format", async () => {
  const seen = [];
  const standIn = await startStandIn(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answerFor(req.url, "yes")));
  });
  try {
    // The job passes the protocols its text-reasoning system declares.
    const protocols = declaredProtocols();
    assert.deepEqual(protocols, ["anthropic-messages", "openai-chat", "gemini"]);
    const expected = {
      "anthropic-messages": "/v1/messages",
      "openai-chat": "/chat/completions",
      gemini: "/models/test-model:generateContent",
    };
    for (const [protocol, path] of Object.entries(expected)) {
      const env = { MODEL_ENDPOINT: standIn.endpoint, MODEL_NAME: "test-model", MODEL_PROTOCOL: protocol, MODEL_KEY: "k-1234" };
      assert.equal(whyNoCall(env), "", protocol);
      const before = seen.length;
      const out = await callModel("hi", { env, protocols });
      assert.equal(out.text, "yes", protocol);
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

test("a model_protocol outside the caller's list stops before anything is sent and names the setting", async () => {
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
      MODEL_PROTOCOL: "bedrock",
      MODEL_KEY: "",
    };
    const protocols = declaredProtocols();
    await assert.rejects(callModel("hi", { env, protocols }), /MODEL_PROTOCOL/);
    await assert.rejects(callModel("hi", { env }), /MODEL_PROTOCOL/);
    assert.match(cannotCall(env), /MODEL_PROTOCOL/);
    assert.match(whyNoCall(env), /MODEL_PROTOCOL/);
    await assert.rejects(callFor(env)({ body: { contents: [{ parts: [{ text: "hi" }] }] } }), /MODEL_PROTOCOL/);
    assert.equal(requests, 0, "no request should be sent when MODEL_PROTOCOL is unsupported");
  } finally {
    await standIn.close();
  }
});

test("a declared protocols list is enforced: with a narrower list passed, a protocol outside it stops before anything is sent and names the setting", async () => {
  let requests = 0;
  const standIn = await startStandIn((req, res) => {
    requests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "no" }], stop_reason: "end_turn" }));
  });
  try {
    const narrower = ["anthropic-messages"];
    const env = { MODEL_ENDPOINT: standIn.endpoint, MODEL_NAME: "test-model", MODEL_PROTOCOL: "openai-chat", MODEL_KEY: "" };
    await assert.rejects(callModel("hi", { env, protocols: narrower }), /MODEL_PROTOCOL/);
    assert.match(cannotCall(env, { protocols: narrower }), /MODEL_PROTOCOL/);
    assert.match(whyNoCall(env, { protocols: narrower }), /MODEL_PROTOCOL/);
    await assert.rejects(callFor(env, { protocols: narrower })({ body: { contents: [{ parts: [{ text: "hi" }] }] } }), /MODEL_PROTOCOL/);
    assert.equal(requests, 0, "no request should be sent for a protocol outside the list passed");
  } finally {
    await standIn.close();
  }
});

test("when the declared protocols cannot be read, nothing is sent and the words are PROTOCOLS_UNREAD", async () => {
  let requests = 0;
  const standIn = await startStandIn((req, res) => {
    requests += 1;
    res.writeHead(200);
    res.end();
  });
  const missing = mkdtempSync(join(tmpdir(), "test-writer-noreqs-"));
  const empty = mkdtempSync(join(tmpdir(), "test-writer-noprotocols-"));
  try {
    mkdirSync(join(missing, "scripts"));
    mkdirSync(join(empty, "scripts"));
    writeFileSync(join(empty, "agent-runtime-requirements.json"), JSON.stringify({ systems: [{ name: "text-reasoning", kind: "model" }] }));
    const env = { MODEL_ENDPOINT: standIn.endpoint, MODEL_NAME: "test-model", MODEL_PROTOCOL: "anthropic-messages", MODEL_KEY: "" };
    for (const dir of [missing, empty]) {
      const protocols = declaredProtocols(join(dir, "scripts"));
      assert.equal(whyNoCall(env, { protocols }), PROTOCOLS_UNREAD, dir);
      await assert.rejects(
        callFor(env, { protocols, fetchImpl: async () => { requests += 1; throw new Error("nothing should be sent"); } })({ body: { contents: [{ parts: [{ text: "hi" }] }] } }),
        (err) => {
          assert.equal(err.message, PROTOCOLS_UNREAD, dir);
          return true;
        }
      );
    }
    assert.equal(requests, 0, "nothing reached the stand-in");
  } finally {
    await standIn.close();
    rmSync(missing, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
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

test("the runtime requirements and plugin manifest declare text-reasoning under anthropic-messages, openai-chat and gemini with the shared caller", () => {
  const req = JSON.parse(readFileSync(join(here, "..", "agent-runtime-requirements.json"), "utf8"));
  const sys = req.systems?.find((s) => s.name === "text-reasoning" || s.role === "text-reasoning");
  assert.ok(sys, "text-reasoning system declared");
  assert.equal(sys.name, "text-reasoning");
  assert.equal(sys.kind, "model");
  assert.deepEqual(sys.protocols, ["anthropic-messages", "openai-chat", "gemini"]);
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
