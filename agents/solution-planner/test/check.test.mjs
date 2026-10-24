// Checking the plan is where nothing is believed on the model's word.
//
// What is worth pinning (0.3.0, the Source stage): every step leaves the check
// marked new with no agent and no offering, and an agent or offering the
// model wrote anyway is removed and recorded; every step's needs are read,
// each take and give named once with a kind from the fixed list, an unknown
// kind becoming text with the change recorded; the outputs are the gives;
// every input line is checked against the step's takes, the Start fields and
// the earlier steps' gives, and a line that fails is dropped with a sentence
// in missing; a required take with no line is listed in missing; the schedule
// is validated; the build figures are left for the platform to count after
// Source, with the price of one new agent beside them, and the run figures
// are clamped; a refused plan keeps its sentence and offers no steps.
// Nothing here touches anything: plans are plain values.
// Run: node --test test/check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, KINDS } from "../scripts/check.mjs";

const transcribe = (o = {}) => ({
  id: "s1", title: "Transcribe the episode", status: "new", agent: null, agent_name: "transcriber", offering: null,
  new_agent: { name: "transcriber", does: "Turns the episode into a transcript" },
  needs: { kind: "transcription", takes: [{ name: "episode address", kind: "url", required: true }], gives: [{ name: "transcript", kind: "text" }] },
  inputs: [{ name: "episode address", from: "start.episode" }], outputs: ["transcript"], ...o,
});
const brief = (o = {}) => ({
  id: "s2", title: "Write a brief from the transcript", status: "new", agent: null, agent_name: "briefer", offering: null,
  new_agent: { name: "briefer", does: "Writes a brief" },
  needs: { kind: "writing", takes: [{ name: "transcript", kind: "text", required: true }, { name: "audience", kind: "text", required: false }], gives: [{ name: "brief", kind: "text" }] },
  inputs: [{ name: "transcript", from: "s1.transcript" }], outputs: ["brief"], ...o,
});
const draftOf = (steps, more = {}) => ({
  format: "build-plan-v1", title: "Podcast brief", summary: "Two steps.", refused: null,
  start: [{ name: "episode", kind: "url", value: "", says: "the episode" }],
  steps, schedule: null,
  estimate: { per_run_usd: 0.04, to_build_usd: 9, ready_minutes: 9, run_minutes: 10 },
  cannot: [], missing: [], ...more,
});
const run = (steps, more = {}, extra = {}) => checkPlan({ draft: draftOf(steps, more), ...extra });

test("the kinds are the fixed list the spec names", () => {
  assert.deepEqual(KINDS, ["url", "text", "document", "identifier", "application/json", "text/html", "image", "audio", "video"]);
});

test("a step with its needs and its lines wired is kept as written, new, naming no agent", () => {
  const { plan, changes } = run([transcribe(), brief()]);
  assert.deepEqual(plan.steps.map((s) => [s.status, s.agent, s.offering]), [["new", null, null], ["new", null, null]]);
  assert.deepEqual(plan.steps[0].needs, { kind: "transcription", takes: [{ name: "episode address", kind: "url", required: true }], gives: [{ name: "transcript", kind: "text" }] });
  assert.deepEqual(plan.steps[1].inputs, [{ name: "transcript", from: "s1.transcript" }]);
  assert.deepEqual(changes, { unnamed: [], kinds: [], dropped: [] });
  assert.deepEqual(plan.missing, [], "the audience is optional and nothing else is wanting");
});

test("an agent or offering the model wrote is removed and recorded, however it marked the step", () => {
  for (const status of ["exists", "named", "new"]) {
    const { plan, changes } = run([transcribe({ status, agent: "audio-video-transcriber.platform@agentmesh.ai", offering: "transcribe" })]);
    assert.equal(plan.steps[0].status, "new");
    assert.equal(plan.steps[0].agent, null);
    assert.equal(plan.steps[0].offering, null);
    assert.equal(changes.unnamed.length, 1, status);
    assert.match(changes.unnamed[0].why, /names no agent/);
    assert.match(plan.steps[0].new_agent.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

test("an unknown kind becomes text and the change is recorded; the outputs are the gives", () => {
  const { plan, changes } = run([transcribe({ needs: { kind: "x", takes: [{ name: "episode address", kind: "podcast", required: true }], gives: [{ name: "transcript", kind: "text" }, { name: "words", kind: "TEXT" }] }, outputs: ["something else"] })]);
  assert.deepEqual(plan.steps[0].needs.takes, [{ name: "episode address", kind: "text", required: true }]);
  assert.deepEqual(plan.steps[0].needs.gives, [{ name: "transcript", kind: "text" }, { name: "words", kind: "text" }]);
  assert.deepEqual(changes.kinds.map((k) => [k.step, k.name, k.was]), [["s1", "episode address", "podcast"]]);
  assert.deepEqual(plan.steps[0].outputs, ["transcript", "words"]);
});

test("a line into a name that is not one of the step's takes, or from nowhere real, is dropped with a sentence in missing", () => {
  for (const [line, needle] of [
    [{ name: "colour", from: "start.episode" }, /colour/],
    [{ name: "transcript", from: "start.nothing" }, /no Start field named nothing/],
    [{ name: "transcript", from: "s3.brief" }, /s3 is not an earlier step/],
    [{ name: "transcript", from: "s1.nothing" }, /s1 hands back nothing called nothing/],
  ]) {
    const { plan, changes } = run([transcribe(), brief({ inputs: [line] })]);
    assert.deepEqual(plan.steps[1].inputs, [], JSON.stringify(line));
    assert.equal(changes.dropped.length, 1);
    assert.ok(plan.missing.some((m) => needle.test(m)), `${needle} in ${plan.missing.join(" | ")}`);
  }
});

test("a required take with no line is listed in missing, and an optional one is not", () => {
  const { plan } = run([transcribe(), brief({ inputs: [] })]);
  assert.ok(plan.missing.some((m) => /transcript/.test(m) && /nothing wired/.test(m)));
  assert.ok(!plan.missing.some((m) => /audience/.test(m)));
});

test("a step with no needs at all is kept, with its problem in missing so the catalog's build one is not a surprise", () => {
  const { plan } = run([transcribe({ needs: undefined, inputs: [] })]);
  assert.deepEqual(plan.steps[0].needs, { kind: "", takes: [], gives: [] });
  assert.ok(plan.missing.some((m) => /says nothing about what it takes or hands back/.test(m)));
});

test("the build figures are left for the platform, with the price of one new agent; the run figures are clamped", () => {
  const lied = { per_run_usd: 9, to_build_usd: 99, ready_minutes: 99, run_minutes: 500 };
  const high = run([transcribe()], { estimate: lied }).plan.estimate;
  assert.deepEqual(high, { per_run_usd: 5, to_build_usd: 0, ready_minutes: 1, run_minutes: 120, new_agent_usd: 1.5 });
  const priced = run([transcribe()], {}, { newAgentUsd: 2 }).plan.estimate;
  assert.equal(priced.new_agent_usd, 2);
  const low = run([transcribe()], { estimate: { ...lied, per_run_usd: -3, run_minutes: 0 } }).plan.estimate;
  assert.equal(low.per_run_usd, 0);
  assert.equal(low.run_minutes, 1);
});

test("the checked counts say no candidate was read and nothing was demoted", () => {
  assert.deepEqual(run([transcribe(), brief()]).plan.checked, { candidates: 0, demoted: 0 });
});

test("a valid schedule is kept and one that cannot run is removed", () => {
  const good = { says: "every weekday at seven", repeat: "weekday", day: null, time: "07:00", zone: null };
  assert.deepEqual(run([transcribe()], { schedule: good }).plan.schedule, good);
  assert.equal(run([transcribe()], { schedule: { ...good, repeat: "hourly" } }).plan.schedule, null);
  assert.equal(run([transcribe()], { schedule: { ...good, time: "7am" } }).plan.schedule, null);
});

test("a plan the model refused keeps its sentence and offers no steps", () => {
  const sentence = "It would send messages to people who did not ask for them.";
  const { plan } = run([transcribe(), brief()], { refused: sentence });
  assert.equal(plan.refused, sentence);
  assert.deepEqual(plan.steps, []);
});
