// The suite is written from the spec (spec-v1) and held to it (test-writer 0.9.0).
//   node --test test/spec-rules.test.mjs
//
// What is pinned, on a made-up spec (test/fixtures/spec-v1/points-reader.spec.json)
// with a pattern, a limit, a wording, a refusal, a constraint, a kept
// function, a kept file with a schema and a kept command:
// - the spec is found among attachments by its format, under any name, and
//   never mistaken for the older spec.json or the agent's files;
// - every acceptance scenario has a test named with its id, "[F1.A1] ...";
// - every exact entry of a requirement verified by test is carried by a test
//   named for its feature: words and patterns byte for byte, numbers as
//   numbers, a time limit in seconds or milliseconds; sample data does not
//   count; a constraint's is looked for in tests named for it, else anywhere;
// - every kept file or message with a schema is held by a test, through
//   checkKept or keptProblems;
// - the checks go back to the model once, as findings, and hold a new suite
//   and one being added to, never a revision;
// - the model gets the spec whole, in its own section, ahead of what the
//   agent's files declare; with no spec the request is as it was;
// - a scenario's id counts for its feature, and names a test in a revision.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptanceFindings, bracketIdsOf, carriesExact, exactFindings, featureOfId, isSpecV1, keptCallFindings, numberOfExact,
  scenariosOf, specFindings, specV1Among, testedRequirements,
} from "../scripts/spec-rules.mjs";
import { featureIdsOf, namedTestsIn, pinFindings, scenarioIdsIn } from "../scripts/suite-rules.mjs";
import { askForSuite, namedForRevision, requestParts, specInstruction, staticFindings } from "../scripts/write-suite.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_TEXT = readFileSync(join(HERE, "fixtures", "spec-v1", "points-reader.spec.json"), "utf8");
const SPEC = JSON.parse(SPEC_TEXT);
const DECLARED = { name: "points-reader", version: "1.0.0", scripts: ["scripts/read.mjs"], jobs: [] };
const answer = (files) => files.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n");

// A suite that keeps the spec: a test per scenario, every exact entry in a
// test of its feature, the kept file held.
const KEEPS = `// read.mjs: titles and their points.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPoints } from "../scripts/read.mjs";
import { checkKept } from "./kept-interfaces.test.mjs";

const POINTS_LINE = /^(\\d+) points?$/;
const LIMIT = 30;

test("[F1.A1] two titles are read with their points, and the reply ends in its fixed words", async () => {
  const got = await readPoints("Alpha\\n12 points\\nBeta\\n1 point", { limit: LIMIT });
  assert.ok(POINTS_LINE.test("12 points"));
  assert.ok(got.reply.endsWith("Read by points-reader."));
  assert.deepEqual(checkKept(got.jobDir, { expect: ["I2"] }), []);
});

test("[F1.A2] a list longer than the limit is read only to the limit", async () => {
  const got = await readPoints("x\\n1 point\\n".repeat(31), { limit: LIMIT });
  assert.equal(got.items.length, LIMIT);
});

test("[F2.A1] a list with no points line is refused in its fixed words", async () => {
  await assert.rejects(readPoints("Alpha\\nBeta", {}), /^Error: No points lines were found\\.$/);
});

test("[C1] one list is read within 10 seconds", async () => {
  const t = Date.now(); await readPoints("a\\n1 point", {}); assert.ok(Date.now() - t < 10000);
});
`;
const FILE = { path: "test/read.test.mjs", text: KEEPS };

test("the spec is found by its format under whatever name it came, and the older spec.json and the agent's files are not it", () => {
  const texts = {
    "/in/0-abcdefgh-job-manifest.json": SPEC_TEXT,
    "/in/1-Ab12cdEF-spec": SPEC_TEXT,
    "/in/2-Ab12cdEF-spec.json": JSON.stringify({ name: "x", version: "1.0.0", jobs: [{ slug: "y" }] }),
    "/in/3-Ab12cdEF-agent-descriptor.json": JSON.stringify({ format: "agent-descriptor-v1", offerings: [] }),
    "/in/4-Ab12cdEF-notes": "not json",
  };
  const files = Object.keys(texts).map((path) => ({ path }));
  assert.equal(specV1Among(files, (p) => texts[p]), "/in/1-Ab12cdEF-spec", "the job manifest is skipped by name, the spec found by content");
  assert.equal(isSpecV1({ format: "spec-v1", features: [] }), false, "a spec with no feature is no spec to write tests from");
  assert.equal(isSpecV1(JSON.parse(texts["/in/2-Ab12cdEF-spec.json"])), false);
  // Two of them: the one whose product version is the agent's own, else the last.
  const older = JSON.stringify({ ...SPEC, product: { ...SPEC.product, version: "0.9.0" } });
  const two = { "/a": SPEC_TEXT, "/b": older };
  assert.equal(specV1Among([{ path: "/a" }, { path: "/b" }], (p) => two[p], { version: "1.0.0" }), "/a");
  assert.equal(specV1Among([{ path: "/a" }, { path: "/b" }], (p) => two[p]), "/b");
  assert.equal(specV1Among([{ path: "/x" }], () => { throw new Error("gone"); }), null);
});

test("the spec is read as its scenarios, the requirements a test verifies, and their exact entries", () => {
  assert.deepEqual(scenariosOf(SPEC).map((s) => [s.id, s.feature, s.title]), [
    ["F1.A1", "F1", "two titles with their points"], ["F1.A2", "F1", "a list longer than the limit"], ["F2.A1", "F2", "a list with no points"]]);
  const r = testedRequirements(SPEC);
  assert.deepEqual(r.map((x) => x.id), ["F1.R1", "F1.R2", "F1.R3", "F2.R1", "C1"], "F1.R4 is verified by inspection and needs no test");
  assert.deepEqual(r.find((x) => x.id === "F1.R1").exact, ["^(\\d+) points?$"]);
  assert.deepEqual(r.find((x) => x.id === "F1.R2").by, ["F1.A2"]);
  assert.equal(r.find((x) => x.id === "C1").feature, null);
});

test("ids in a test's name are read whole, and a scenario's or a requirement's id counts for its feature", () => {
  assert.deepEqual(bracketIdsOf("[F1.A1, F1.A2] reads both"), ["F1.A1", "F1.A2"]);
  assert.deepEqual(bracketIdsOf("[F1.A1] [C1] reads in time"), ["F1.A1", "C1"]);
  assert.deepEqual(bracketIdsOf("reads [F1.A1] late"), [], "only ids the name opens with");
  assert.equal(featureOfId("F12.A3"), "F12");
  assert.equal(featureOfId("C1"), null);
  assert.deepEqual(featureIdsOf("[F1.A2, F3] x"), ["F1", "F3"], "the message's feature check reads a scenario test as its feature's");
  const features = "- F1: Read the points. Up to 30 at a time.";
  assert.deepEqual(pinFindings([FILE], { words: features }), [], "a test named [F1.A2] pins F1's 30");
});

test("a suite that keeps the spec has no finding", () => {
  assert.deepEqual(specFindings([FILE], SPEC), []);
  assert.deepEqual(specFindings([FILE], { format: "spec-v1" }), [], "no spec, no check");
});

test("a scenario no test is named for is a finding naming its id, its title and what it checks", () => {
  const without = { ...FILE, text: KEEPS.replace("[F1.A2] a list longer", "a list longer") };
  const f = acceptanceFindings([without], SPEC);
  assert.equal(f.length, 1);
  assert.match(f[0], /^no test is named for the acceptance scenario F1\.A2 \("a list longer than the limit"\): write at least one test for it, named "\[F1\.A2\] \.\.\."/);
  assert.match(f[0], /that checks F1\.R2$/);
  assert.deepEqual(acceptanceFindings([without, { path: "test/kept-interfaces.test.mjs", text: 'test("[F1.A2] x", () => {});' }], SPEC, { skip: ["test/kept-interfaces.test.mjs"] }).length, 1, "a standard file does not answer for the suite");
});

test("an exact word, pattern or number no test of its feature carries is a finding naming the requirement and the scenario that checks it", () => {
  // The refusal's words paraphrased.
  const paraphrased = { ...FILE, text: KEEPS.replace("/^Error: No points lines were found\\.$/", "/no points/i") };
  const f = exactFindings([paraphrased], SPEC);
  assert.equal(f.length, 1, f.join("\n"));
  assert.match(f[0], /^F2\.R1 fixes "No points lines were found\." exactly, and no test named for F2 carries it: assert it in a test named for F2 \(the test for F2\.A1, which checks F2\.R1\)/);
  // The pattern only in a test of another feature.
  const moved = { ...FILE, text: KEEPS.replace("const POINTS_LINE = /^(\\d+) points?$/;\n", "").replace('assert.ok(POINTS_LINE.test("12 points"));\n', "")
    + 'test("[F2.A1] the pattern is ^(\\\\d+) points?$", () => { assert.ok(readPoints); });\n' };
  assert.match(exactFindings([moved], SPEC).join("\n"), /F1\.R1 fixes "\^\(\\\\d\+\) points\?\$" exactly, and no test named for F1 carries it/);
  // A feature with no test named for it at all.
  const none = { ...FILE, text: KEEPS.replace("[F2.A1] a list", "a list") };
  assert.match(exactFindings([none], SPEC).join("\n"), /F2\.R1 fixes "No points lines were found\." exactly, and no test is named for F2/);
});

test("a pattern may be written as a regular expression literal or as a string, and a number as the number, but sample data pins nothing", () => {
  assert.equal(carriesExact("const P = /^(\\d+) points?$/;", "^(\\d+) points?$"), true, "a regular expression literal");
  assert.equal(carriesExact('const P = new RegExp("^(\\\\d+) points?$");', "^(\\d+) points?$"), true, "the same characters in a string");
  assert.equal(carriesExact("const P = /^\\d+ points$/;", "^(\\d+) points?$"), false, "a different pattern is not the same pattern");
  assert.equal(carriesExact("assert.match(r, /a\\/b/)", "a/b"), true, "a slash escaped in a literal");
  assert.deepEqual([...numberOfExact("10 seconds")].sort(), ["10", "10000"]);
  assert.deepEqual([...numberOfExact("2,000,000")], ["2000000"]);
  assert.deepEqual([...numberOfExact("500 ms")], ["500"]);
  assert.equal(numberOfExact("1 point"), null, "a number with another word after it is words");
  assert.equal(numberOfExact("Read by points-reader."), null);
  // 30 only in a block of sample data does not pin the limit.
  const sample = { ...FILE, text: KEEPS.replace("const LIMIT = 30;", "const ROWS = [\n  { id: 30 },\n];\nconst LIMIT = ROWS.length;") };
  assert.match(exactFindings([sample], SPEC).join("\n"), /F1\.R2 fixes "30" exactly/);
  // A time limit in milliseconds pins one given in seconds.
  assert.deepEqual(exactFindings([FILE], SPEC).filter((x) => /C1/.test(x)), []);
});

test("a constraint is looked for in the tests named for it, and anywhere in the suite when none is", () => {
  const unnamed = { ...FILE, text: KEEPS.replace("[C1] one list", "one list") };
  assert.deepEqual(exactFindings([unnamed], SPEC), [], "no [C1] test: the 10000 anywhere in the suite carries it");
  const elsewhere = { ...FILE, text: KEEPS.replace("[C1] one list is read within 10 seconds", "[C1] one list is read in time").replace("< 10000", "< LIMIT * 100") + 'test("[C1] is quick", () => { assert.ok(readPoints); });\n' };
  assert.match(exactFindings([elsewhere], SPEC).join("\n"), /^C1 fixes "10 seconds" exactly, and no test carries it: assert it in a test named for C1/m);
});

test("a kept file with a schema that no test holds is a finding with the call to make", () => {
  const unheld = { ...FILE, text: KEEPS.replace('  assert.deepEqual(checkKept(got.jobDir, { expect: ["I2"] }), []);\n', "") };
  const f = keptCallFindings([unheld], SPEC);
  assert.equal(f.length, 1);
  assert.match(f[0], /^the spec keeps I2 \(out\/points\.json\) with a JSON Schema, and no test holds what the job writes to it: .*checkKept\(jobDir, \{ expect: \["I2"\] \}\) deep-equals \[\]$/);
  const message = { ...SPEC, interfaces: [{ id: "I9", kind: "message", name: "the reply", keep: true, schema: { type: "string" }, about: "x" }] };
  assert.match(keptCallFindings([FILE], message)[0], /keptProblems\("I9", value\)/);
  assert.deepEqual(keptCallFindings([FILE], { ...SPEC, interfaces: [{ ...SPEC.interfaces[1], keep: false }] }), [], "an interface that may change is not held");
});

test("the static check carries the spec's findings, and the second ask sends them back once", async () => {
  const thin = { ...FILE, text: KEEPS.replace("[F1.A2] a list longer", "a list longer") };
  const f = staticFindings([thin], DECLARED, { specV1: SPEC, specCheck: true });
  assert.ok(f.some((x) => /acceptance scenario F1\.A2/.test(x)), f.join("\n"));
  assert.ok(!staticFindings([thin], DECLARED, { specV1: SPEC }).some((x) => /F1\.A2/.test(x)), "only when asked");
  const sent = [];
  const out = await askForSuite({
    spec: { name: "points-reader" }, declared: DECLARED, specV1: SPEC,
    call: async (request) => { sent.push(request.body.contents[0].parts.map((p) => p.text).join("\n")); return answer([sent.length === 1 ? thin : FILE]); },
    run: async () => ({ tests: 4, pass: 0, fail: 4, status: 1, fails: true }),
  });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /WHAT WAS WRONG WITH YOUR LAST SUITE[\s\S]*no test is named for the acceptance scenario F1\.A2/);
  assert.deepEqual(out.findings, []);
});

test("a revision is not held to the spec: it changes only the tests it names", async () => {
  const thin = { ...FILE, text: KEEPS.replace("[F1.A2] a list longer", "a list longer").replace("Read by points-reader.", "Read by points reader.") };
  const fixed = { ...thin, text: thin.text.replace("Read by points reader.", "Read by points-reader.") };
  const sent = [];
  const out = await askForSuite({
    spec: { name: "points-reader" }, declared: DECLARED, specV1: SPEC, existing: [thin], revise: ["test/read.test.mjs"],
    asked: "Revise the suite.\n\nF1.A1 expects the wrong words.",
    call: async (request) => { sent.push(request); return answer([fixed]); },
    run: async () => ({ tests: 4, pass: 0, fail: 4, status: 1, fails: true }),
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(out.findings, [], "the scenario the suite already lacked is not this revision's to add");
});

test("the model gets the spec whole in its own section, ahead of what the agent's files declare, with what to do with it", () => {
  const parts = requestParts({ spec: { name: "points-reader", jobs: [] }, specV1: SPEC, declared: DECLARED, agentFiles: [{ path: "plugin.json", text: "{}" }] });
  const joined = parts.join("\n");
  const at = (s) => { const i = joined.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("--- THE SPEC ---\nThis is the spec (spec-v1), given whole") < at("--- WHAT THE AGENT'S FILES DECLARE ---"));
  assert.ok(at("--- WHAT THE AGENT'S FILES DECLARE ---") < at("--- THE AGENT'S OWN FILES ---"));
  assert.ok(joined.includes(JSON.stringify(SPEC, null, 2)), "the spec goes whole, as it came");
  assert.match(joined, /WHAT THE AGENT'S FILES DECLARE, above, is a reading of these files/);
  assert.equal((joined.match(/--- THE SPEC ---/g) ?? []).length, 1);
  const text = specInstruction(SPEC);
  for (const w of ['"[F1.A1] a points line is read by its pattern"', "Keep the F number", "each entry of its exact", "byte for byte", '"[C1] ..."', "test/kept-interfaces.test.mjs", 'checkKept(jobDir, { expect: ["<the file\'s id>"] })', "Do\nnot write it"]) {
    assert.ok(text.includes(w), w);
  }
  assert.doesNotMatch(specInstruction({ ...SPEC, interfaces: [] }), /kept-interfaces/, "no kept interface, no word of the file");
  // With no spec, the request is as it was.
  const before = requestParts({ spec: { name: "points-reader", jobs: [] }, declared: DECLARED }).join("\n");
  assert.match(before, /--- THE SPEC ---\n\{/);
  assert.doesNotMatch(before, /WHAT THE AGENT'S FILES DECLARE|spec-v1/);
});

test("in a revision, the spec's id for a scenario names its test and its file, and an id is read whole", () => {
  const other = { path: "test/other.test.mjs", text: '// other\nimport { test } from "node:test";\ntest("[F1.A10] reads ten", () => {});\n' };
  assert.deepEqual(scenarioIdsIn("F1.A2 and F1.A10, not F1.A2x or xF1.A3"), ["F1.A2", "F1.A10"]);
  assert.deepEqual(namedForRevision([FILE, other], "The test for F1.A2 pins the wrong limit."), ["test/read.test.mjs"]);
  assert.deepEqual(namedForRevision([FILE, other], "F1.A1 is wrong"), ["test/read.test.mjs"], "F1.A1 does not name F1.A10");
  const named = namedTestsIn(FILE, "The test for F1.A2 pins the wrong limit.");
  assert.equal(named.all, false);
  assert.deepEqual([...named.names], ["[F1.A2] a list longer than the limit is read only to the limit"]);
});
