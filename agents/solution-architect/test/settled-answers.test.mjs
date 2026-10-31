// Answers a build has already settled (technical debt 641): when whoever
// starts the job has an answer, the platform's own spending rules, the
// account's limits or the build's settled defaults, the architect uses it and
// records where it came from instead of asking, never contradicts it, and
// says where it would have chosen otherwise as a note and not a binding. It
// asks only what nobody else can answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord, questionsIn } from "../scripts/architecture-record.mjs";
import { kindOf, readingOf } from "../scripts/asked.mjs";
import { requestParts } from "../scripts/name.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { BUILD_WORDS, ROOT, answerFile, fixture, readJson, runJob, workspace } from "./helpers.mjs";

const SETTLED = fixture("build-settled.json");
const SETTLED_KIND = "application/vnd.agentmesh.settled-answers+json";
const countWords = fixture("count-words.answer.json");

const buildJob = (ws, opts = {}) => runJob({ ws, text: BUILD_WORDS, files: [[SETTLED, SETTLED_KIND]], answers: [countWords], ...opts });

test("the build's settled answers are told apart from a stack, the defaults and the statement", () => {
  assert.equal(kindOf(readFileSync(SETTLED, "utf8")), "the build's settled answers");
  const r = readingOf({ text: BUILD_WORDS, files: [{ path: SETTLED, media_type: SETTLED_KIND }] });
  assert.equal(r.settled.by, "AgentMesh Build an agent");
  assert.deepEqual(r.settled.answers.map((a) => a.key), ["kind", "reaches", "model", "limit-cost", "attended"]);
  assert.equal(r.settled_from, "build-settled.json");
  assert.doesNotMatch(r.statement, /settled_answers/, "the settled answers are not part of the statement");
  assert.match(r.statement, /^what it should do: "Count the words/);
});

test("the model is told what the build settled, and not to ask about it or contradict it", () => {
  const asked = readingOf({ text: BUILD_WORDS, files: [{ path: SETTLED, media_type: SETTLED_KIND }] });
  const prompt = requestParts({ asked }).join("\n\n");
  assert.match(prompt, /--- WHAT THE BUILD HAS ALREADY SETTLED ---/);
  for (const key of ["kind", "reaches", "model", "limit-cost", "attended"]) assert.match(prompt, new RegExp(`^- ${key}: `, "m"));
  assert.match(prompt, /do not ask about/i);
  assert.match(prompt, /never contradict/i);
  assert.match(prompt, /name no model system/i);
});

test("a Build an agent request: no question the build answers, no model system, the spending limit with its source", () => {
  const ws = workspace();
  const r = buildJob(ws);
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps));
  const h = parseRecord(r.record);
  assert.deepEqual(questionsIn(r.record), [], r.record);
  assert.equal(h.done, true, r.record);
  assert.deepEqual(h.systems, [], "the build settles the model door, so no model system is named or bound");
  assert.match(r.record, /^bindings: none$/m);
  assert.match(r.record, /^- \*\*Cost\*\*: the account's daily model allowance on AgentMesh's model door, 0\.50 USD a day, which AgentMesh pays\. Settled by AgentMesh Build an agent, from the platform's spending rules\.$/m);
  assert.match(r.record, /^### Decision \d+\. Limit what the agent spends to the account's daily model allowance/m);
  assert.match(r.record, /^### Decision \d+\. Reach a model only through AgentMesh's model door, and name no model system$/m);
  assert.match(r.record, /^### Decision \d+\. The agent reaches nothing outside AgentMesh$/m);
  assert.match(r.record, /^\*\*plugin-on-harness\*\*: AgentMesh Build an agent settled it \(the build's settled defaults\)/m);
  assert.ok(!existsSync(join(r.job, "out", "still-open.md")), "nothing is open, so nothing is delivered as open");
  assert.deepEqual(readJson(join(r.job, "pieces.json")).map((p) => p.name), ["the architecture record"]);
  assert.deepEqual(checkDelivered(r.job), []);
  assert.match(r.reply, /The record is finished/);
});

test("where the architect would have chosen otherwise, it says so as a note, never as a binding or a question", () => {
  const ws = workspace();
  const r = buildJob(ws);
  const h = parseRecord(r.record);
  assert.ok(!h.systems.includes("text-reasoning"));
  assert.doesNotMatch(r.record, /^ {2}text-reasoning:/m, "no binding for text-reasoning in the header");
  assert.doesNotMatch(r.record, /^\| text-reasoning \|/m, "no binding for text-reasoning in the table");
  assert.match(r.record, /^Weighed: Naming and binding text-reasoning \(for text: reading a short untidy text\), which I would have chosen for this job: the build's settled answer stands, so this is a note and not a binding\.$/m);
  assert.match(r.record, /^Weighed: Reaching a public dictionary service, which I would have asked about: the build's settled answer stands, so this is a note and not a question\.$/m);
  assert.doesNotMatch(r.record, /egress-\d+/, "the destination beyond the derived set is not asked");
  assert.match(r.record, /None beyond the derived set/);
  const named = readJson(join(r.records, "named.json"));
  assert.deepEqual(named.settled.used, ["kind", "reaches", "model", "limit-cost", "attended"]);
  assert.equal(named.settled.differs.length, 3, JSON.stringify(named.settled.differs));
  assert.match(r.reply, /Settled by AgentMesh Build an agent and taken as given/);
  assert.match(r.reply, /Where I would have chosen otherwise, the build's answer stands, as a note and not a binding: .*text-reasoning/);
});

test("nobody attends a job, so a question about a person reviewing the result is answered by the build", () => {
  const ws = workspace();
  const r = buildJob(ws);
  assert.doesNotMatch(r.record, /^- review: /m);
  assert.match(r.record, /^### Decision \d+\. Nobody attends a job: the agent answers whoever asked, with no person reviewing in between$/m);
  assert.match(r.record, /^Weighed: Asking "Should a person review the count before it goes back to whoever asked\?", which the build's settled answer answers\.$/m);
});

test("a question nobody else can answer is still asked, and it is the only one", () => {
  const ws = workspace();
  const doc = readJson(countWords);
  doc.questions.push({ key: "hyphenated-words", question: "Does a hyphenated word count as one word or two?" });
  const r = buildJob(ws, { answers: [answerFile(ws, "hyphen", doc)] });
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps));
  assert.deepEqual(questionsIn(r.record).map((q) => q.key), ["hyphenated-words"]);
  assert.equal(parseRecord(r.record).done, false);
  assert.match(r.reply, /One thing is still open/);
});

test("a revision with the settled answers attached again keeps them, and answers the one real question", () => {
  const ws = workspace();
  const doc = readJson(countWords);
  doc.questions.push({ key: "hyphenated-words", question: "Does a hyphenated word count as one word or two?" });
  const answer = answerFile(ws, "hyphen", doc);
  const first = buildJob(ws, { name: "a", answers: [answer] });
  const revised = readJson(countWords);
  revised.decisions.push({ decided: "Count a hyphenated word as one word", why: "The person said so in an answer (hyphenated-words: one)." });
  const second = runJob({
    ws, name: "b", text: "hyphenated-words: one",
    files: [[join(first.job, "out", "architecture-record.md"), "text/markdown"], [SETTLED, SETTLED_KIND]],
    answers: [answerFile(ws, "revised", revised)],
  });
  assert.equal(second.steps.check.status, 0, JSON.stringify(second.steps));
  const h = parseRecord(second.record);
  assert.equal(h.done, true, second.record);
  assert.deepEqual(h.systems, []);
  assert.match(second.record, /\*\*Cost\*\*: the account's daily model allowance/);
});

test("without settled answers nothing changes: a spending limit nobody stated is still asked", () => {
  const ws = workspace();
  const r = runJob({ ws, text: BUILD_WORDS, answers: [countWords] });
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps));
  const keys = questionsIn(r.record).map((q) => q.key);
  assert.ok(keys.includes("limit-cost"), keys.join(","));
  assert.ok(keys.includes("egress-1"), keys.join(","));
  assert.deepEqual(parseRecord(r.record).systems, ["text-reasoning"]);
  assert.equal(readJson(join(r.records, "named.json")).settled, null);
});

test("a settled answer this record has no place for is kept in the records and changes nothing", () => {
  const ws = workspace();
  const doc = readJson(SETTLED);
  doc.answers.push({ key: "colour", answer: "blue", from: "the build's settled defaults" });
  const p = answerFile(ws, "settled-extra", doc);
  const r = runJob({ ws, text: BUILD_WORDS, files: [[p, SETTLED_KIND]], answers: [countWords] });
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps));
  assert.deepEqual(readJson(join(r.records, "named.json")).settled.unread, ["colour"]);
  assert.equal(parseRecord(r.record).done, true);
});

test("both offerings declare the build's settled answers, given by an agent, as exact typed data", () => {
  const d = readJson(join(ROOT, "agent-descriptor.json"));
  for (const o of d.offerings) {
    const input = o.inputs.find((i) => i.name === "the build's settled answers");
    assert.ok(input, `${o.id} declares the build's settled answers`);
    assert.equal(input.kind, SETTLED_KIND);
    assert.equal(input.given_by, "agent");
    assert.equal(input.required, false);
  }
  assert.equal(d.agent_version, "0.3.0");
  assert.equal(readJson(join(ROOT, "plugin.json")).version, "0.3.0");
});

test("the architecture standard says a settled answer is used with its source, and the House Stack names no provider", () => {
  const std = readFileSync(join(ROOT, "..", "..", "standards", "architecture-standard.md"), "utf8");
  assert.match(std, /^## 11\. Answers a build has already settled$/m);
  assert.match(std, /records where it came from/);
  assert.match(std, /never the provider or the model behind it/);
});
