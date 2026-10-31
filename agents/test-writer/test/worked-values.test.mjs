// Every expected value a rule decides is worked twice, and the two must agree
// (technical debt 646, 2026-10-31).
//   node --test test/worked-values.test.mjs
//
// What is worth pinning. The model writes a suite's expected values out of
// its head, and a value worked out in the head is often wrong: a vowel-counter
// suite pinned 16 vowels in "Education provides curious insights." (it holds
// 14), and an acronym-maker suite pinned "HTTP" for "hypertext transfer
// protocol" when the spec takes one letter per word ("HTP"). The code writer
// rightly stopped on both as conflicts, and nothing before it could see them:
// a suite that fails against empty stand-ins fails whatever its literals say.
//
// So every suite carries a third file the model does not write:
// test/worked-values.test.mjs, copied whole from the references. The model
// writes each value a rule decides as worked(value, () => computation, what),
// a constant at the top of the file, the computation plain code over the
// test's own input. The run beside the agent's own files, where every file
// loads, evaluates each one; a value its own computation does not give, and a
// computation that throws (one that calls a script, for one), goes back to
// the model as a finding naming both. A suite that works no value at all goes
// back too, unless its notes say why none is decided by a rule; and a worked
// value inside a test, where a stand-in throws before it is reached, or one
// whose computation is only a literal, is a finding by name.
//
// Nothing here reaches a network or a model; the runs spawn node over scratch
// folders that are removed whatever happens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKED_TEST, NO_WORKED_VALUES, STANDARD_TESTS, INSTRUCTION, askForSuite, askInParts, callsWorked,
  refreshStandardTest, saysNoWorkedValues, standInFindings, staticFindings, withStandardTests, workedFindings, workedTestAt,
} from "../scripts/write-suite.mjs";
import { WORKED_WRONG, declarationRun, standInChecks, verdict } from "../scripts/check-suite.mjs";
import { declaredOf } from "../scripts/declared.mjs";
import { WRONG, disagreement, worked } from "../references/worked-values.test.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MASTER = join(HERE, "..", "references", "worked-values.test.mjs");
const WORKED_TEXT = readFileSync(MASTER, "utf8");

const SPEC = {
  name: "vowel-tally", version: "0.1.0", description: "Counts the vowels in a sentence.",
  jobs: [{
    slug: "count-vowels", title: "Count the vowels", offered: true,
    inputs: [{ name: "sentence", kind: "text", required: true, given_by: "person" }],
    outputs: [],
    scripts: ["scripts/count.mjs"],
  }],
  refuses: ["counting y as a vowel"],
  records: [],
};

/** A suite the model would write, with the expected total `total` worked
 *  against a count of the vowels done in the test itself. */
const suite = (total, compute = `function vowelsIn(s) {
  let n = 0;
  for (const ch of s.toLowerCase()) if ("aeiou".includes(ch)) n += 1;
  return n;
}`, call = "vowelsIn(SENTENCE)") => `// The vowel count is the number of a, e, i, o and u in the sentence.
//   node --test test/count.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { countVowels } from "../scripts/count.mjs";
import { worked } from "./worked-values.test.mjs";

${compute}

const SENTENCE = "Education provides curious insights.";
const TOTAL = worked(${total}, () => ${call}, "the vowels in the sentence");

test("the vowels of a sentence are counted", () => {
  assert.equal(countVowels(SENTENCE), TOTAL);
});

test("an empty sentence has no vowels", () => {
  assert.equal(countVowels(""), 0);
});
`;

const COUNT_SCRIPT = `export function countVowels(s) { let n = 0; for (const ch of String(s).toLowerCase()) if ("aeiou".includes(ch)) n += 1; return n; }\n`;

const scratch = (fn) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-worked-"));
  try { return fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const files = (text) => withStandardTests([{ path: "test/count.test.mjs", text }], { workedTest: WORKED_TEXT });

test("the worked-values check ships among the references, for both skills that write a suite", () => {
  assert.equal(workedTestAt({}), MASTER);
  const plugin = JSON.parse(readFileSync(join(HERE, "..", "plugin.json"), "utf8"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  for (const slug of ["write-a-suite", "write-the-suite"]) {
    assert.ok(skills[slug].references.includes("references/worked-values.test.mjs"), `${slug} does not carry it`);
    const md = readFileSync(join(HERE, "..", "skills", slug, "SKILL.md"), "utf8");
    assert.match(md, /references\/worked-values\.test\.mjs/, `${slug}'s SKILL.md does not list it`);
  }
  assert.equal(WORKED_TEST, "test/worked-values.test.mjs");
  assert.ok(STANDARD_TESTS.includes(WORKED_TEST));
});

// A worked value, as a suite writes one: a constant at the top of the file.
// It adds "every worked value agrees with its own computation" to this file.
const THREE = worked(3, () => 1 + 2, "three");

test("a worked value is given back as it is, and a disagreement names the value pinned and the value computed", () => {
  assert.equal(THREE, 3);
  assert.equal(disagreement(14, () => 14, "the vowels"), "");
  assert.deepEqual(disagreement({ a: 1 }, () => ({ a: 1 }), "a tally"), "");
  const wrong = disagreement(16, () => 14, "the vowels");
  assert.match(wrong, /the vowels/);
  assert.match(wrong, /pins 16/);
  assert.match(wrong, /gives 14/);
  assert.match(disagreement("HTTP", () => "HTP", "the acronym"), /pins "HTTP".*gives "HTP"/);
});

test("a computation that throws, is missing or answers a promise is a disagreement that says so", () => {
  assert.match(disagreement(1, () => { throw new Error("stand-in: countVowels is not written yet"); }, "x"), /threw.*stand-in: countVowels is not written yet.*never a script's function/);
  assert.match(disagreement(1, undefined, "x"), /no computation/);
  assert.match(disagreement(1, async () => 1, "x"), /promise/);
});

test("check-suite and the worked-values file name a disagreement with the same words", () => {
  assert.equal(WRONG, WORKED_WRONG);
});

test("a file whose worked value disagrees fails with both values named, and one that agrees passes", () => {
  scratch((at) => {
    mkdirSync(join(at, "test"), { recursive: true });
    writeFileSync(join(at, "test", "worked-values.test.mjs"), WORKED_TEXT);
    const run = (text) => {
      writeFileSync(join(at, "test", "w.test.mjs"), text);
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
      return spawnSync(process.execPath, ["--test", "test/w.test.mjs"], { cwd: at, env, encoding: "utf8" });
    };
    const head = `import { test } from "node:test";\nimport { worked } from "./worked-values.test.mjs";\n`;
    const bad = run(`${head}const N = worked(16, () => [..."Education provides curious insights."].filter((c) => "aeiou".includes(c.toLowerCase())).length, "the vowels");\ntest("a test", () => {});\n`);
    assert.notEqual(bad.status, 0, bad.stdout);
    assert.match(bad.stdout, /pins 16/);
    assert.match(bad.stdout, /gives 14/);
    const good = run(`${head}const N = worked(14, () => [..."Education provides curious insights."].filter((c) => "aeiou".includes(c.toLowerCase())).length, "the vowels");\ntest("a test", () => {});\n`);
    assert.equal(good.status, 0, good.stdout);
  });
});

test("the run beside the agent's own files finds a worked value its computation does not give, and never calls that test unpassable", () => {
  scratch(() => {
    const bad = declarationRun({ spec: SPEC, files: files(suite(16)) });
    assert.equal(bad.wrong_values.length, 1, JSON.stringify(bad));
    assert.match(bad.wrong_values[0], /the vowels in the sentence.*pins 16.*gives 14/);
    assert.match(bad.wrong_values[0], /count\.test\.mjs/);
    assert.deepEqual(bad.unpassable, []);
    const good = declarationRun({ spec: SPEC, files: files(suite(14)) });
    assert.deepEqual(good.wrong_values, []);
  });
});

test("a computation that calls a script is found, because a stand-in throws there", () => {
  const circular = suite(14, "", "countVowels(SENTENCE)");
  const run = declarationRun({ spec: SPEC, files: files(circular) });
  assert.equal(run.wrong_values.length, 1, JSON.stringify(run));
  assert.match(run.wrong_values[0], /threw.*stand-in/);
});

test("the stand-in checks carry the disagreements, and the finding and the verdict say them in words", () => {
  const run = standInChecks({ spec: SPEC, files: files(suite(16)) });
  assert.ok(run.fails);
  assert.equal(run.wrong_values.length, 1);
  const found = standInFindings(run);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0], /worked value disagrees with its own computation/);
  assert.match(found[0], /pins 16.*gives 14/);
  assert.match(verdict({ standIns: run }), /worked value disagrees with its own computation.*pins 16/);
  assert.deepEqual(standInFindings({ ...run, wrong_values: [] }), []);
});

test("a suite that works no value is a finding, unless its notes say why none is decided by a rule", () => {
  const declared = declaredOf(SPEC);
  const plain = [{ path: "test/count.test.mjs", text: suite(14).replace(/worked\(14, \(\) => vowelsIn\(SENTENCE\), "the vowels in the sentence"\)/, "14").replace(/import \{ worked \}.*\n/, "") }];
  assert.equal(callsWorked(plain), false);
  assert.ok(staticFindings(plain, declared, { workedCheck: true }).includes(NO_WORKED_VALUES));
  assert.ok(!staticFindings(plain, declared, { workedCheck: true, notes: "No worked values: every expectation is the reply's wording." }).includes(NO_WORKED_VALUES));
  assert.ok(!staticFindings(plain, declared).includes(NO_WORKED_VALUES), "held only when the check is asked for");
  const withIt = [{ path: "test/count.test.mjs", text: suite(14) }];
  assert.equal(callsWorked(withIt), true);
  assert.ok(!staticFindings(withIt, declared, { workedCheck: true }).includes(NO_WORKED_VALUES));
  assert.equal(saysNoWorkedValues("Assumed y is not a vowel.\nNo worked values: nothing is counted."), true);
  assert.equal(saysNoWorkedValues("Every value is worked."), false);
});

test("a worked value inside a test, or one whose computation is only a literal, is a finding by line", () => {
  const inside = `// x\nimport { test } from "node:test";\nimport { f } from "../scripts/count.mjs";\nimport { worked } from "./worked-values.test.mjs";\n\ntest("counts", () => {\n  const n = worked(14, () => 14 + 0, "n");\n  f(n);\n});\n`;
  const found = workedFindings([{ path: "test/count.test.mjs", text: inside }]);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0], /test\/count\.test\.mjs:7/);
  assert.match(found[0], /top of the file/);
  const literal = `// x\nimport { worked } from "./worked-values.test.mjs";\nconst N = worked(16, () => 16, "the vowels");\n`;
  const lit = workedFindings([{ path: "test/count.test.mjs", text: literal }]);
  assert.equal(lit.length, 1, JSON.stringify(lit));
  assert.match(lit[0], /only a literal/);
  assert.deepEqual(workedFindings([{ path: "test/count.test.mjs", text: suite(14) }]), []);
  assert.ok(staticFindings([{ path: "test/count.test.mjs", text: inside }], declaredOf(SPEC)).some((f) => /top of the file/.test(f)));
});

test("the model is told to work each value twice at the top of the file, and never to write the check", () => {
  assert.match(INSTRUCTION, /worked\(value, \(\) => computation, "what it is"\)/);
  assert.match(INSTRUCTION, /import \{ worked \} from "\.\/worked-values\.test\.mjs"/);
  assert.match(INSTRUCTION, /never a function from \.\.\/scripts\//);
  assert.match(INSTRUCTION, /No worked values:/);
  assert.match(INSTRUCTION, /test\/worked-values\.test\.mjs, which the test writer adds itself\. Do not write it/);
});

test("the worked-values check is added to a suite once, beside the other two, and refreshed in a suite being added to", () => {
  const one = [{ path: "test/a.test.mjs", text: "x" }];
  assert.deepEqual(withStandardTests(one, { formatTest: "f", recordsTest: "r", workedTest: WORKED_TEXT }).map((f) => f.path),
    ["test/a.test.mjs", "test/delivered-formats.test.mjs", "test/records-per-job.test.mjs", WORKED_TEST]);
  const r = refreshStandardTest([one[0], { path: WORKED_TEST, text: "an older copy" }], WORKED_TEST, WORKED_TEXT);
  assert.deepEqual(r.generated, [{ path: WORKED_TEST, text: WORKED_TEXT }]);
  const found = staticFindings([{ path: WORKED_TEST, text: WORKED_TEXT }, { path: "test/count.test.mjs", text: suite(14) }], declaredOf(SPEC));
  assert.match(found.join(" "), /worked-values\.test\.mjs is written by the test writer itself/);
});

test("the second ask carries the disagreement the run found, and the run gets the check beside the suite", async () => {
  const sent = []; const ran = [];
  const answer = (text) => `<<<FILE test/count.test.mjs>>>\n${text}<<<END>>>`;
  const out = await askForSuite({
    declared: declaredOf(SPEC), spec: SPEC, workedTest: WORKED_TEXT,
    call: async (request) => {
      sent.push(request.body.contents[0].parts.map((p) => p.text).join("\n"));
      return answer(suite(sent.length === 1 ? 16 : 14));
    },
    run: async (fs) => {
      ran.push(fs.map((f) => f.path));
      const wrong = fs.some((f) => /worked\(16,/.test(f.text));
      return { tests: 2, pass: 0, fail: 2, fails: true, status: 1, unpassable: [], wrong_values: wrong ? ["the vowels in the sentence (test/count.test.mjs:12): the test pins 16 and its own computation gives 14"] : [] };
    },
  });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /pins 16 and its own computation gives 14/);
  assert.deepEqual(out.findings, []);
  assert.deepEqual(ran[0], ["test/count.test.mjs", WORKED_TEST]);
});

test("a suite with no worked value is asked once more, and a suite in parts is held to it over the whole suite", async () => {
  const plain = suite(14).replace(/worked\(14, \(\) => vowelsIn\(SENTENCE\), "the vowels in the sentence"\)/, "14");
  const sent = [];
  await askForSuite({
    declared: declaredOf(SPEC), spec: SPEC, workedTest: WORKED_TEXT,
    call: async (request) => { sent.push(request); return `<<<FILE test/count.test.mjs>>>\n${sent.length === 1 ? plain : suite(14)}<<<END>>>`; },
  });
  assert.equal(sent.length, 2);
  const spec = { ...SPEC, jobs: [{ ...SPEC.jobs[0], scripts: ["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs", "scripts/d.mjs"] }] };
  const file = (n) => `<<<FILE test/${n}.test.mjs>>>\n// ${n}\nimport { test } from "node:test";\nimport { ${n} } from "../scripts/${n}.mjs";\ntest("${n} answers", () => ${n}());\ntest("${n} answers twice", () => ${n}());\n<<<END>>>`;
  const out = await askInParts({
    declared: declaredOf(spec), spec, workedTest: WORKED_TEXT, size: 3,
    call: async (request) => {
      const text = request.body.contents[0].parts.map((p) => p.text).join("\n");
      return ["a", "b", "c", "d"].filter((n) => new RegExp(`^- scripts/${n}\\.mjs$`, "m").test(text)).map(file).join("\n");
    },
  });
  assert.ok(out.findings.includes(`the whole suite: ${NO_WORKED_VALUES}`), JSON.stringify(out.findings));
});

test("the check bites: a suite pinning a miscounted value is sent back, and the corrected suite passes against the script", () => {
  scratch((at) => {
    assert.equal(standInChecks({ spec: SPEC, files: files(suite(16)) }).wrong_values.length, 1);
    const right = files(suite(14));
    assert.deepEqual(standInChecks({ spec: SPEC, files: right }).wrong_values, []);
    const dir = join(at, "pkg");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "count.mjs"), COUNT_SCRIPT);
    writeFileSync(join(dir, "spec.json"), JSON.stringify(SPEC));
    for (const f of right) { mkdirSync(join(dir, "test"), { recursive: true }); writeFileSync(join(dir, f.path), f.text); }
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
    const r = spawnSync(process.execPath, ["--test", ...right.map((f) => f.path)], { cwd: dir, env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout);
  });
});
