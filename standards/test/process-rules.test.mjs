// The process rules the reviewers hold a process document to
// (process-rules.mjs): the four tests of Agent Processes 0.9.2 §20.1 where a
// program can see them, which phases a person signs and whether the document
// says why, which phases act in the world (§21.3) and whether a person signs
// before each, and no line outside the extensions: block (§20.3). The code
// critic and the security reviewer each carry this file byte for byte.
//   node --test standards/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewProcess, actsHow, RULES } from "../process-rules.mjs";
import { shapeDigestOf } from "../process-check.mjs";
import { GOOD } from "./fixtures.mjs";

const rules = (r) => r.findings.map((f) => f.rule);
const swap = (from, to) => { assert.ok(GOOD.includes(from), `the fixture has no ${from}`); return GOOD.replace(from, to); };

test("a document whose acting phase a person signs right before, and whose gate says why, has no findings", () => {
  const r = reviewProcess(GOOD);
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
  assert.equal(r.document.id, "research/explore-a-topic");
  assert.equal(r.digest, shapeDigestOf(GOOD));
  assert.deepEqual(r.acts.map((a) => [a.phase, a.how, a.gated, a.by]), [["publish-the-cards", "publishes", true, "approve-the-cards"]]);
  assert.deepEqual(r.signs.map((s) => [s.phase, s.automation, s.justified]), [["approve-the-cards", "never", true]]);
});

test("§21.3: a phase that posts publicly with no person signing before it is a finding", () => {
  const ungated = swap("after: approve-the-cards   automation: autonomous", "after: write-the-cards   automation: autonomous")
    .replace("approved cards published to the team's\n                      page", "cards posted publicly on the company's\n                      account");
  const r = reviewProcess(ungated);
  const f = r.findings.find((x) => x.rule === "acts-in-the-world");
  assert.ok(f, JSON.stringify(r.findings));
  assert.equal(f.phase, "publish-the-cards");
  assert.match(f.claim, /posts/);
  assert.match(f.claim, /no person signs before it/);
  assert.match(f.consequence, /nobody having said yes/);
  assert.ok(f.line > 0);
  assert.equal(r.acts.find((a) => a.phase === "publish-the-cards").gated, false);
});

test("a phase that acts in the world is gated by its own level when a person approves or acts there", () => {
  const supervised = swap("after: approve-the-cards   automation: autonomous", "after: write-the-cards   automation: supervised");
  assert.equal(reviewProcess(supervised).acts.find((a) => a.phase === "publish-the-cards").gated, true);
  assert.ok(!rules(reviewProcess(supervised)).includes("acts-in-the-world"));
});

test("what acts in the world: sends outside, posts or publishes, pays, signs; calling a model does not", () => {
  assert.equal(actsHow("the approved cards published to the team's page"), "publishes");
  assert.equal(actsHow("the summary posted to the company's X account"), "posts");
  assert.equal(actsHow("an email sent to each customer"), "sends");
  assert.equal(actsHow("the invoice paid from the operating account"), "pays");
  assert.equal(actsHow("the contract signed on the organization's behalf"), "signs");
  assert.equal(actsHow("five cards, one per angle, each with a source"), null);
  assert.equal(actsHow("a draft written by the model"), null);
  // Things read, and records signed with a key, are not acts in the world.
  assert.equal(actsHow("an extract of recent posts and updates from three blogs"), null);
  assert.equal(actsHow("Reads the post on X and the thread under it."), null);
  assert.equal(actsHow("the signed build record that pins the document by digest"), null);
  assert.equal(actsHow("the process may be listed in the catalog as a process entry"), "publishes");
});

test("approval levels: a gate whose words give no reason and after which nothing acts is a finding", () => {
  const extra = swap("  publish-the-cards - system:", `  second-look       - human: the editor looks once more
                      owner: editor (person)
                      after: write-the-cards   automation: never
  publish-the-cards - system:`).replace("after: approve-the-cards   automation: autonomous", "after: approve-the-cards + second-look   automation: autonomous");
  const r = reviewProcess(extra);
  // second-look sits before publish-the-cards, so it is justified like approve-the-cards.
  assert.ok(r.signs.every((s) => s.justified), JSON.stringify(r.signs));
  const idle = GOOD.replace("  publish-the-cards - system: the approved cards published to the team's\n                      page", "  publish-the-cards - system: the approved cards filed in the archive")
    .replace("  approve-the-cards - human: the editor reads the cards and approves\n                      them, asks for changes, or rejects them", "  approve-the-cards - human: the editor reads the cards")
    .replace("  publish-the-cards -> the team's page: the published cards", "  publish-the-cards -> the archive: the filed cards");
  const r2 = reviewProcess(idle);
  const f = r2.findings.find((x) => x.rule === "approval-level");
  assert.ok(f, JSON.stringify(r2.findings));
  assert.equal(f.phase, "approve-the-cards");
  assert.match(f.claim, /no reason/);
});

test("§20.3: a line outside the extensions: block is a finding, inside it is the extension's own", () => {
  const r = reviewProcess(GOOD.replace("policy:", "price: 5 USD a run\npolicy:"));
  const f = r.findings.find((x) => x.rule === "outside-extensions");
  assert.ok(f);
  assert.match(f.claim, /price: 5 USD a run/);
  assert.equal(reviewProcess(GOOD + "extensions:\n  example.org/ext/price v1\n    price: 5 USD a run\n").findings.length, 0);
});

test("§20.1: the four tests, where a program can see them, each named by the test it fails", () => {
  const twice = swap("         carries: reader - who the result is for, optional", "         carries: topic - again, optional");
  const f1 = reviewProcess(twice).findings.find((x) => x.rule === "four-tests");
  assert.ok(f1);
  assert.match(f1.claim, /test 1/);
  const changes = GOOD + "extensions:\n  example.org/ext/fast v1\n    approve-the-cards: skip on the second run\n";
  const f2 = reviewProcess(changes).findings.find((x) => x.rule === "four-tests");
  assert.ok(f2, "an extension that skips an approval changes the work");
  assert.match(f2.claim, /changes the work/);
  const leftOut = GOOD + "extensions:\n  agentprocesses.ai/ext/start-form v2\n    topic: label \"Topic\"   left-out\n";
  assert.ok(reviewProcess(leftOut).findings.some((x) => x.rule === "four-tests" && /left-out/.test(x.claim)));
});

test("a document that does not conform is reported with each failure, by its section", () => {
  const r = reviewProcess(GOOD.replace(/^concurrency: .*\n.*\n/m, ""));
  assert.ok(r.findings.some((x) => x.rule === "conformance" && /§4/.test(x.claim)));
});

test("every rule has its words", () => {
  for (const k of ["four-tests", "approval-level", "acts-in-the-world", "outside-extensions", "conformance"]) assert.ok(RULES[k], k);
});
