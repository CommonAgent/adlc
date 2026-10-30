// The model gateway in a worker job (Common Agent 0.39.0, 12.4.1): the
// entrypoint starts the host's gateway on the loopback port MODEL_ENDPOINT
// names when the deployment placed the gateway's settings, keeps those
// settings from the work, and counts calls through the gateway the way it
// counts calls to Google's own hosts.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatewayPlan, readTapLog, usageOf, usageTapSource } from "../one-message.mjs";
import { gatewaySource, hasModelSystem } from "../emit-image.mjs";

const GATEWAY = { endpoint: "http://127.0.0.1:8788", model: "claude-sonnet-5-5" };
const ANSWER = { type: "message", model: "claude-sonnet-5-5", content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 40, output_tokens: 7 } };

test("a call through the model gateway is a model call, named by the model that answered", () => {
  const u = usageOf("http://127.0.0.1:8788/v1/messages", JSON.stringify(ANSWER), GATEWAY);
  assert.deepEqual(u, { model: "claude-sonnet-5-5", input: 40, output: 7, cache_write: 0, cache_read: 0 });
});

test("a gateway answer that names no model is named by MODEL_NAME, and another loopback address is not counted", () => {
  const { model, ...rest } = ANSWER;
  assert.equal(usageOf("http://127.0.0.1:8788/v1/messages", JSON.stringify(rest), GATEWAY).model, "claude-sonnet-5-5");
  assert.equal(usageOf("http://127.0.0.1:9999/v1/messages", JSON.stringify(ANSWER), GATEWAY), null);
  assert.equal(usageOf("http://127.0.0.1:8788/v1/messages", JSON.stringify(ANSWER)), null);
});

test("the tap counts a call to MODEL_ENDPOINT", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tap-gw-"));
  const log = join(dir, "calls.jsonl");
  writeFileSync(log, "");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(ANSWER));
  process.env.MESH_USAGE_LOG = log;
  process.env.MODEL_ENDPOINT = "http://127.0.0.1:8788/";
  process.env.MODEL_NAME = "claude-sonnet-5-5";
  try {
    await import(`data:text/javascript,${encodeURIComponent(usageTapSource())}#gw`);
    const got = await (await fetch("http://127.0.0.1:8788/v1/messages", { method: "POST", body: "{}" })).json();
    assert.deepEqual(got, ANSWER);
    const calls = readTapLog(log);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "claude-sonnet-5-5");
    assert.equal(calls[0].output, 7);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.MESH_USAGE_LOG;
    delete process.env.MODEL_ENDPOINT;
    delete process.env.MODEL_NAME;
  }
});

test("the gateway starts only with its settings placed, a loopback endpoint and its file in the image", () => {
  const env = { BRIDGE_VERTEX_PROJECT: "p", MODEL_ENDPOINT: "http://127.0.0.1:8788" };
  const yes = () => true;
  assert.deepEqual(gatewayPlan(env, { exists: yes, dir: "/opt/agent" }), { port: 8788, file: join("/opt/agent", "model-gateway.mjs") });
  assert.equal(gatewayPlan({ MODEL_ENDPOINT: env.MODEL_ENDPOINT }, { exists: yes }), null);
  assert.equal(gatewayPlan({ ...env, MODEL_ENDPOINT: "https://models.example.com" }, { exists: yes }), null);
  assert.equal(gatewayPlan(env, { exists: () => false }), null);
});

test("an image of a package with a model system carries the gateway", () => {
  assert.equal(hasModelSystem({ systems: [{ name: "text-reasoning", kind: "model", protocols: ["anthropic-messages"] }] }), true);
  assert.equal(hasModelSystem({ systems: [{ name: "x", kind: "service" }] }), false);
  assert.match(gatewaySource(), /\/v1\/messages/);
});

test("a gemini call through the gateway is counted, named by the model that answered", () => {
  const answer = { candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 6 }, modelVersion: "gemini-3.8-flash" };
  const u = usageOf("http://127.0.0.1:8788/models/gemini-3.8-flash:generateContent", JSON.stringify(answer), { endpoint: "http://127.0.0.1:8788", model: "gemini-3.8-flash" });
  assert.deepEqual(u, { model: "gemini-3.8-flash", input: 30, output: 10, cache_write: 0, cache_read: 0 });
});

test("a Speech-to-Text v2 call through the gateway is counted by its billed seconds", () => {
  const gw = { endpoint: "", stt: "http://127.0.0.1:8788", model: "" };
  const u = usageOf("http://127.0.0.1:8788/v2/projects/p/locations/us/recognizers/_:recognize", JSON.stringify({ results: [], metadata: { totalBilledDuration: "90s" } }), gw);
  assert.equal(u.model, "google-speech-v2");
  assert.equal(u.seconds, 90);
  assert.equal(u.cost, 0.024);
  assert.equal(usageOf("http://127.0.0.1:8788/v2/projects/p/locations/us/recognizers/_:recognize", "{}", gw), null);
});

test("the gateway starts for a job whose only gateway setting is STT_ENDPOINT", () => {
  const plan = gatewayPlan({ BRIDGE_VERTEX_PROJECT: "p", STT_ENDPOINT: "http://127.0.0.1:8788" }, { exists: () => true, dir: "/opt/agent" });
  assert.equal(plan.port, 8788);
});
