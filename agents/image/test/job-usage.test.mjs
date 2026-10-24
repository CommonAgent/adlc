// What the work cost (tech debt 109): the entrypoint counts a package's model
// calls through the usage tap, reads a harness's own record, and writes
// usage.json in the job folder for the supervisor to send to the Monitor.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelCost, opencodeUsage, readTapLog, usageOf, usageTapSource, watchMemory, writeJobUsage } from "../one-message.mjs";

const VERTEX = "https://aiplatform.us.rep.googleapis.com/v1/projects/p/locations/us/publishers/anthropic/models/claude-sonnet-5-5:rawPredict";

test("a Claude on Vertex answer is read for its usage and model", () => {
  const u = usageOf(VERTEX, JSON.stringify({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 50 } }));
  assert.deepEqual(u, { model: "google-vertex-anthropic/claude-sonnet-5-5", input: 1200, output: 300, cache_write: 0, cache_read: 50 });
});

test("a streamed Claude answer is counted once, at its totals", () => {
  const sse = [
    'event: message_start', 'data: {"type":"message_start","message":{"usage":{"input_tokens":900,"output_tokens":1}}}',
    'event: message_delta', 'data: {"type":"message_delta","usage":{"output_tokens":40}}',
    'event: message_delta', 'data: {"type":"message_delta","usage":{"output_tokens":75}}',
  ].join("\n");
  const u = usageOf(VERTEX.replace("rawPredict", "streamRawPredict"), sse);
  assert.equal(u.input, 900);
  assert.equal(u.output, 75);
});

test("Gemini answers and Vertex's OpenAI-shaped answers are read, and other hosts are not", () => {
  const g = usageOf("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    JSON.stringify({ usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 100, thoughtsTokenCount: 20 } }));
  assert.deepEqual(g, { model: "google/gemini-3.8-flash", input: 500, output: 120, cache_write: 0, cache_read: 0 });
  const o = usageOf("https://aiplatform.googleapis.com/v1/projects/p/locations/global/endpoints/openapi/chat/completions",
    JSON.stringify({ model: "google/gemini-3.8-flash", usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  assert.equal(o.input, 10);
  assert.equal(o.output, 5);
  assert.equal(usageOf("https://models.example.com/api/v1/chat/completions", '{"usage":{"prompt_tokens":5}}'), null);
  assert.equal(usageOf("https://example.com/v1/models/x:rawPredict", '{"usage":{"input_tokens":5}}'), null);
  assert.equal(usageOf(VERTEX, "not json and no usage"), null);
});

test("cost is priced from the table, and an unknown model at the dearest price", () => {
  assert.equal(modelCost("google-vertex-anthropic/claude-sonnet-5-5", { input: 1_000_000, output: 100_000 }), 3.3);
  assert.equal(modelCost("google-vertex-anthropic/claude-sonnet-5-5@default", { input: 1_000_000 }), 2.2);
  assert.equal(modelCost("someone/new-model", { output: 1_000_000 }), 11);
  // Claude Haiku 5.5 (2026-10-08): its own price, and the long-prompt price over 100,000 tokens in.
  assert.equal(modelCost("google-vertex-anthropic/claude-haiku-5-5", { input: 20_000, output: 10_000 }), 0.0077);
  assert.equal(modelCost("google-vertex-anthropic/claude-haiku-5-5", { input: 120_000, output: 10_000 }), 0.0935);
});

test("the tap counts a model call as the package reads it, and changes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tap-"));
  const log = join(dir, "calls.jsonl");
  writeFileSync(log, "");
  const answer = { content: [{ type: "text", text: "hello" }], usage: { input_tokens: 70, output_tokens: 9 } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(String(url).includes("googleapis") ? JSON.stringify(answer) : "plain");
  process.env.MESH_USAGE_LOG = log;
  try {
    await import(`data:text/javascript,${encodeURIComponent(usageTapSource())}`);
    const got = await (await fetch(VERTEX, { method: "POST", body: "{}" })).json();
    assert.deepEqual(got, answer);
    assert.equal(await (await fetch("https://example.com/")).text(), "plain");
    const calls = readTapLog(log);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, 70);
    assert.equal(calls[0].output, 9);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.MESH_USAGE_LOG;
  }
});

test("opencode's own record is read for the messages of this job only", () => {
  const home = mkdtempSync(join(tmpdir(), "oc-"));
  const store = join(home, ".local", "share", "opencode", "storage", "message", "ses_1");
  mkdirSync(store, { recursive: true });
  const msg = (id, created, extra) => writeFileSync(join(store, `${id}.json`), JSON.stringify({ id, role: "assistant", time: { created }, providerID: "google-vertex-anthropic", modelID: "claude-sonnet-5-5@default", ...extra }));
  msg("m1", 1000, { tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 10, write: 0 } }, cost: 0 });
  msg("m0", 10, { tokens: { input: 999, output: 999 }, cost: 1 });
  writeFileSync(join(store, "u1.json"), JSON.stringify({ role: "user", time: { created: 2000 } }));
  const calls = opencodeUsage(home, 500, {});
  assert.deepEqual(calls, [{ model: "google-vertex-anthropic/claude-sonnet-5-5@default", input: 100, output: 55, cache_write: 0, cache_read: 10 }]);
});

test("usage.json sums the calls, names the main model and carries the memory peak", () => {
  const job = mkdtempSync(join(tmpdir(), "job-"));
  const doc = writeJobUsage(job, {
    calls: [{ model: "google-vertex-anthropic/claude-sonnet-5-5", input: 1000, output: 200, cache_write: 0, cache_read: 0 }],
    harness: [{ model: "google-vertex-anthropic/claude-haiku-4-5", input: 10, output: 5, cache_write: 0, cache_read: 0, cost: 0.5 }],
    memMb: 312,
  });
  assert.deepEqual(JSON.parse(readFileSync(join(job, "usage.json"), "utf8")), doc);
  assert.equal(doc.tokens_in, 1010);
  assert.equal(doc.tokens_out, 205);
  assert.equal(doc.cost_usd, Math.round((0.0022 + 0.0022 + 0.5) * 1e8) / 1e8);
  assert.equal(doc.model, "google-vertex-anthropic/claude-sonnet-5-5");
  assert.equal(doc.mem_mb, 312);
});

test("a usage.json the work wrote is kept, and nothing is written when there is nothing to say", () => {
  const job = mkdtempSync(join(tmpdir(), "job-"));
  writeFileSync(join(job, "usage.json"), JSON.stringify({ tokens_in: 5, tokens_out: 6, cost_usd: 0.01 }));
  const doc = writeJobUsage(job, { calls: [{ model: "m", input: 100, output: 100 }], memMb: 64 });
  assert.deepEqual(doc, { tokens_in: 5, tokens_out: 6, cost_usd: 0.01, mem_mb: 64, model: "m" });
  const empty = mkdtempSync(join(tmpdir(), "job-"));
  assert.equal(writeJobUsage(empty, {}), null);
});

test("the memory watch stops and answers a number", () => {
  const w = watchMemory();
  const mb = w.stop();
  assert.equal(typeof mb, "number");
  assert.ok(mb >= 0);
});
