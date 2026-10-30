// The drafting step never spins: an answer wrapped in prose or a fence is
// read for the object inside it, an answer with no object is asked for once
// more with a "JSON only" reminder and never a third time, and the whole step
// runs inside a time budget, so a job ends in words rather than at the job's
// own time limit (2026-10-28: three of four runs on dev did).
//   node --test test/draft-json.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_SECONDS, JSON_ONLY, NoDraft, answerFrom, askForSpec, callFor, draftRequest, draftSecondsOf, jsonCandidates,
} from "../scripts/draft.mjs";
import { JSON_SYSTEM } from "../scripts/model-caller.mjs";

const ASKED = { asked: "v1", said: "an agent that watches the fleet and says who went quiet", attached: [], missing_files: [] };
const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const GOOD_SPEC = {
  name: "watcher", version: "0.1.0",
  jobs: [{
    slug: "report", title: "Report", offered: true, how,
    when: "when somebody needs to know which agents are answering",
    good: "A report naming every agent, when it last answered, and what it has spent against its declared ceiling, with anything unknown said as unknown.",
    empty: "If the platform will not say when an agent last answered, the report says so for that agent rather than reporting it as quiet.",
    does: "Reads the platform and reports who answered and what they spent.",
  }],
  refuses: Array.from({ length: 4 }, (_, i) => `refusing act ${i}, because it is not this agent's to do, and it says so instead`),
  records: [{ name: "the signed job manifest" }],
  price: { model: "flat", amount_micro: 100000, currency: "USD" },
  systems: [],
};
const answer = (spec = GOOD_SPEC) => JSON.stringify({ spec, blanks: [], notes: "" });
const textOf = (request) => request.body.contents[0].parts.map((p) => p.text).join("\n");

test("an object wrapped in prose, or fenced inside prose, is read", () => {
  const body = answer();
  assert.equal(answerFrom(`Here is the spec you asked for:\n\n${body}\n\nLet me know if anything needs changing.`).spec.name, "watcher");
  assert.equal(answerFrom(`Sure. \`\`\`json\n${body}\n\`\`\` That is all.`).spec.name, "watcher");
  assert.equal(answerFrom("```JSON\n" + body + "\n```").spec.name, "watcher");
});

test("braces inside strings do not end the object", () => {
  const spec = { ...GOOD_SPEC, notes_for_test: "a } and a { and a \" quote" };
  assert.equal(answerFrom(`prose { not json } then ${answer(spec)} trailing`).spec.notes_for_test, "a } and a { and a \" quote");
});

test("a broken object is still not JSON, and says so", () => {
  const broken = answer().replace('"jobs":[', '"jobs":[],');
  assert.throws(() => answerFrom(broken), /did not answer with JSON/);
  assert.ok(jsonCandidates("a {b} c").includes("{b}"));
});

test("an answer that is not JSON is asked for once more, with the reminder", async () => {
  const sent = [];
  const out = await askForSpec({
    asked: ASKED, seconds: 600,
    call: async (request) => { sent.push(textOf(request)); return sent.length === 1 ? "I could not do it all, but here goes: {spec: oops" : answer(); },
  });
  assert.equal(sent.length, 2);
  assert.equal(out.spec.name, "watcher");
  assert.ok(!sent[0].includes("COULD NOT BE READ"));
  assert.match(sent[1], /YOUR LAST ANSWER COULD NOT BE READ/);
  assert.ok(sent[1].includes(JSON_ONLY));
});

test("two answers that are not JSON end the step in words, never a third call", async () => {
  let calls = 0;
  await assert.rejects(
    () => askForSpec({ asked: ASKED, seconds: 600, call: async () => { calls += 1; return "no JSON here"; } }),
    (e) => e instanceof NoDraft && /did not answer with JSON/.test(e.message),
  );
  assert.equal(calls, 2);
});

test("a draft in hand stands when the second go is not JSON", async () => {
  let calls = 0;
  const thin = { ...GOOD_SPEC, refuses: [] };
  const out = await askForSpec({
    asked: ASKED, seconds: 600,
    call: async () => { calls += 1; return calls === 1 ? answer(thin) : "nope"; },
  });
  // go 1 (findings), go 2 not JSON, the one reminder, then not JSON again
  assert.equal(calls, 3);
  assert.equal(out.spec.name, "watcher");
  assert.match(out.findings[0], /at least 4/);
  assert.match(out.stopped, /did not answer with JSON/);
});

test("the most a step ever calls is the two goes and the one reminder", async () => {
  let calls = 0;
  const thin = { ...GOOD_SPEC, refuses: [] };
  await askForSpec({ asked: ASKED, seconds: 600, call: async () => { calls += 1; return calls === 2 ? "nope" : answer(thin); } });
  assert.equal(calls, 3);
});

test("no call starts without a minute left, and each call is given what is left", async () => {
  let t = 0;
  const seen = [];
  const thin = { ...GOOD_SPEC, refuses: [] };
  const out = await askForSpec({
    asked: ASKED, seconds: 100, now: () => t,
    call: async (_request, { seconds }) => { seen.push(seconds); t += 50_000; return answer(thin); },
  });
  // 100 s budget: the first call is given 100, takes 50; 50 left is under a minute, so no second call.
  assert.deepEqual(seen, [100]);
  assert.equal(out.spec.name, "watcher");
  assert.match(out.stopped, /ran out of time/);
});

test("a service that fails before any draft ends the step in words", async () => {
  await assert.rejects(
    () => askForSpec({ asked: ASKED, seconds: 600, call: async () => { throw new Error("the text-reasoning service did not answer within 240 seconds"); } }),
    (e) => e instanceof NoDraft && /within 240 seconds/.test(e.message),
  );
  await assert.rejects(() => askForSpec({ asked: ASKED, seconds: 30, call: async () => answer() }), (e) => e instanceof NoDraft && /ran out of time/.test(e.message));
});

test("the budget is DRAFT_SECONDS when it is a positive number", () => {
  assert.equal(draftSecondsOf({}), DRAFT_SECONDS);
  assert.equal(draftSecondsOf({ DRAFT_SECONDS: "120" }), 120);
  assert.equal(draftSecondsOf({ DRAFT_SECONDS: "-3" }), DRAFT_SECONDS);
  assert.ok(DRAFT_SECONDS <= 300, "the draft step leaves the ten-minute job time for the rest");
});

// The drafting call goes through the shared caller asking for JSON, so each
// protocol's own JSON switch is set: the JSON-only system prompt for the
// declared anthropic-messages, and JSON mode for a Gemini call. A fetchImpl
// stub answers; nothing is sent anywhere.
const stubFetch = (sent, reply) => async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
};

test("the drafting call asks for JSON, and a Gemini call asks for JSON mode", async () => {
  const request = draftRequest({ asked: ASKED });
  const sent = [];
  const env = { MODEL_NAME: "text-model", MODEL_ENDPOINT: "http://127.0.0.1:9", MODEL_PROTOCOL: "anthropic-messages", MODEL_KEY: "" };
  const got = await callFor(env, { fetchImpl: stubFetch(sent, { type: "message", content: [{ type: "text", text: answer() }], stop_reason: "end_turn" }) })(request, { seconds: 60 });
  assert.equal(answerFrom(got.text).spec.name, "watcher");
  assert.ok(String(sent[0].body.system).includes(JSON_SYSTEM), "the declared protocol's call asks for one JSON value");

  const gsent = [];
  const genv = { MODEL_NAME: "text-model", MODEL_ENDPOINT: "http://127.0.0.1:9", MODEL_PROTOCOL: "gemini", MODEL_KEY: "k" };
  await callFor(genv, { protocols: ["gemini"], fetchImpl: stubFetch(gsent, { candidates: [{ content: { parts: [{ text: answer() }] }, finishReason: "STOP" }] }) })(request, { seconds: 60 });
  assert.equal(gsent[0].body.generationConfig.responseMimeType, "application/json");
});
