// Keeping and replaying model exchanges under anthropic-messages.
//
// What is worth pinning: model-record.mjs captures the whole exchange; the
// recorded service is anthropic-messages; a saved replay matching the record
// responds without waking the model; weigh.mjs asks for JSON through askJson
// passing the exchange option to model-caller.mjs.
// Nothing here touches a real model: stand-in servers and recorded files supply
// all answers.
// Run: node --test test/model-record.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel } from "../scripts/model-caller.mjs";
import { createExchange, loadExchange, saveExchange } from "../scripts/model-record.mjs";
import { askJson } from "../scripts/weigh.mjs";

const here = dirname(fileURLToPath(import.meta.url));

async function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "model-record-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

test("model record keeps the exchange with service named anthropic-messages", async () => {
  await withTemp(async (dir) => {
    const standIn = await startStandIn((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_record_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: '{"judgments":[]}' }],
        stop_reason: "end_turn",
      }));
    });

    try {
      const exchange = createExchange({ dir });
      const env = {
        MODEL_NAME: "test-model",
        MODEL_ENDPOINT: standIn.endpoint,
        MODEL_PROTOCOL: "anthropic-messages",
      };

      await callModel("weigh these reasons", { env, exchange });
      saveExchange(dir, exchange);

      const saved = loadExchange(dir);
      assert.equal(saved.service, "anthropic-messages");
      assert.ok(saved.request);
      assert.ok(saved.response);
      assert.equal(saved.response.content[0].text, '{"judgments":[]}');
    } finally {
      await standIn.close();
    }
  });
});

test("a saved replay made under anthropic-messages answers without a model call", async () => {
  await withTemp(async (dir) => {
    let modelCalled = 0;
    const standIn = await startStandIn((req, res) => {
      modelCalled += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text: "fresh call" }] }));
    });

    try {
      const savedExchange = {
        service: "anthropic-messages",
        request: { prompt: "weigh these reasons" },
        response: { content: [{ type: "text", text: '{"judgments":[{"id":"r1","holds":"holds"}]}' }] },
      };
      saveExchange(dir, savedExchange);

      const exchange = createExchange({ dir, replay: true });
      const env = {
        MODEL_NAME: "test-model",
        MODEL_ENDPOINT: standIn.endpoint,
        MODEL_PROTOCOL: "anthropic-messages",
      };

      const res = await callModel("weigh these reasons", { env, exchange });
      assert.equal(modelCalled, 0, "the stand-in model was never contacted");
      assert.equal(JSON.parse(res.text).judgments[0].holds, "holds", "the answer is the saved one");
    } finally {
      await standIn.close();
    }
  });
});

test("weigh asks the model once for json through askjson with the exchange option passed", async () => {
  await withTemp(async (dir) => {
    let calls = 0;
    const standIn = await startStandIn(async (req, res) => {
      calls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        content: [{ type: "text", text: '{"judgments":[{"id":"item-1","holds":"holds","says":"valid"}]}' }],
        stop_reason: "end_turn",
      }));
    });

    try {
      const exchange = createExchange({ dir });
      const env = {
        MODEL_NAME: "test-model",
        MODEL_ENDPOINT: standIn.endpoint,
        MODEL_PROTOCOL: "anthropic-messages",
      };

      const result = await askJson({
        prompt: "assess reasons",
        env,
        exchange,
      });

      assert.equal(calls, 1, "askJson called the model exactly once");
      assert.equal(result.judgments[0].holds, "holds");
    } finally {
      await standIn.close();
    }
  });
});
