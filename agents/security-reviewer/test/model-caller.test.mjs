// The shared model caller: reaching the model in the format MODEL_PROTOCOL names.
//
// What is worth pinning: the model is reached through POST /v1/messages with
// anthropic-version, model name in JSON body, and x-api-key only when MODEL_KEY
// is not empty; missing or invalid MODEL_NAME, MODEL_ENDPOINT, or MODEL_PROTOCOL
// stops before sending any request, as does a MODEL_PROTOCOL outside the caller's
// list; the package declares anthropic-messages, openai-chat and gemini, and weigh
// sends each in its own format; a narrower protocols list passed is enforced, and
// declared protocols that cannot be read stop weigh before it sends (PROTOCOLS_UNREAD);
// settings are read on every run so endpoints can change within one process;
// answers cut at max_tokens fail immediately, marked cutAtLimit; the process
// contract exits 2 when PROMPT_FILE is missing, and a run whose settings cannot
// make a call fails naming the setting.
// The caller is called its own way, callModel(prompt, { env, ... }), with the
// test's settings handed in as env.
// Nothing here touches a real service: all calls go to an in-test HTTP server
// listening on 127.0.0.1.
// Run: node --test test/model-caller.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel } from "../scripts/model-caller.mjs";
import { PROTOCOLS_UNREAD, declaredProtocols, weigh } from "../scripts/weigh.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "..", "scripts", "model-caller.mjs");
// The protocols this package's model system declares, read from its own
// runtime requirements, as a job passes them to the caller.
const DECLARED_PROTOCOLS = JSON.parse(readFileSync(join(here, "..", "agent-runtime-requirements.json"), "utf8"))
  .systems.find((s) => s.kind === "model").protocols;

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
    const out = await callModel("Judge this reason.", { env });

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
    for (const key of ["", undefined]) {
      receivedHeaders = null;
      const env = {
        MODEL_NAME: "claude-test-v1",
        MODEL_ENDPOINT: standIn.endpoint,
        MODEL_PROTOCOL: "anthropic-messages",
        ...(key === undefined ? {} : { MODEL_KEY: key }),
      };
      await callModel("hello", { env });
      assert.ok(receivedHeaders, "the stand-in was called");
      assert.equal(receivedHeaders["x-api-key"], undefined, "x-api-key header must not be set when empty or unset");
    }
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
        () => callModel("test", {
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
  let calls = 0;
  for (const val of [undefined, ""]) {
    await assert.rejects(
      () => callModel("test", {
        env: {
          MODEL_NAME: "test-model",
          MODEL_ENDPOINT: val,
          MODEL_PROTOCOL: "anthropic-messages",
        },
        fetchImpl: async () => { calls += 1; throw new Error("nothing should be sent"); },
      }),
      /MODEL_ENDPOINT/,
    );
  }
  assert.equal(calls, 0, "nothing was sent");
});

test("a run with model_protocol unset, empty, or outside the caller's list stops before sending and names the setting", async () => {
  let calls = 0;
  const standIn = await startStandIn((req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end();
  });

  try {
    for (const val of [undefined, "", "bedrock"]) {
      for (const protocols of [undefined, DECLARED_PROTOCOLS]) {
        await assert.rejects(
          () => callModel("test", {
            env: {
              MODEL_NAME: "test-model",
              MODEL_ENDPOINT: standIn.endpoint,
              MODEL_PROTOCOL: val,
            },
            protocols,
          }),
          /MODEL_PROTOCOL/,
        );
      }
    }
    const w = await weigh({ a: ONE_REASON, pkg: { name: "p" }, env: { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.endpoint, MODEL_PROTOCOL: "bedrock" } });
    assert.match(w.skipped, /MODEL_PROTOCOL/);
    assert.equal(calls, 0, "stand-in received no requests");
  } finally {
    await standIn.close();
  }
});

// A permission with a recorded reason, so weigh has one item to put to the model.
const ONE_REASON = { reaches: [{ system: "weather", access: "read", reason: "reads the forecast for the city the person names" }], spends: [] };
const JUDGED = JSON.stringify({ judgments: [{ id: "reach-1", holds: "holds", says: "Reading a forecast needs read access." }] });

// Each format's own answer, as a stand-in for that format gives it.
function answerFor(url, text) {
  if (url.startsWith("/v1/messages")) return { id: "msg_1", type: "message", role: "assistant", model: "test-model", content: [{ type: "text", text }], stop_reason: "end_turn" };
  if (url.startsWith("/chat/completions")) return { id: "c_1", model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] };
  return { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], modelVersion: "test-model" };
}

test("the package's model system declares exactly anthropic-messages, openai-chat and gemini, and weigh sends each in its own format", async () => {
  assert.deepEqual(DECLARED_PROTOCOLS, ["anthropic-messages", "openai-chat", "gemini"]);
  const received = [];
  const standIn = await startStandIn(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answerFor(req.url, JUDGED)));
  });
  try {
    const expected = {
      "anthropic-messages": "/v1/messages",
      "openai-chat": "/chat/completions",
      gemini: "/models/test-model:generateContent",
    };
    for (const [protocol, path] of Object.entries(expected)) {
      const before = received.length;
      // weigh reads the declared protocols itself.
      const w = await weigh({ a: ONE_REASON, pkg: { name: "p" }, env: { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.endpoint, MODEL_PROTOCOL: protocol, MODEL_KEY: "k-1234" } });
      assert.equal(w.skipped, undefined, `${protocol}: ${w.skipped}`);
      assert.equal(w.weighed.judgments[0].holds, "holds", protocol);
      assert.equal(received.length, before + 1, `${protocol} sent one request`);
      assert.equal(received[before].method, "POST", protocol);
      assert.equal(received[before].url, path, protocol);
    }
    const [anthropic, openai, gemini] = received;
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

test("a declared protocols list is enforced: with a narrower list passed, a protocol outside it stops before sending and names MODEL_PROTOCOL", async () => {
  let calls = 0;
  const standIn = await startStandIn((req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end();
  });
  try {
    const narrower = ["anthropic-messages"];
    const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.endpoint, MODEL_PROTOCOL: "gemini" };
    await assert.rejects(() => callModel("test", { env, protocols: narrower }), /MODEL_PROTOCOL/);
    const w = await weigh({ a: ONE_REASON, pkg: { name: "p" }, env, protocols: narrower });
    assert.match(w.skipped, /MODEL_PROTOCOL/);
    assert.equal(calls, 0, "stand-in received no requests");
  } finally {
    await standIn.close();
  }
});

test("when the declared protocols cannot be read, weigh sends nothing and its words are PROTOCOLS_UNREAD", async () => {
  let calls = 0;
  const standIn = await startStandIn((req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end();
  });
  const dir = mkdtempSync(join(tmpdir(), "security-reviewer-protocols-"));
  try {
    const missing = join(dir, "missing", "agent-runtime-requirements.json");
    const empty = join(dir, "agent-runtime-requirements.json");
    writeFileSync(empty, JSON.stringify({ systems: [{ name: "text-reasoning", kind: "model" }] }));
    const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: standIn.endpoint, MODEL_PROTOCOL: "anthropic-messages" };
    for (const file of [missing, empty]) {
      const w = await weigh({ a: ONE_REASON, pkg: { name: "p" }, env, protocols: declaredProtocols([file]) });
      assert.equal(w.skipped, PROTOCOLS_UNREAD, file);
      assert.equal(w.weighed, undefined);
    }
    assert.equal(calls, 0, "nothing reached the stand-in");
  } finally {
    await standIn.close();
    rmSync(dir, { recursive: true, force: true });
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

    const first = await callModel("first", { env: env1 });
    assert.equal(first.text, "one");
    assert.equal(server1Calls, 1);
    assert.equal(server2Calls, 0);

    const second = await callModel("second", { env: env2 });
    assert.equal(second.text, "two");
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
      () => callModel("test", {
        env: {
          MODEL_NAME: "m",
          MODEL_ENDPOINT: standIn.endpoint,
          MODEL_PROTOCOL: "anthropic-messages",
        },
      }),
      (err) => {
        assert.equal(err.cutAtLimit, true, "the failure is marked as an answer cut at its limit");
        assert.match(err.message, /cut at its limit/);
        return true;
      },
    );
  } finally {
    await standIn.close();
  }
});

test("the process contract exits 2 when a required setting is missing", () => {
  // The caller's own command line requires PROMPT_FILE, and exits 2 without it.
  const env = { ...process.env, MODEL_NAME: "", MODEL_ENDPOINT: "", MODEL_PROTOCOL: "" };
  delete env.PROMPT_FILE;
  const res = spawnSync(process.execPath, [scriptPath], { env, encoding: "utf8" });
  assert.equal(res.status, 2);
  assert.match(`${res.stdout}\n${res.stderr}`, /PROMPT_FILE is required/);

  // With a prompt but no model settings, nothing is sent and the failure names the setting.
  const dir = mkdtempSync(join(tmpdir(), "security-reviewer-"));
  try {
    const promptFile = join(dir, "prompt.txt");
    writeFileSync(promptFile, "hello");
    const withPrompt = { ...env, PROMPT_FILE: promptFile };
    delete withPrompt.TEXT_MODEL;
    const r2 = spawnSync(process.execPath, [scriptPath], { env: withPrompt, encoding: "utf8" });
    assert.equal(r2.status, 1);
    const out = JSON.parse(r2.stdout.trim());
    assert.equal(out.ok, false);
    assert.match(out.error, /MODEL_NAME/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
