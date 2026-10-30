// Asking the model drafts the plan's steps from the description, with at most
// one retry when the output cannot be read.
//
// What is worth pinning: askModel calls the model through callModel with json,
// an output budget of 32000 tokens, and a time limit; a response that cannot be
// read as json is retried once with the problems appended and never a third
// time; an answer cut at its limit is not retried with the same budget and
// reports why it failed; askModel and makePlan take the environment directly;
// and the plan's estimate carries 1.50 as the price of one new agent, with no
// setting read for it (NEW_AGENT_USD is no longer read).
// Nothing here touches a real service: all model calls reach a stand-in server
// on 127.0.0.1.
// Run: node --test test/ask.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { askModel } from "../scripts/ask.mjs";
import { makePlan } from "../scripts/plan.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

function standInServer(onMessage) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch {}
      if (onMessage) {
        onMessage({ method: req.method, url: req.url, headers: req.headers, body, text }, res);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: body?.model || "test-model",
          content: [{ type: "text", text: "{}" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function folders(body) {
  const root = mkdtempSync(join(tmpdir(), "planner-ask-"));
  const d = {
    root,
    job: join(root, "job"),
    records: join(root, "records", "job1"),
    work: join(root, "work"),
  };
  for (const p of [join(d.job, "out"), d.records, d.work]) mkdirSync(p, { recursive: true });
  try { await body(d); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("the model is asked once with an output budget of 32000 tokens when the first answer is json", async () => {
  let seen = null;
  const draft = {
    format: "build-plan-v1",
    title: "Draft Title",
    summary: "One step draft",
    refused: null,
    start: [],
    steps: [],
    schedule: null,
    estimate: { per_run_usd: 1, to_build_usd: 0, ready_minutes: 1, run_minutes: 10 },
    cannot: [],
    missing: [],
  };

  const standIn = await standInServer((reqInfo, res) => {
    seen = reqInfo;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text: JSON.stringify(draft) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 30 },
    }));
  });

  try {
    const env = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.url,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "",
    };
    const reading = {
      ok: true,
      description: "Do something useful",
      earlier: null,
      change: null,
    };
    const res = await askModel({ env, reading, description: reading.description });
    assert.ok(seen, "stand-in received a request");
    assert.equal(seen.body.max_tokens, 32000);
    const promptText = JSON.stringify(seen.body);
    assert.ok(promptText.includes("DESCRIPTION START"));
    assert.ok(promptText.includes("DESCRIPTION END"));
    assert.ok(res.plan || res.draft, "draft plan returned");
  } finally {
    await standIn.close();
  }
});

test("an answer that is not json is asked once more with the problems appended", async () => {
  let calls = 0;
  const bodies = [];
  const draft = {
    format: "build-plan-v1",
    title: "Retry Title",
    summary: "Recovered",
    refused: null,
    start: [],
    steps: [],
    schedule: null,
    estimate: { per_run_usd: 1, to_build_usd: 0, ready_minutes: 1, run_minutes: 10 },
    cannot: [],
    missing: [],
  };

  const standIn = await standInServer((reqInfo, res) => {
    calls += 1;
    bodies.push(reqInfo.body);
    res.writeHead(200, { "content-type": "application/json" });
    if (calls === 1) {
      res.end(JSON.stringify({
        id: "msg_fail",
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [{ type: "text", text: "Here is your plan: sorry, not JSON!" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 20, output_tokens: 10 },
      }));
    } else {
      res.end(JSON.stringify({
        id: "msg_ok",
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [{ type: "text", text: JSON.stringify(draft) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 30, output_tokens: 25 },
      }));
    }
  });

  try {
    const env = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.url,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "k",
    };
    const reading = {
      ok: true,
      description: "Retry this task",
      earlier: null,
      change: null,
    };
    const res = await askModel({ env, reading, description: reading.description });
    assert.equal(calls, 2, "asked twice and never a third time");
    assert.ok(res.plan || res.draft, "plan obtained after retry");
    const secondPrompt = JSON.stringify(bodies[1]);
    assert.match(secondPrompt, /json|problem|failed/i);
  } finally {
    await standIn.close();
  }
});

test("an answer cut at its limit is not asked again and the failure states it was cut at its limit", async () => {
  let calls = 0;
  const standIn = await standInServer((_, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_cut",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text: '{"format":"build-plan-v1"' }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 32000 },
    }));
  });

  try {
    const env = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.url,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "k",
    };
    const reading = {
      ok: true,
      description: "Make an enormous plan",
      earlier: null,
      change: null,
    };
    let failed = false;
    let reason = "";
    try {
      const res = await askModel({ env, reading, description: reading.description });
      if (res && (res.ok === false || res.error || !res.plan)) {
        failed = true;
        reason = res.error || res.reply || "";
      }
    } catch (err) {
      failed = true;
      reason = err.message || "";
    }
    assert.equal(failed, true, "cut at limit was treated as a failure");
    assert.equal(calls, 1, "not asked again with the same budget");
    assert.match(reason, /limit/i);
  } finally {
    await standIn.close();
  }
});

test("a model that fails on both tries stops without a plan and reports that the model failed", async () => {
  let calls = 0;
  const standIn = await standInServer((_, res) => {
    calls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_fail",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text: "definitely not json" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });

  try {
    const env = {
      MODEL_NAME: "test-model",
      MODEL_ENDPOINT: standIn.url,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "k",
    };
    const reading = {
      ok: true,
      description: "Impossible to parse",
      earlier: null,
      change: null,
    };
    let failed = false;
    let reason = "";
    try {
      const res = await askModel({ env, reading, description: reading.description });
      if (res && (res.ok === false || res.error || !res.plan)) {
        failed = true;
        reason = res.error || res.reply || "";
      }
    } catch (err) {
      failed = true;
      reason = err.message || "";
    }
    assert.equal(failed, true);
    assert.equal(calls, 2, "never asks a third time");
    assert.match(reason, /model/i);
  } finally {
    await standIn.close();
  }
});

test("the environment is accepted directly rather than passing a model name and key", async () => {
  let receivedModel = null;
  const standIn = await standInServer((reqInfo, res) => {
    receivedModel = reqInfo.body?.model;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_ok",
      type: "message",
      role: "assistant",
      model: "passed-env-model",
      content: [{ type: "text", text: JSON.stringify({ format: "build-plan-v1", title: "Env Plan", steps: [] }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 5 },
    }));
  });

  try {
    const env = {
      MODEL_NAME: "passed-env-model",
      MODEL_ENDPOINT: standIn.url,
      MODEL_PROTOCOL: "anthropic-messages",
      MODEL_KEY: "passed-key",
    };
    const reading = {
      ok: true,
      description: "Direct env test",
      earlier: null,
      change: null,
    };
    const res = await askModel({ env, reading, description: reading.description });
    assert.equal(receivedModel, "passed-env-model");
    assert.ok(res.plan || res.draft);
  } finally {
    await standIn.close();
  }
});

test("the price of building one new agent is the 1.50 the plan estimate carries, and NEW_AGENT_USD is not read", async () => {
  const draft = {
    format: "build-plan-v1",
    title: "Page summary",
    summary: "One step summary",
    refused: null,
    start: [{ name: "url", kind: "url", value: "https://example.com", says: "the url" }],
    steps: [{
      id: "s1",
      title: "Read",
      status: "new",
      agent: null,
      offering: null,
      agent_name: "reader",
      new_agent: { name: "reader", does: "Reads a page" },
      needs: { kind: "reading", takes: [{ name: "url", kind: "url", required: true }], gives: [{ name: "text", kind: "text" }] },
      inputs: [{ name: "url", from: "start.url" }],
      outputs: ["text"],
    }],
    schedule: null,
    estimate: { per_run_usd: 1, to_build_usd: 0, ready_minutes: 1, run_minutes: 10 },
    cannot: [],
    missing: [],
  };

  const standIn = await standInServer((_, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_good",
      type: "message",
      role: "assistant",
      model: "claude-test",
      content: [{ type: "text", text: JSON.stringify(draft) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    }));
  });

  try {
    await folders(async (d) => {
      const messageFile = join(d.job, "message.txt");
      writeFileSync(messageFile, "Read https://example.com");
      const argv = ["--job", d.job, "--records", d.records, "--work", d.work, "--text-file", messageFile];
      const env = {
        MODEL_NAME: "claude-test",
        MODEL_ENDPOINT: standIn.url,
        MODEL_PROTOCOL: "anthropic-messages",
        MODEL_KEY: "test-key",
        NEW_AGENT_USD: "2.50",
      };

      const out = await makePlan({ env, argv });
      assert.equal(out.code, 0, out.reply);
      const plan = JSON.parse(readFileSync(join(d.job, "out", "plan.json"), "utf8"));
      assert.equal(plan.estimate.new_agent_usd, 1.5, "a NEW_AGENT_USD in the environment changes nothing");
      assert.deepEqual(checkDelivered(d.job), []);
    });
  } finally {
    await standIn.close();
  }
});
