// The three checks test-writer 0.8.0 added, and the repair a revision gets.
//   node --test test/suite-rules.test.mjs
//
// What is pinned (round trip, 2026-11-09):
// - pinFindings: each number and each quoted word or pattern a feature the
//   message lists, or a refusal the spec declares, states and no test of it
//   carries, named by the feature's id; a time limit may be written in
//   seconds or milliseconds; sample data in a stand-in does not count.
// - asyncThrowsFindings: assert.throws or assert.doesNotThrow around a
//   callback that is async, awaits, or reaches a function declared async or
//   handed an async stand-in, by file and line; said once, through the
//   static check, so the model is asked again.
// - namedTestsIn and restoreUnnamed: in a revision only the tests the
//   person's words name may change, by name, by a line they cite or by a
//   phrase quoted from one test; every other test is put back byte for byte,
//   a test the answer adds is taken out, and a constant a test not named may
//   use is kept as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asyncThrowsFindings, chunksOf, featuresIn, namedTestsIn, pinFindings, restoreUnnamed, statedIn,
} from "../scripts/suite-rules.mjs";
import { askForSuite, reviseInstruction, staticFindings } from "../scripts/write-suite.mjs";

const answer = (files) => files.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n");

// A small suite for a made-up agent that reads a list of headlines.
const BEFORE = `// headlines.mjs: what it reads and how much.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readList, capOf } from "../scripts/headlines.mjs";

const LIMIT = 30;
const ROWS = [
  { id: 7, title: "a" },
  { id: 8, title: "b" },
];

test("[F1] reads the list in the order given", async () => {
  const got = await readList(async () => ROWS);
  assert.deepEqual(got.map((r) => r.id), ROWS.map((r) => r.id));
});

// The cap the feature states.
test("[F2] caps how many it reads at the limit", () => {
  assert.equal(capOf(99), LIMIT);
});

test("a list that will not load is refused", () => {
  const fetchList = async () => { throw new Error("down"); };
  assert.throws(() => readList(fetchList), /cannot be read/);
});
`;
const FILE = { path: "test/headlines.test.mjs", text: BEFORE };

test("a file splits into its top-level statements, each test with the comment above it, and joins back byte for byte", () => {
  const chunks = chunksOf(BEFORE);
  assert.equal(chunks.map((c) => c.text).join(""), BEFORE);
  const tests = chunks.filter((c) => c.test);
  assert.deepEqual(tests.map((c) => c.name), [
    "[F1] reads the list in the order given", "[F2] caps how many it reads at the limit", "a list that will not load is refused",
  ]);
  assert.match(tests[1].text, /^\/\/ The cap the feature states\.\ntest\(/, "a comment just above a test is part of it");
  assert.deepEqual(chunks.find((c) => c.declares.includes("ROWS")).declares, ["ROWS"]);
  const braces = chunksOf(`const A = "{ not a block";\nconst B = /[}]/;\ntest("one test of a file", () => {\n  const s = \`\n}\n\`;\n});\n`);
  assert.deepEqual(braces.map((c) => c.test ? c.name : c.declares[0]), ["A", "B", "one test of a file"], "braces in strings, patterns and templates do not split a statement");
});

test("a test is named by its name, by a line the words cite, or by a phrase quoted from it alone; a file named with no test named is named whole", () => {
  const n1 = namedTestsIn(FILE, "Revise the suite. The test \"a list that will not load is refused\" cannot pass.");
  assert.equal(n1.all, false);
  assert.deepEqual([...n1.names], ["a list that will not load is refused"]);
  const line = BEFORE.split("\n").findIndex((l) => l.includes("assert.throws")) + 1;
  assert.deepEqual([...namedTestsIn(FILE, `headlines.test.mjs line ${line} is wrong`).names], ["a list that will not load is refused"]);
  assert.deepEqual([...namedTestsIn(FILE, `see test/headlines.test.mjs:${line}`).names], ["a list that will not load is refused"]);
  assert.deepEqual([...namedTestsIn(FILE, "it says `assert.equal(capOf(99), LIMIT);` and the spec says 20").names], ["[F2] caps how many it reads at the limit"]);
  assert.equal(namedTestsIn(FILE, "it uses `from \"node:assert/strict\"` everywhere").all, true, "a phrase found in no test, or in several, names none");
  assert.equal(namedTestsIn(FILE, "headlines.test.mjs is wrong").all, true);
});

test("the tests the words did not name are put back byte for byte, a dropped one comes back, an added one goes, and a shared constant stays", () => {
  const after = BEFORE
    .replace("const LIMIT = 30;", "const LIMIT = 20;")
    .replace("assert.deepEqual(got.map((r) => r.id), ROWS.map((r) => r.id));", "assert.equal(got.length, 2);")
    .replace(/\/\/ The cap the feature states\.\ntest\("\[F2\][\s\S]*?\n\}\);\n/, "")
    .replace(`test("a list that will not load is refused", () => {
  const fetchList = async () => { throw new Error("down"); };
  assert.throws(() => readList(fetchList), /cannot be read/);
});`, `test("a list that will not load is refused", async () => {
  const fetchList = async () => { throw new Error("down"); };
  await assert.rejects(readList(fetchList), /cannot be read/);
});

test("an extra test nobody asked for", () => { assert.ok(true); });`);
  const named = namedTestsIn(FILE, "The test \"a list that will not load is refused\" uses assert.throws on an async read.");
  const r = restoreUnnamed(BEFORE, after, named);
  const want = BEFORE.replace(`test("a list that will not load is refused", () => {
  const fetchList = async () => { throw new Error("down"); };
  assert.throws(() => readList(fetchList), /cannot be read/);
});`, `test("a list that will not load is refused", async () => {
  const fetchList = async () => { throw new Error("down"); };
  await assert.rejects(readList(fetchList), /cannot be read/);
});`);
  assert.equal(r.text, want);
  assert.deepEqual(r.restored, ["[F1] reads the list in the order given"]);
  assert.deepEqual(r.dropped, ["[F2] caps how many it reads at the limit"]);
  assert.deepEqual(r.added, ["an extra test nobody asked for"]);
  assert.deepEqual(r.kept, ["LIMIT"]);
  const first = want.split("\n").findIndex((l) => l.startsWith('test("a list that will not load')) + 1;
  assert.ok(r.fresh.has(first) && r.fresh.has(first + 2), "the named test's lines are the answer's own");
  assert.ok(!r.fresh.has(1), "a line put back is not");
});

test("an import the answer widens and a helper it adds go in; with the whole file named the answer stands", () => {
  const after = BEFORE
    .replace('import { readList, capOf } from "../scripts/headlines.mjs";', 'import { readList, capOf, REFUSED } from "../scripts/headlines.mjs";')
    .replace("const LIMIT = 30;", "const LIMIT = 30;\nconst down = async () => { throw new Error(\"down\"); };")
    .replace(`  const fetchList = async () => { throw new Error("down"); };
  assert.throws(() => readList(fetchList), /cannot be read/);`, "  return assert.rejects(readList(down), REFUSED);");
  const named = namedTestsIn(FILE, "\"a list that will not load is refused\" is the wrong test");
  const r = restoreUnnamed(BEFORE, after, named);
  assert.match(r.text, /import \{ readList, capOf, REFUSED \} from/);
  assert.match(r.text, /const down = async \(\) =>[^\n]*\n\ntest\("\[F1\]/, "a helper goes in before the first test");
  assert.match(r.text, /return assert\.rejects\(readList\(down\), REFUSED\);/);
  assert.deepEqual([r.restored, r.dropped, r.added, r.kept], [[], [], [], []]);
  const whole = restoreUnnamed(BEFORE, "// all new\n", { all: true, names: new Set() });
  assert.equal(whole.text, "// all new\n");
});

test("a revision delivers the named test changed and every other test as it was, and an answer that changed only other tests is asked again", async () => {
  const declared = { name: "headlines", version: "0.1.0", scripts: ["scripts/headlines.mjs"], jobs: [] };
  const asked = "Revise the suite.\n\nheadlines.test.mjs: \"a list that will not load is refused\" uses assert.throws on an async read. Change nothing else.";
  const fixed = BEFORE.replace(`test("a list that will not load is refused", () => {
  const fetchList = async () => { throw new Error("down"); };
  assert.throws(() => readList(fetchList), /cannot be read/);`, `test("a list that will not load is refused", async () => {
  const fetchList = async () => { throw new Error("down"); };
  await assert.rejects(readList(fetchList), /cannot be read/);`);
  const meddled = fixed.replace("const LIMIT = 30;", "const LIMIT = 31;").replace("capOf(99)", "capOf(100)");
  const sent = [];
  const call = async (req) => { sent.push(req); return answer([{ path: FILE.path, text: sent.length === 1 ? BEFORE.replace("capOf(99)", "capOf(98)") : meddled }]); };
  const failing = async () => ({ tests: 3, pass: 0, fail: 3, status: 1, fails: true });
  const got = await askForSuite({ call, run: failing, declared, existing: [FILE], revise: [FILE.path], asked });
  assert.equal(sent.length, 2, "the first answer changed no named test, so it is asked again");
  assert.match(sent[1].body.contents[0].parts.map((p) => p.text).join("\n"), /rewrites none of the files it was sent back for/);
  assert.equal(got.files.length, 1);
  assert.equal(got.files[0].text, fixed, "only the named test differs from the suite as it was");
  assert.ok(got.restored.some((s) => /put back as it was[^]*\[F2\] caps how many/.test(s)), got.restored.join(" | "));
  assert.ok(got.restored.some((s) => /kept as it was[^]*LIMIT/.test(s)), got.restored.join(" | "));
});

test("the revise instruction lists the tests the words name and says the rest are put back", () => {
  const words = reviseInstruction([FILE.path], { [FILE.path]: ["a list that will not load is refused"] });
  assert.match(words, /- "a list that will not load is refused" in test\/headlines\.test\.mjs/);
  assert.match(words, /byte for byte/);
  assert.equal(reviseInstruction([FILE.path], { [FILE.path]: null }), reviseInstruction([FILE.path]), "a file named whole lists no tests");
});

test("assert.throws around an async callback, an await, a function declared async or an async stand-in is a finding by line", () => {
  const text = `import { test } from "node:test";
import assert from "node:assert/strict";
import { load, parse } from "../scripts/x.mjs";
async function helper() { return load(); }
test("one", () => { assert.throws(async () => load(), /x/); });
test("two", () => { assert.throws(() => { const p = await load(); }, /x/); });
test("three", () => { assert.throws(() => helper(), /x/); });
test("four", () => { assert.throws(() => load({ fetch: async () => null }), /x/); });
test("five", () => { assert.doesNotThrow(() => helper()); });
test("six", () => { assert.throws(() => parse("{"), /x/); });
`;
  const got = asyncThrowsFindings([{ path: "test/x.test.mjs", text }]);
  assert.deepEqual(got.map((f) => f.split(" ")[0]), ["test/x.test.mjs:5", "test/x.test.mjs:6", "test/x.test.mjs:7", "test/x.test.mjs:8", "test/x.test.mjs:9"]);
  assert.match(got[0], /async function[^]*await assert\.rejects/);
  assert.match(got[2], /reaches helper/);
  assert.match(got[4], /assert\.doesNotThrow[^]*await assert\.doesNotReject/);
  const deps = asyncThrowsFindings([{ path: "test/x.test.mjs", text: 'test("six", () => { assert.throws(() => parse("{"), /x/); });\n' }],
    { dependencies: [{ path: "scripts/x.mjs", text: "export async function parse(s) { return s; }" }] });
  assert.equal(deps.length, 1, "a function the change depends on declares async");
  const only = asyncThrowsFindings([{ path: "test/x.test.mjs", text }], { fresh: new Map([["test/x.test.mjs", new Set([7])]]) });
  assert.deepEqual(only.map((f) => f.split(" ")[0]), ["test/x.test.mjs:7"], "in a revision only the answer's own lines are read");
});

test("the async finding comes through the static check, so the model is asked again", () => {
  const f = { path: "test/x.test.mjs", text: `// x: what it pins.\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { load } from "../scripts/x.mjs";\ntest("refuses a list that will not load", () => { assert.throws(() => load(async () => null), /no list/); });\ntest("loads a list it is given", async () => { assert.ok(await load(async () => [])); });\n` };
  const got = staticFindings([f], { scripts: ["scripts/x.mjs"] });
  assert.ok(got.some((x) => /^test\/x\.test\.mjs:5 wraps the call in assert\.throws/.test(x)), got.join(" | "));
});

const FEATURES = `features: the owner approved these:
- F1 (offering Read): Read the list. Reads the list in the order given, up to 20 at a time.
- F2 (offering Read): Cap the count. Reads ten by default and at most 30, with a 10-second limit on each read, and says "nothing to read" when the list is empty.
Name each test that checks one of these features starting with the feature's id in square brackets.`;

test("what a feature states: numbers as written or in words, a time limit in seconds or milliseconds, and quoted words", () => {
  assert.deepEqual(featuresIn(FEATURES).map((f) => f.id), ["F1", "F2"]);
  const s = statedIn(featuresIn(FEATURES)[1].text);
  assert.deepEqual(s.numbers.map((n) => [n.said, [...n.values]]), [["30", ["30"]], ["10-second", ["10", "10000"]], ["ten", ["10"]]]);
  assert.deepEqual(s.phrases, ["nothing to read"]);
  assert.deepEqual(statedIn("version 1.0.0 of F3, in hn-top-v1, under 2,000,000 characters").numbers.map((n) => n.said), ["2,000,000"]);
});

test("each number and quoted word a feature states that no test of it pins is a finding naming the feature; sample data does not pin", () => {
  const got = pinFindings([FILE], { words: FEATURES });
  assert.equal(got.length, 2, got.join(" | "));
  assert.match(got[0], /^F1 states the number 20, and no test named \[F1\] pins it/, "ids 7 and 8 in the sample rows pin nothing");
  assert.match(got[1], /^F2 states the number 10-second; the number ten; the words "nothing to read", and no test named \[F2\] pins them/,
    "a 10-second limit written 10000 does not pin a default of ten");
  const pinned = { path: FILE.path, text: BEFORE
    .replace("const LIMIT = 30;", "const LIMIT = 30;\nconst BY_DEFAULT = 10;\nconst BATCH = 20;\nconst READ_MS = 10_000;")
    .replace("assert.equal(capOf(99), LIMIT);", "assert.equal(capOf(99), LIMIT);\n  assert.equal(capOf(), BY_DEFAULT);\n  assert.equal(capOf(0, READ_MS).empty, \"nothing to read\");")
    .replace("assert.deepEqual(got.map", "assert.ok(got.batches.every((b) => b.length <= BATCH));\n  assert.deepEqual(got.map") };
  assert.deepEqual(pinFindings([pinned], { words: FEATURES }), []);
});

test("a feature no test is named for is a finding, a suite that names no feature is not read for features, and a refusal's number is looked for anywhere", () => {
  const onlyF1 = { path: FILE.path, text: BEFORE.replace("[F2] caps", "caps") };
  assert.ok(pinFindings([onlyF1], { words: FEATURES }).some((f) => /^no test is named for F2 /.test(f)));
  const none = { path: FILE.path, text: BEFORE.replace("[F1] ", "").replace("[F2] ", "") };
  assert.deepEqual(pinFindings([none], { words: FEATURES }), []);
  const declared = { refuses: ["Reading a page over 2,000,000 characters. It is passed over and the story says why."] };
  assert.match(pinFindings([none], { declared })[0], /^refusal 1 \("Reading a page over 2,000,000 characters[^]*states the number 2,000,000/);
  assert.deepEqual(pinFindings([{ path: FILE.path, text: none.text.replace("const LIMIT = 30;", "const LIMIT = 30;\nconst BIG = 2_000_001;") }], { declared }).length, 1, "a number next to the limit is not the limit");
  assert.deepEqual(pinFindings([{ path: FILE.path, text: none.text.replace("const LIMIT = 30;", "const LIMIT = 30;\nconst MAX = 2_000_000;") }], { declared }), []);
});

test("a new suite is held to what the features state and asked again; a revision is not", async () => {
  const declared = { name: "headlines", version: "0.1.0", scripts: ["scripts/headlines.mjs"], jobs: [] };
  const fixedAsync = BEFORE.replace(`test("a list that will not load is refused", () => {
  const fetchList = async () => { throw new Error("down"); };
  assert.throws(() => readList(fetchList), /cannot be read/);`, `test("a list that will not load is refused", async () => {
  const fetchList = async () => { throw new Error("down"); };
  await assert.rejects(readList(fetchList), /cannot be read/);`);
  const sent = [];
  const call = async (req) => { sent.push(req); return answer([{ path: FILE.path, text: fixedAsync }]); };
  const failing = async () => ({ tests: 3, pass: 0, fail: 3, status: 1, fails: true });
  const got = await askForSuite({ call, run: failing, declared, asked: FEATURES });
  assert.equal(sent.length, 2);
  assert.match(sent[1].body.contents[0].parts.map((p) => p.text).join("\n"), /F1 states the number 20/);
  assert.ok(got.findings.some((f) => /^F2 states/.test(f)), "still unpinned after the second go, so it is said");
  const revised = [];
  const rcall = async (req) => { revised.push(req); return answer([{ path: FILE.path, text: fixedAsync }]); };
  const r = await askForSuite({ call: rcall, run: failing, declared, existing: [FILE], revise: [FILE.path], asked: `Revise the suite.\n"a list that will not load is refused" is wrong.\n${FEATURES}` });
  assert.equal(revised.length, 1, "a revision keeps what the suite had and is not held to the features");
  assert.deepEqual(r.findings, []);
});
