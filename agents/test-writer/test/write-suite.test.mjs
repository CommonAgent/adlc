// The writing step: the one call that spends money.
//   node --test test/write-suite.test.mjs
//
// Nothing here touches the network. The call is a function the test hands
// in, and so is the stand-in run, which is what lets the things that matter
// be pinned: that the model is given the whole task in the right order; that
// files are read out of its answer wherever it put them and never outside
// test/; that a suite with something wrong is asked once more carrying what
// was wrong, and never a third time; and that a suite which passes against
// nothing is the finding this step exists to catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INSTRUCTION, MODEL, TRIES, answerFrom, askForSuite, modelOf, requestParts, staticFindings, standInFindings,
  suiteRequest, testNamesOf,
} from "../scripts/write-suite.mjs";

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const SPEC = {
  name: "watcher", version: "0.1.0",
  jobs: [{ slug: "report", offered: true, when: "w", good: "g", empty: "e", does: "d", how, scripts: ["scripts/read.mjs", "scripts/say.mjs"], instructions: "1. ROSTER=<f> RECORDS=<r> node scripts/read.mjs" }],
};
const DECLARED = {
  name: "watcher", version: "0.1.0", scripts: ["scripts/read.mjs", "scripts/say.mjs"],
  jobs: [{ slug: "report", commands: [{ script: "read.mjs", variables: ["ROSTER", "RECORDS"], flags: [] }] }],
};

const GOOD_FILE = `// The reader: who answered and who did not.
//   node --test test/read.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { whoAnswered } from "../scripts/read.mjs";
import { replyText } from "../scripts/say.mjs";

test("an agent that answered within the window is not quiet", () => {
  assert.deepEqual(whoAnswered([{ handle: "a", last: 10 }], 20, 100), { quiet: [], answered: ["a"] });
});
test("an agent nothing has heard from is quiet, and the reply says so by name", () => {
  assert.match(replyText({ quiet: ["a"] }), /a has not answered/);
});
test("nothing to read is said as nothing, not as everyone quiet", () => {
  assert.deepEqual(whoAnswered([], 20, 100), { quiet: [], answered: [] });
});
test("a roster that is not a list is refused", () => {
  assert.throws(() => whoAnswered("nope"), /roster/);
});
`;
const answer = (files, extra = "") => files.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n") + extra;

test("the model is a setting, and the default is the current generation", () => {
  assert.equal(MODEL, "google-vertex-anthropic/claude-sonnet-5-5");
  assert.equal(modelOf({}), MODEL);
  assert.equal(modelOf({ TEXT_MODEL: "gemini-3.8-pro" }), "gemini-3.8-pro");
  assert.equal(modelOf({ TEXT_MODEL: "  " }), MODEL, "a blank setting is not a model");
  assert.equal(suiteRequest({ env: { TEXT_MODEL: "x" } }).model, "x");
  assert.equal(TRIES, 2);
});

test("the request is the instruction, the spec, the commands, the reference, a suite that works and the spec it tests, in that order", () => {
  const parts = requestParts({ spec: SPEC, declared: DECLARED, reference: "# what a good suite carries", worked: "// a suite", workedSpec: '{"name":"publisher"}' });
  assert.equal(parts[0], INSTRUCTION);
  const joined = parts.join("\n");
  const at = (s) => { const i = joined.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("THE SPEC ---") < at("THE COMMANDS THE HARNESS RUNS"));
  assert.ok(at("THE COMMANDS THE HARNESS RUNS") < at("WHAT A GOOD SUITE CARRIES"));
  assert.ok(at("WHAT A GOOD SUITE CARRIES") < at("A SUITE THAT WORKS"));
  assert.ok(at("A SUITE THAT WORKS") < at("THE SPEC THAT SUITE TESTS"));
  assert.match(joined, /report: read\.mjs with ROSTER, RECORDS/);
  assert.match(joined, /"slug": "report"/, "the spec goes whole, as JSON");
  // Findings, when there are any, come last and say to keep the rest.
  const again = requestParts({ spec: SPEC, findings: ["nothing reaches scripts/say.mjs"] }).join("\n");
  assert.match(again, /WHAT WAS WRONG WITH YOUR LAST SUITE[\s\S]*nothing reaches scripts\/say\.mjs[\s\S]*Keep everything else as it was/);
  assert.doesNotMatch(parts.join("\n"), /WHAT WAS WRONG/);
});

test("the instruction gives the model the whole task, names the nevers, and says the answer form", () => {
  assert.match(INSTRUCTION, /before\s+any of its scripts exist/);
  assert.match(INSTRUCTION, /Your imports are the interface/);
  for (const w of ["Never write a test that would pass with the scripts absent", "Never touch a\nnetwork or a model", "Never write the scripts"]) {
    assert.ok(INSTRUCTION.includes(w), w);
  }
  assert.match(INSTRUCTION, /<<<FILE test\/<name>\.test\.mjs>>>/);
  assert.match(INSTRUCTION, /<<<COULD NOT>>>/);
});

test("files are read out of the blocks whether fenced or bare, put under test/, and end with a newline", () => {
  const bare = answer([{ path: "test/read.test.mjs", text: GOOD_FILE }]);
  assert.deepEqual(answerFrom(bare).files.map((f) => f.path), ["test/read.test.mjs"]);
  assert.equal(answerFrom("```\n" + bare + "\n```").files.length, 1, "one fence round the lot is unwrapped");
  const loose = answerFrom("<<<FILE read.test.mjs>>>\n// a\nimport { test } from \"node:test\";\ntest(\"x is y\", () => {});<<<END>>>");
  assert.equal(loose.files[0].path, "test/read.test.mjs", "a bare name is put under test/");
  assert.ok(loose.files[0].text.endsWith("\n"));
  assert.equal(answerFrom("<<<FILE ./test/a.test.mjs>>>\n// a\n<<<END>>>").files[0].path, "test/a.test.mjs");
});

test("a file that climbs out of the package is refused outright, and an answer with no file says so", () => {
  assert.throws(() => answerFrom("<<<FILE ../scripts/read.mjs>>>\nexport {};\n<<<END>>>"), /outside the package/);
  assert.throws(() => answerFrom("<<<FILE /etc/x.test.mjs>>>\n// a\n<<<END>>>"), /outside the package/);
  assert.throws(() => answerFrom(""), /answered with nothing/);
  assert.throws(() => answerFrom("Here is a suite for you."), /carries no test file/);
  assert.throws(() => answerFrom("<<<FILE test/a.test.mjs>>>\n\n<<<END>>>"), /carries no test file/, "an empty block is no file");
});

test("what could not be tested and what was assumed are read, each on its own lines", () => {
  const out = answerFrom(answer([{ path: "test/a.test.mjs", text: GOOD_FILE }],
    "\n<<<COULD NOT>>>\nthe platform read | nothing can stand in the platform\n- a person's judgment\n<<<END>>>\n<<<NOTES>>>\nassumed the roster is JSON.\n<<<END>>>"));
  assert.deepEqual(out.could_not, [
    { what: "the platform read", why: "nothing can stand in the platform" },
    { what: "a person's judgment", why: "" },
  ]);
  assert.equal(out.notes, "assumed the roster is JSON.");
  assert.deepEqual(answerFrom(answer([{ path: "test/a.test.mjs", text: GOOD_FILE }])).could_not, []);
});

test("test names are read as written, whatever quote they use", () => {
  assert.deepEqual(testNamesOf(GOOD_FILE).length, 4);
  assert.deepEqual(testNamesOf("test('a is b', () => {});\n  test(`c is d`, async () => {});\ntest.skip(\"e\", () => {});"), ["a is b", "c is d", "e"]);
  assert.deepEqual(testNamesOf("// no tests here"), []);
});

test("a file that opens with no comment, names a test as a label, or reaches no script is a finding by name", () => {
  const noComment = { path: "test/a.test.mjs", text: GOOD_FILE.replace(/^\/\/[^\n]*\n\/\/[^\n]*\n/, "") };
  assert.ok(staticFindings([noComment], DECLARED).some((f) => /a\.test\.mjs does not open with a comment/.test(f)));
  const labels = { path: "test/b.test.mjs", text: GOOD_FILE.replace('"an agent that answered within the window is not quiet"', '"Test whoAnswered"') };
  assert.ok(staticFindings([labels], DECLARED).some((f) => /b\.test\.mjs names tests as labels rather than sentences: "Test whoAnswered"/.test(f)));
  const island = { path: "test/c.test.mjs", text: "// pins nothing\nimport { test } from \"node:test\";\ntest(\"one is one\", () => {});\n" };
  const f = staticFindings([island], DECLARED);
  assert.ok(f.some((x) => /c\.test\.mjs imports nothing from \.\.\/scripts\/ and spawns no script/.test(x)));
  assert.ok(f.some((x) => /nothing reaches scripts\/read\.mjs/.test(x)));
  assert.ok(f.some((x) => /nothing reaches scripts\/say\.mjs/.test(x)));
  const foreign = { path: "test/d.test.mjs", text: GOOD_FILE.replace('import { test } from "node:test";', 'import { test } from "node:test";\nimport chai from "chai";') };
  assert.ok(staticFindings([foreign], DECLARED).some((x) => /imports a package that is not node's own/.test(x)));
});

test("fewer than two tests per script is a finding, and a clean suite has none", () => {
  const thin = { path: "test/a.test.mjs", text: GOOD_FILE.replace(/test\("nothing to read[\s\S]*$/, "") };
  const f = staticFindings([thin], DECLARED);
  assert.ok(f.some((x) => /2 tests for 2 scripts/.test(x)), f.join(" | "));
  assert.deepEqual(staticFindings([{ path: "test/a.test.mjs", text: GOOD_FILE }], DECLARED), []);
  assert.deepEqual(staticFindings([], DECLARED), ["no test file came back"]);
});

test("a stand-in run that passes is the finding this step exists to catch, and one that fails is none", () => {
  assert.match(standInFindings({ tests: 4, pass: 4, fail: 0, status: 0, fails: false })[0], /passed \(4 of 4\), so it asserts nothing/);
  assert.deepEqual(standInFindings({ tests: 1, pass: 0, fail: 1, status: 1, fails: true }), []);
  assert.match(standInFindings({ tests: 0, pass: 0, fail: 0, status: 0, fails: true })[0], /no test ran at all/);
  assert.match(standInFindings({ tests: 0, pass: 0, fail: 0, status: 1, fails: true, timed_out: true })[0], /did not finish in time/);
  assert.deepEqual(standInFindings(null), []);
});

test("a clean suite is one call, and the stand-in run is made once", async () => {
  let calls = 0; let runs = 0;
  const out = await askForSuite({
    spec: SPEC, declared: DECLARED,
    call: async () => { calls += 1; return answer([{ path: "test/read.test.mjs", text: GOOD_FILE }]); },
    run: async (files) => { runs += 1; assert.equal(files.length, 1); return { tests: 1, pass: 0, fail: 1, status: 1, fails: true }; },
  });
  assert.equal(calls, 1);
  assert.equal(runs, 1);
  assert.equal(out.tried_again, false);
  assert.deepEqual(out.findings, []);
  assert.equal(out.stand_ins.fails, true);
});

test("a suite with something wrong is asked once more, carrying what was wrong, and a run is not spent on a suite that failed the static check", async () => {
  const sent = []; let runs = 0;
  const bad = GOOD_FILE.replace('import { replyText } from "../scripts/say.mjs";\n', "").replace(/assert\.match\(replyText[^\n]*\n/, "");
  const out = await askForSuite({
    spec: SPEC, declared: DECLARED,
    call: async (request) => {
      sent.push(request.body.contents[0].parts.map((p) => p.text).join("\n"));
      return answer([{ path: "test/read.test.mjs", text: sent.length === 1 ? bad : GOOD_FILE }]);
    },
    run: async () => { runs += 1; return { tests: 1, pass: 0, fail: 1, status: 1, fails: true }; },
  });
  assert.equal(sent.length, 2);
  assert.doesNotMatch(sent[0], /WHAT WAS WRONG/);
  assert.match(sent[1], /WHAT WAS WRONG WITH YOUR LAST SUITE[\s\S]*nothing reaches scripts\/say\.mjs/);
  assert.equal(runs, 1, "the stand-in run is only spent on a suite that passed the static check");
  assert.equal(out.tried_again, true);
  assert.deepEqual(out.findings, []);
});

test("a suite that passes against stand-ins is asked once more with that said, and then stands with the finding out loud", async () => {
  const sent = [];
  const out = await askForSuite({
    spec: SPEC, declared: DECLARED,
    call: async (request) => { sent.push(request.body.contents[0].parts.map((p) => p.text).join("\n")); return answer([{ path: "test/read.test.mjs", text: GOOD_FILE }]); },
    run: async () => ({ tests: 4, pass: 4, fail: 0, status: 0, fails: false }),
  });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /passed \(4 of 4\), so it asserts nothing/);
  assert.equal(out.calls, 2);
  assert.equal(out.findings.length, 1, "the finding survives and goes with the suite");
  assert.equal(out.files.length, 1, "the suite still goes");
});

test("no call at all is a plain refusal, not a crash", async () => {
  await assert.rejects(askForSuite({ spec: SPEC }), /needs a call/);
});
