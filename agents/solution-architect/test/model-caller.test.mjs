// The model caller reaches the text-reasoning model through the four standard
// settings: MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL.
//
// What is worth pinning: the model is reached through POST /v1/messages with
// the anthropic-version header and model name in the body; x-api-key is sent
// only when MODEL_KEY is not empty; the package declares anthropic-messages,
// openai-chat and gemini, and each is sent in its own format; missing or empty
// settings, a protocol outside the caller's list, one outside a narrower list
// passed, or declared protocols that cannot be read, stop before sending any
// request; settings are read on every run;
// an answer cut at its limit fails, marked cutAtLimit, naming the limit; old Google
// Vertex, Gemini and AGENT_MODEL variables are never read; declarations name
// the three protocols for text-reasoning; name.mjs asks for JSON
// with json: true; replayCaller answers without TEXT_API_KEY; and architecture
// records binding a model system state that the install places the model in
// MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL and never name
// TEXT_MODEL or AGENT_MODEL. callerFor and replayCaller answer an object whose
// ask() makes the call, as the shared caller (model-caller.mjs) defines.
//
// Nothing here touches a real network or model: all calls reach a local
// stand-in server on 127.0.0.1 started inside the test.
// Run: node --test test/model-caller.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callerFor, replayCaller } from "../scripts/model-caller.mjs";
import { bindAll } from "../scripts/bind.mjs";
import { PROTOCOLS_UNREAD, declaredProtocols, modelCaller } from "../scripts/name.mjs";
import { renderRecord } from "../scripts/architecture-record.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function standInServer(handler) {
  let server;
  const requests = [];
  return {
    requests,
    async start() {
      server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bodyText = Buffer.concat(chunks).toString("utf8");
        let body = null;
        try { body = JSON.parse(bodyText); } catch { body = bodyText; }
        const recorded = { method: req.method, url: req.url, headers: req.headers, body };
        requests.push(recorded);
        if (handler) {
          await handler(req, res, recorded);
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            id: "msg_stand_in",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: JSON.stringify({ systems: [] }) }],
            stop_reason: "end_turn",
          }));
        }
      });
      return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address();
          resolve(`http://127.0.0.1:${port}`);
        });
      });
    },
    async close() {
      if (server) await new Promise((done) => server.close(done));
    },
  };
}

test("the stand-in receives post /v1/messages with anthropic-version and model in the body", async () => {
  const standIn = standInServer();
  const endpoint = await standIn.start();
  try {
    const env = {
      MODEL_NAME: "test-reasoning-model",
      MODEL_ENDPOINT: endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "secret-key-123",
    };
    const { ask } = callerFor(env);
    await ask("Write the architecture");
    assert.equal(standIn.requests.length, 1);
    const req = standIn.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/messages");
    assert.ok(req.headers["anthropic-version"], "anthropic-version header must be sent");
    assert.equal(req.headers["x-api-key"], "secret-key-123");
    assert.equal(req.body.model, "test-reasoning-model");
  } finally {
    await standIn.close();
  }
});

test("the api key is sent in x-api-key only when model_key is not empty", async () => {
  const standIn = standInServer();
  const endpoint = await standIn.start();
  try {
    const { ask: askEmpty } = callerFor({
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "",
    });
    await askEmpty("Hello with empty key");
    assert.equal(standIn.requests.length, 1);
    assert.equal(standIn.requests[0].headers["x-api-key"], undefined);

    const { ask: askUnset } = callerFor({
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    });
    await askUnset("Hello with unset key");
    assert.equal(standIn.requests.length, 2);
    assert.equal(standIn.requests[1].headers["x-api-key"], undefined);
  } finally {
    await standIn.close();
  }
});

test("missing or empty model_name stops before sending and names the setting", async () => {
  const standIn = standInServer();
  const endpoint = await standIn.start();
  try {
    for (const emptyName of [undefined, ""]) {
      await assert.rejects(
        async () => {
          const caller = callerFor({
            MODEL_NAME: emptyName,
            MODEL_ENDPOINT: endpoint,
            MODEL_PROTOCOL: "anthropic-messages",
          });
          await caller.ask("Hello");
        },
        (err) => {
          assert.match(err.message, /MODEL_NAME/);
          return true;
        }
      );
    }
    assert.equal(standIn.requests.length, 0, "stand-in must see no request");
  } finally {
    await standIn.close();
  }
});

test("missing or empty model_endpoint stops before sending and names the setting", async () => {
  const standIn = standInServer();
  await standIn.start();
  try {
    for (const emptyEndpoint of [undefined, ""]) {
      await assert.rejects(
        async () => {
          const caller = callerFor({
            MODEL_NAME: "test-model",
            MODEL_ENDPOINT: emptyEndpoint,
            MODEL_PROTOCOL: "anthropic-messages",
          });
          await caller.ask("Hello");
        },
        (err) => {
          assert.match(err.message, /MODEL_ENDPOINT/);
          return true;
        }
      );
    }
    assert.equal(standIn.requests.length, 0, "stand-in must see no request");
  } finally {
    await standIn.close();
  }
});

test("missing or empty model_protocol stops before sending and names the setting", async () => {
  const standIn = standInServer();
  const endpoint = await standIn.start();
  try {
    for (const emptyProtocol of [undefined, ""]) {
      await assert.rejects(
        async () => {
          const caller = callerFor({
            MODEL_NAME: "test-model",
            MODEL_ENDPOINT: endpoint,
            MODEL_PROTOCOL: emptyProtocol,
          });
          await caller.ask("Hello");
        },
        (err) => {
          assert.match(err.message, /MODEL_PROTOCOL/);
          return true;
        }
      );
    }
    assert.equal(standIn.requests.length, 0, "stand-in must see no request");
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

test("the package declares anthropic-messages, openai-chat and gemini, and modelCaller sends each in its own format", async () => {
  assert.deepEqual(declaredProtocols(), ["anthropic-messages", "openai-chat", "gemini"]);
  const standIn = standInServer(async (req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answerFor(req.url, JSON.stringify({ systems: [] }))));
  });
  const endpoint = await standIn.start();
  try {
    const expected = {
      "anthropic-messages": "/v1/messages",
      "openai-chat": "/chat/completions",
      gemini: "/models/test-model:generateContent",
    };
    for (const [protocol, path] of Object.entries(expected)) {
      const before = standIn.requests.length;
      // modelCaller reads the declared protocols itself.
      const caller = modelCaller({ MODEL_NAME: "test-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: protocol, MODEL_KEY: "k-1234" }, fetch);
      const out = await caller.ask("Hello", { json: true });
      assert.deepEqual(JSON.parse(out.text), { systems: [] }, protocol);
      assert.equal(standIn.requests.length, before + 1, `${protocol} sent one request`);
      assert.equal(standIn.requests[before].method, "POST", protocol);
      assert.equal(standIn.requests[before].url, path, protocol);
    }
    const [anthropic, openai, gemini] = standIn.requests;
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

test("a model_protocol outside the caller's list stops before sending and names model_protocol", async () => {
  const standIn = standInServer();
  const endpoint = await standIn.start();
  try {
    const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "bedrock" };
    assert.throws(() => modelCaller(env, fetch), /MODEL_PROTOCOL/);
    await assert.rejects(
      async () => {
        const caller = callerFor(env);
        await caller.ask("Hello");
      },
      (err) => {
        assert.match(err.message, /MODEL_PROTOCOL/);
        return true;
      }
    );
    assert.equal(standIn.requests.length, 0, "stand-in must see no request");
  } finally {
    await standIn.close();
  }
});

test("a declared protocols list is enforced: with a narrower list passed, a protocol outside it stops before sending and names model_protocol", async () => {
  const standIn = standInServer();
  const endpoint = await standIn.start();
  try {
    const narrower = ["anthropic-messages"];
    const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "openai-chat" };
    assert.throws(() => modelCaller(env, fetch, { protocols: narrower }), /MODEL_PROTOCOL openai-chat is not one this package's model system declares/);
    await assert.rejects(
      async () => {
        const caller = callerFor(env, fetch, { protocols: narrower });
        await caller.ask("Hello");
      },
      /MODEL_PROTOCOL/
    );
    assert.equal(standIn.requests.length, 0, "stand-in must see no request");
  } finally {
    await standIn.close();
  }
});

test("when the declared protocols cannot be read, modelCaller sends nothing and its words are PROTOCOLS_UNREAD", async () => {
  const standIn = standInServer();
  const endpoint = await standIn.start();
  const missing = mkdtempSync(join(tmpdir(), "solution-architect-noreqs-"));
  const empty = mkdtempSync(join(tmpdir(), "solution-architect-noprotocols-"));
  try {
    mkdirSync(join(missing, "scripts"));
    mkdirSync(join(empty, "scripts"));
    writeFileSync(join(empty, "agent-runtime-requirements.json"), JSON.stringify({ systems: [{ name: "text-reasoning", kind: "model" }] }));
    const env = { MODEL_NAME: "test-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "anthropic-messages" };
    for (const dir of [missing, empty]) {
      assert.throws(
        () => modelCaller(env, fetch, { protocols: declaredProtocols(join(dir, "scripts")) }),
        (err) => {
          assert.equal(err.message, PROTOCOLS_UNREAD, dir);
          return true;
        }
      );
    }
    assert.equal(standIn.requests.length, 0, "nothing reached the stand-in");
  } finally {
    await standIn.close();
    rmSync(missing, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test("settings are read on every run so different endpoints reach different stand-ins", async () => {
  const standIn1 = standInServer();
  const standIn2 = standInServer();
  const ep1 = await standIn1.start();
  const ep2 = await standIn2.start();
  try {
    const { ask: ask1 } = callerFor({
      MODEL_NAME: "model-1",
      MODEL_ENDPOINT: ep1,
      MODEL_PROTOCOL: "anthropic-messages",
    });
    await ask1("First run");

    const { ask: ask2 } = callerFor({
      MODEL_NAME: "model-2",
      MODEL_ENDPOINT: ep2,
      MODEL_PROTOCOL: "anthropic-messages",
    });
    await ask2("Second run");

    assert.equal(standIn1.requests.length, 1);
    assert.equal(standIn2.requests.length, 1);
    assert.equal(standIn1.requests[0].body.model, "model-1");
    assert.equal(standIn2.requests[0].body.model, "model-2");
  } finally {
    await standIn1.close();
    await standIn2.close();
  }
});

test("an answer cut at max_tokens fails with a message naming the limit and is never read as whole", async () => {
  const standIn = standInServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_cut",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: '{"systems": [{"name": "text' }],
      stop_reason: "max_tokens",
    }));
  });
  const endpoint = await standIn.start();
  try {
    const { ask } = callerFor({
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
    });
    await assert.rejects(
      async () => {
        await ask("Give the full architecture", { maxOutputTokens: 4096 });
      },
      (err) => {
        assert.equal(err.cutAtLimit, true, "the shared caller marks an answer cut at its limit");
        assert.match(err.message, /cut at its limit of 4096 tokens/);
        assert.match(err.message, /not read/);
        return true;
      }
    );
    assert.equal(standIn.requests[0].body.max_tokens, 4096, "the limit named is the one the call asked for");
  } finally {
    await standIn.close();
  }
});

test("no script reads agent_model, vertex_where or google variables, and setting them changes nothing", async () => {
  const scriptsDir = join(ROOT, "scripts");
  const files = readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"));
  for (const f of files) {
    const text = readFileSync(join(scriptsDir, f), "utf8");
    const code = text.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /\bAGENT_MODEL\b/, `${f} reads AGENT_MODEL`);
    assert.doesNotMatch(code, /\bVERTEX_WHERE\b/, `${f} reads VERTEX_WHERE`);
    assert.doesNotMatch(code, /\bGOOGLE_[A-Z0-9_]+\b/, `${f} reads a GOOGLE_ variable`);
  }

  const standIn = standInServer();
  const endpoint = await standIn.start();
  try {
    const { ask } = callerFor({
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: endpoint,
      MODEL_PROTOCOL: "anthropic-messages",
      AGENT_MODEL: "disallowed-agent-model",
      VERTEX_WHERE: "disallowed-vertex-location",
      GOOGLE_API_KEY: "disallowed-google-key",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/fake.json",
    });
    await ask("Check variables");
    assert.equal(standIn.requests.length, 1);
    const bodyStr = JSON.stringify(standIn.requests[0].body);
    assert.equal(bodyStr.includes("disallowed-agent-model"), false);
  } finally {
    await standIn.close();
  }
});

test("no script names the metadata server or carries forbidden network address literals", () => {
  const scriptsDir = join(ROOT, "scripts");
  const files = readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"));
  const exceptedPrefixes = [
    "https://schemas.agentmesh.ai/",
    "http://schemas.agentmesh.ai/",
    "https://json-schema.org/",
    "http://json-schema.org/",
    "https://www.w3.org/",
    "http://www.w3.org/",
    "https://schemas.example/",
  ];

  for (const f of files) {
    const text = readFileSync(join(scriptsDir, f), "utf8");
    const code = text.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /metadata\.google\.internal/, `${f} names the metadata server`);
    assert.doesNotMatch(code, /169\.254\.\d+\.\d+/, `${f} carries metadata IP literal`);

    const matches = code.matchAll(/(https?|wss?):\/\/[a-zA-Z0-9\[][^\s"'`)]*/g);
    for (const m of matches) {
      const url = m[0];
      const allowed = exceptedPrefixes.some((prefix) => url.startsWith(prefix));
      assert.ok(allowed, `${f} carries forbidden address literal: ${url}`);
    }
  }
});

test("agent-runtime-requirements declares text-reasoning with anthropic-messages, openai-chat and gemini and no credential, env or settings", () => {
  const reqs = JSON.parse(readFileSync(join(ROOT, "agent-runtime-requirements.json"), "utf8"));
  const tr = (reqs.systems ?? []).find((s) => s.name === "text-reasoning");
  assert.ok(tr, "text-reasoning must be declared in agent-runtime-requirements.json");
  assert.deepEqual(tr, {
    name: "text-reasoning",
    kind: "model",
    protocols: ["anthropic-messages", "openai-chat", "gemini"],
  });
  assert.equal(tr.credential, undefined);
  assert.equal(tr.env, undefined);
  assert.equal(tr.settings, undefined);
});

test("plugin build lists model-caller for skills calling the model and drops the old caller", () => {
  const plugin = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  for (const [slug, skill] of Object.entries(skills)) {
    const scripts = skill.scripts ?? [];
    const callsModel = scripts.some((s) => s.endsWith("name.mjs"));
    if (callsModel) {
      assert.ok(
        scripts.some((s) => s.endsWith("model-caller.mjs")),
        `${slug} must list scripts/model-caller.mjs`
      );
      assert.ok(
        !scripts.some((s) => s.endsWith("caller.mjs") && !s.endsWith("model-caller.mjs")),
        `${slug} must not list the old caller`
      );
    }
  }
});

test("name asks the model through callerfor with json true", () => {
  const text = readFileSync(join(ROOT, "scripts", "name.mjs"), "utf8");
  assert.match(text, /callerFor\([^)]*json:\s*true/);
});

test("replaycaller answers from files without requiring text_api_key", async () => {
  const fixtureFile = join(HERE, "fixtures", "key-points.answer.json");
  // replayCaller takes no env at all, so no setting and no key is read.
  const replay = replayCaller(fixtureFile);
  const answer = await replay.ask("statement");
  assert.ok(answer, "replayCaller must return an answer");
  const text = typeof answer === "string" ? answer : (answer.text ?? JSON.stringify(answer));
  assert.ok(text.includes("text-reasoning"));
});

test("an architecture record binding a model says install places it in standard model variables and never names text_model or agent_model", () => {
  // A system nothing can stand behind is a question and never a decision, so
  // the vocabulary gives text-reasoning a House Stack product to bind.
  const vocabulary = [{ name: "text-reasoning", plain: "text reasoning", capability: "text", access: "trigger", house: { covered: true, product: "google-gemini" } }];
  const out = bindAll({ systems: [{ name: "text-reasoning", access: "trigger" }] }, { vocabulary });
  const decision = out.decisions.find((d) => d.decided.includes("text-reasoning"));
  assert.ok(decision, "must have a decision for text-reasoning");

  const combined = `${decision.decided} ${decision.why} ${decision.follows ?? ""}`;
  assert.match(combined, /MODEL_NAME/);
  assert.match(combined, /MODEL_ENDPOINT/);
  assert.match(combined, /MODEL_KEY/);
  assert.match(combined, /MODEL_PROTOCOL/);
  assert.doesNotMatch(combined, /TEXT_MODEL/);
  assert.doesNotMatch(combined, /AGENT_MODEL/);

  const rendered = renderRecord({
    title: "sample",
    statement: "sample statement",
    environments: ["dev"],
    systems: [{
      name: "text-reasoning",
      plain: "text reasoning",
      capability: "text",
      access: "trigger",
      why: "reasoning",
      bindings: { dev: { product: "google-gemini", provided_by: "platform" } },
    }],
    kind: { kind: "plugin-on-harness", why: "default" },
    decisions: out.decisions,
    questions: [],
    standing_assets: { outputs: [], schemas: [], none: "no output is read by a person" },
    done: true,
  });
  assert.match(rendered, /MODEL_NAME/);
  assert.match(rendered, /MODEL_ENDPOINT/);
  assert.match(rendered, /MODEL_KEY/);
  assert.match(rendered, /MODEL_PROTOCOL/);
  assert.doesNotMatch(rendered, /TEXT_MODEL/);
  assert.doesNotMatch(rendered, /AGENT_MODEL/);
});
