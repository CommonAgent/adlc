// The trial cases (Common Agent 7.7, Conformance) and their runner.
//   node --test fleet-manager/agenteval/test/
//
// The cases are made from the conformance fixture's own declarations
// (conformance/trial.json), the runner is driven against a fake node that
// applies 7.7's admission in order, and then against nodes that get one thing
// wrong each, so every verdict is shown failing for the reason it should.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  descriptorTrialCases, judgeTrialCase, measurableLimit, requesterDayRequests, trialCases, CASE_BUDGET,
} from "../trial-cases.mjs";
import { runTrialCases, unsentCases } from "../trial-check.mjs";
import { withTrials } from "../role-check.mjs";
import { validateTrial } from "../../package-maker/shared/trial.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "trial.json"), "utf8"));
const EXPLAINER = FIXTURE.declarations.valid.find((d) => d.case === "explainer").trial;
const NOW = new Date("2026-10-05T03:00:00.000Z");
const QUOTE = { amount_micros: 5000000, currency: "USD", words: "$5.00 as an ordinary request" };

const offering = (trial, extra = {}) => ({
  id: "make-an-explainer", name: "Make an explainer",
  inputs: [{ name: "brief", kind: "text", required: true }, { name: "focus", kind: "text" }, { name: "customer web address", kind: "url" }],
  outputs: [{ name: "explainer page", kind: "text/html" }, { name: "thumbnail", kind: "image/png" }],
  trial, ...extra,
});
const descriptor = (...offerings) => ({ format: "agent-descriptor-v1", offerings });

/** A node that applies 7.7's admission in order; `wrong` names one thing it
 *  gets wrong. Answers the trial door's shapes (docs/trials-plan.md). */
function fakeNode(trial, wrong = {}) {
  let admitted = 0;
  const sent = [];
  const refuse = (details, extra = {}) => ({ status: 403, ms: 40, body: {
    code: "TRIAL_REFUSED", message: "refused", ...extra,
    details: { ...details, ...(wrong.noQuote ? {} : { quote: QUOTE }) } } });
  const admit = () => { admitted++; return { status: 202, ms: 40, body: { trial: { id: `trl_${admitted}`, state: "working" } } }; };
  const send = async (offeringId, request) => {
    sent.push({ offeringId, request });
    if (wrong.notEligible) return refuse({ reason: "not_eligible" });
    if (request.budget && !wrong.admitBudget) return refuse({ reason: "budget" });
    const countsFirst = () => (trial.limits.per_requester_per_day !== undefined && admitted >= trial.limits.per_requester_per_day
      ? refuse({ reason: "requester_day", limit: trial.limits.per_requester_per_day, ...(wrong.noResetsAt ? {} : { resets_at: "2026-10-06T00:00:00.000Z" }) }) : null);
    if (wrong.countsBeforeInputs) { const r = countsFirst(); if (r) return r; }
    if (!wrong.admitOverLimit) {
      for (const e of trial.shape?.inputs ?? []) {
        const v = request.inputs?.[e.name];
        if (typeof v === "string" && e.limit.max_chars !== undefined && [...v].length > e.limit.max_chars) {
          return wrong.afterWork ? refuse({ reason: "input", input: e.name }, { trial: { id: "trl_x", state: "failed" } }) : refuse({ reason: "input", input: e.name, max: e.limit });
        }
      }
    }
    if (!wrong.neverCounts) { const r = countsFirst(); if (r) return r; }
    return admit();
  };
  return { send, sent, admittedCount: () => admitted };
}

const run = (trial, wrong) => {
  const node = fakeNode(trial, wrong);
  return runTrialCases(descriptor(offering(trial)), node.send, { now: () => NOW }).then((cases) => ({ cases, node }));
};
const byCase = (cases) => Object.fromEntries(cases.map((c) => [c.id.split("/").pop(), c]));

test("the fixture's explainer trial makes the three cases, each sized from the declaration", () => {
  assert.equal(validateTrial(EXPLAINER, offering(EXPLAINER)), null);
  const cases = trialCases(offering(EXPLAINER));
  assert.deepEqual(cases.map((c) => c.case), ["input", "budget", "requester_day"]);
  const [input, budget, day] = cases;
  assert.equal(input.input, "focus");
  assert.equal(input.request.inputs.focus.length, 501, "one character over max_chars 500");
  assert.equal(input.request.inputs.brief, "example", "the required input is sent, inside its limit");
  assert.deepEqual(budget.request.budget, CASE_BUDGET);
  assert.equal(day.per_day, 2);
  assert.ok(cases.every((c) => c.kind === "trial"));
});

test("only offerings whose trial validates get cases; a trial with no count gets none", () => {
  const noCount = { who: "anyone", limits: {} };
  assert.equal(descriptorTrialCases(descriptor(offering(noCount))).length, 0);
  assert.equal(descriptorTrialCases(descriptor({ id: "plain", name: "Plain" })).length, 0);
  assert.equal(descriptorTrialCases(descriptor(offering(EXPLAINER), { ...offering(EXPLAINER), id: "second" })).length, 6);
});

test("an offering with no measurable input limit is inconclusive, never passed", async () => {
  const pagesOnly = { who: "signed_in", shape: { inputs: [{ name: "customer web address", limit: { max_pages: 10 } }] }, limits: { per_requester_per_day: 2 } };
  assert.equal(measurableLimit(offering(pagesOnly)), null);
  const { cases } = await run(pagesOnly);
  const c = byCase(cases);
  assert.equal(c["trial-input"].verdict, "inconclusive");
  assert.match(c["trial-input"].observed, /no limit a node can measure/);
  assert.equal(c["trial-budget"].verdict, "pass");
  assert.equal(c["trial-requester-day"].verdict, "pass");
});

test("a trial with no per_requester_per_day has an inconclusive day case and nothing is sent for it", async () => {
  const perDayOnly = { who: "anyone", shape: { inputs: [{ name: "focus", limit: { max_chars: 10 } }] }, limits: { per_day: 50 } };
  const { cases, node } = await run(perDayOnly);
  assert.equal(byCase(cases)["trial-requester-day"].verdict, "inconclusive");
  assert.equal(node.sent.length, 2, "only the input and budget cases were sent");
});

test("a node that applies 7.7 passes all three, and no more than per_requester_per_day + 1 trials are asked for", async () => {
  const { cases, node } = await run(EXPLAINER);
  for (const c of cases) assert.equal(c.verdict, "pass", `${c.id}: ${c.observed}`);
  assert.equal(node.admittedCount(), 2, "the day case's two admitted trials, and no other");
  assert.equal(node.sent.length, 2 + 3);
  assert.match(byCase(cases)["trial-requester-day"].observed, /resets_at 2026-10-06T00:00:00.000Z/);
});

test("every refusal must carry a quote", async () => {
  const { cases } = await run(EXPLAINER, { noQuote: true });
  for (const c of cases) {
    assert.equal(c.verdict, "fail", c.id);
    assert.match(c.observed, /without a quote/);
  }
});

test("a budget admitted, an over-limit input admitted: both fail, and the day case shrinks so the total stays bounded", async () => {
  const { cases, node } = await run(EXPLAINER, { admitBudget: true, admitOverLimit: true });
  const c = byCase(cases);
  assert.equal(c["trial-input"].verdict, "fail");
  assert.match(c["trial-input"].observed, /admitted a trial whose focus is over/);
  assert.equal(c["trial-budget"].verdict, "fail");
  assert.equal(requesterDayRequests(2, 2), 1);
  assert.ok(node.admittedCount() <= 3, `admitted ${node.admittedCount()}, more than per_requester_per_day + 1`);
  assert.equal(c["trial-requester-day"].verdict, "pass", "the two wrongly admitted trials used the day; the next was refused");
});

test("a node that never counts fails the day case after per_requester_per_day + 1 admitted, and stops there", async () => {
  const { cases, node } = await run(EXPLAINER, { neverCounts: true });
  const c = byCase(cases)["trial-requester-day"];
  assert.equal(c.verdict, "fail");
  assert.match(c.observed, /admitted 3 trials from one requester in one day/);
  assert.equal(node.admittedCount(), 3);
});

test("a requester_day refusal with no resets_at fails", async () => {
  const { cases } = await run(EXPLAINER, { noResetsAt: true });
  assert.match(byCase(cases)["trial-requester-day"].observed, /no resets_at/);
  assert.equal(byCase(cases)["trial-requester-day"].verdict, "fail");
});

test("a refusal that comes after the work started fails", async () => {
  const { cases } = await run(EXPLAINER, { afterWork: true });
  assert.equal(byCase(cases)["trial-input"].verdict, "fail");
  assert.match(byCase(cases)["trial-input"].observed, /after the work had started/);
});

test("a node that reads counts before inputs fails the input case once the day is used", async () => {
  const node = fakeNode(EXPLAINER, { countsBeforeInputs: true });
  // Two trials already used today by this requester.
  await node.send("make-an-explainer", { inputs: { brief: "x" } });
  await node.send("make-an-explainer", { inputs: { brief: "x" } });
  const [input] = await runTrialCases(descriptor(offering(EXPLAINER)), node.send, { now: () => NOW });
  assert.equal(input.verdict, "fail");
  assert.match(input.observed, /refused for requester_day; an input over its trial limit is refused before any count/);
});

test("an evaluator the trial does not admit is inconclusive on every case", async () => {
  const { cases } = await run(EXPLAINER, { notEligible: true });
  for (const c of cases) assert.equal(c.verdict, "inconclusive", c.id);
});

test("a door that is not there, or no answer, is inconclusive", () => {
  const [input] = trialCases(offering(EXPLAINER));
  assert.equal(judgeTrialCase(input, [{ status: 404, body: { message: "not found" }, ms: 10 }]).verdict, "inconclusive");
  assert.equal(judgeTrialCase(input, [null]).verdict, "inconclusive");
  assert.equal(judgeTrialCase(input, []).verdict, "inconclusive");
});

test("with no token nothing is sent, and every case says so", () => {
  const cases = unsentCases(descriptor(offering(EXPLAINER)), "not sent: no front-door token");
  assert.equal(cases.length, 3);
  assert.ok(cases.every((c) => c.verdict === "inconclusive" && c.kind === "trial"));
});

test("the role check's verdict folds the trial cases in and never rounds up", () => {
  assert.equal(withTrials("conforms", []), "conforms");
  assert.equal(withTrials("conforms", [{ verdict: "pass" }]), "conforms");
  assert.equal(withTrials("conforms", [{ verdict: "pass" }, { verdict: "inconclusive" }]), "inconclusive");
  assert.equal(withTrials("conforms", [{ verdict: "fail" }]), "does-not-conform");
  assert.equal(withTrials("inconclusive", [{ verdict: "fail" }]), "does-not-conform");
  assert.equal(withTrials("does-not-conform", [{ verdict: "pass" }]), "does-not-conform");
});

test("the shared rules refuse exactly the fixture's invalid declarations", () => {
  const o = FIXTURE.offering;
  for (const d of FIXTURE.declarations.valid) assert.equal(validateTrial(d.trial, o), null, d.case);
  for (const d of FIXTURE.declarations.invalid) assert.notEqual(validateTrial(d.trial, o), null, d.case);
});
