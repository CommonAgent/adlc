// One feature's tests (test-writer 0.11.0).
//   node --test test/one-feature.test.mjs
//
// What is pinned: a message with a line "feature: F2" asks for that feature's
// tests alone, as Product Factory asks once each feature of a version is made
// in a run of its own. The spec goes to the model and to the spec rules with
// that feature alone among its features, its interfaces and constraints kept,
// so the scenarios a suite is held to are that feature's and no other's; a
// feature the spec does not hold yet asks for no scenario. The model is told,
// in a section of its own, and each new file is named for the feature, by code
// when the model names it otherwise, while the standard checks keep their
// names. A message naming no feature is asked as before.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptanceFindings, specFindings } from "../scripts/spec-rules.mjs";
import { askForSuite, featureAsked, featureFileName, featureInstruction, requestParts, specForFeature } from "../scripts/write-suite.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = JSON.parse(readFileSync(join(HERE, "fixtures", "spec-v1", "points-reader.spec.json"), "utf8"));
const DECLARED = { name: "points-reader", version: "1.0.0", scripts: ["scripts/read.mjs"], jobs: [] };
const answer = (files) => files.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n");
const F2_ONLY = { path: "test/f2-refusal.test.mjs", text: `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readPoints } from "../scripts/read.mjs";\n\ntest("[F2.A1] the refusal", () => {\n  assert.ok(readPoints);\n});\n` };

test("the feature a message asks for is read from a line of its own, and none is none", () => {
  assert.equal(featureAsked("Write the tests of feature F2 alone.\n\nfeature: F2\n"), "F2");
  assert.equal(featureAsked("feature:F10"), "F10");
  assert.equal(featureAsked("Write the suite for the spec and the agent's files attached.\n"), null);
  assert.equal(featureAsked("[write-the-suite] feature: F2 is mentioned inside a line"), null, "only a line of its own names one");
});

test("the spec for one feature keeps that feature alone, with every interface and constraint; a feature it does not hold gives none", () => {
  const two = specForFeature(SPEC, "F2");
  assert.deepEqual(two.features.map((f) => f.id), ["F2"]);
  assert.deepEqual(two.interfaces, SPEC.interfaces);
  assert.deepEqual(two.constraints, SPEC.constraints);
  assert.equal(specForFeature(SPEC, "F9"), null);
  // The scenarios a suite is held to are that feature's alone.
  assert.ok(acceptanceFindings([F2_ONLY], SPEC).some((x) => /F1\.A1/.test(x)), "the whole spec asks for F1's scenarios too");
  assert.deepEqual(acceptanceFindings([F2_ONLY], two), []);
  assert.ok(!specFindings([F2_ONLY], two).some((x) => /\bF1\b|F1\./.test(x)), "no rule asks for another feature's tests");
});

test("each new file is named for the feature, and the standard checks keep their names", () => {
  assert.equal(featureFileName("test/refusal.test.mjs", "F2"), "test/f2-refusal.test.mjs");
  assert.equal(featureFileName("test/f2-refusal.test.mjs", "F2"), "test/f2-refusal.test.mjs");
  assert.equal(featureFileName("test/F2-refusal.test.mjs", "F2"), "test/F2-refusal.test.mjs", "named for it already, in either case");
  assert.equal(featureFileName("test/f2.test.mjs", "F2"), "test/f2.test.mjs");
  assert.equal(featureFileName("test/kept-interfaces.test.mjs", "F2"), "test/kept-interfaces.test.mjs");
  assert.equal(featureFileName("test/delivered-formats.test.mjs", "F2"), "test/delivered-formats.test.mjs");
});

test("the model is told, in a section of its own after the spec, to write that feature's tests alone; without a feature the request is as it was", () => {
  const joined = requestParts({ spec: { name: "points-reader" }, specV1: specForFeature(SPEC, "F2"), declared: DECLARED, asked: "feature: F2", feature: "F2" }).join("\n");
  const at = (s) => { const i = joined.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("--- THE SPEC ---") < at(`--- ONE FEATURE ---\n${featureInstruction("F2")}`));
  assert.match(featureInstruction("F2"), /write tests for F2 and for nothing else/);
  assert.match(featureInstruction("F2"), /test\/f2-<what it checks>\.test\.mjs/);
  assert.match(featureInstruction("F3", false), /which the spec does not hold yet: WHAT THEY ASKED FOR describes it/);
  assert.doesNotMatch(requestParts({ spec: { name: "points-reader" }, specV1: SPEC, declared: DECLARED }).join("\n"), /ONE FEATURE/);
});

test("a feature the spec does not hold yet is not held to the spec's scenarios", async () => {
  const sent = [];
  const out = await askForSuite({
    spec: { name: "points-reader" }, declared: DECLARED, specV1: SPEC, feature: "F3", featureInSpec: false, specRules: false,
    asked: "Write the tests of feature F3 alone.\n\nfeature: F3\n\n- F3 (offering Read): Totals. Adds the points up.",
    call: async (request) => { sent.push(request); return answer([{ ...F2_ONLY, path: "test/f3-totals.test.mjs", text: F2_ONLY.text.replace("[F2.A1] the refusal", "[F3] totals") }]); },
    run: async () => ({ tests: 1, pass: 0, fail: 1, status: 1, fails: true }),
  });
  // The suite's own rules still hold it (a thin file goes back once), and none of them is the spec's scenarios.
  const said = sent.map((r) => r.body.contents[0].parts.map((p) => p.text).join("\n")).join("\n");
  assert.doesNotMatch(said, /no test is named for the acceptance scenario/);
  assert.ok(!out.findings.some((x) => /acceptance scenario/.test(x)), out.findings.join("\n"));
});
