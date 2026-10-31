// Revising a suite the code step sent back (technical debt 636).
//   node --test test/revision.test.mjs
//
// What is pinned: a message whose first line begins "Revise the suite" carries
// the spec, the suite as it stands and what the code step found (a test that
// cannot pass without breaking what the spec says), with any words of the
// person's. Only the test files that message names, by file name or by the
// name of a test in them, may be written again; every other file is kept
// byte for byte, as when a suite is added to. A revision that names no file
// of the suite, or comes with no suite, is refused in words and nothing is
// asked of the model. The answer must rewrite at least one named file, and a
// file outside them is a finding as before. The reply says what was revised
// and what was kept, and only the revised files are delivered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  ADD_INSTRUCTION, askForSuite, namedForRevision, requestParts, reviseInstruction, staticFindings,
} from "../scripts/write-suite.mjs";
import { isRevision, runJob } from "../scripts/job.mjs";
import { wroteLine } from "../scripts/reply.mjs";

const fileFor = (script, names) => {
  const name = script.split("/").pop();
  const fn = name.replace(/\.mjs$/, "").replace(/-(.)/g, (_, c) => c.toUpperCase());
  const tests = names.map((n, i) => `test("${n}", () => { assert.equal(${fn}(${i}), ${i}); });`).join("\n");
  return { path: `test/${name.replace(/\.mjs$/, "")}.test.mjs`, text: `// ${name}: what it decides.\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { ${fn} } from "../scripts/${name}";\n${tests}\n` };
};
const COUNT = fileFor("scripts/count.mjs", ["counts each vowel in a plain sentence", "counts accented vowels as their plain letters"]);
const SAY = fileFor("scripts/say.mjs", ["says the total on a line of its own", "says nothing for an empty sentence"]);
const STANDARD = { path: "test/worked-values.test.mjs", text: "// worked values\nimport { test } from \"node:test\";\n" };
const SUITE = [COUNT, SAY, STANDARD];
const DECLARED = { name: "vowel-scale", version: "0.1.0", scripts: ["scripts/count.mjs", "scripts/say.mjs"], jobs: [] };
const answer = (files) => files.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n");
const failing = async () => ({ tests: 1, pass: 0, fail: 1, status: 1, fails: true });

test("a message whose first line begins Revise the suite is a revision, and nothing else is", () => {
  assert.equal(isRevision("Revise the suite.\n\nThe code step sent it back."), true);
  assert.equal(isRevision("  Revise the suite: one test is wrong"), true);
  assert.equal(isRevision("Write a suite.\n\nRevise the suite later."), false);
  assert.equal(isRevision(""), false);
});

test("the files a revision may rewrite are those it names, by file name or by a test's name, never the test writer's own", () => {
  assert.deepEqual(namedForRevision(SUITE, "test/count.test.mjs line 40 pins a total of 4 where the rule gives 7."), ["test/count.test.mjs"]);
  assert.deepEqual(namedForRevision(SUITE, "count.test.mjs is wrong"), ["test/count.test.mjs"], "the bare file name is enough");
  assert.deepEqual(namedForRevision(SUITE, "The test \"says nothing for an empty sentence\" expects a heading the spec does not give."), ["test/say.test.mjs"], "a test's own name names its file");
  assert.deepEqual(namedForRevision(SUITE, "worked-values.test.mjs and count.test.mjs disagree"), ["test/count.test.mjs"], "the standard checks are the test writer's own and never revised");
  assert.deepEqual(namedForRevision(SUITE, "A test is wrong somewhere."), []);
  assert.deepEqual(namedForRevision(SUITE, "the test count is off"), [], "a word that is part of a name is not a name");
});

test("a revision goes to the model with the whole suite, what was sent back first, and the instruction naming only the files to rewrite", () => {
  const asked = "Revise the suite.\n\ncount.test.mjs pins a total of 4 for \"Café façade rôle naïve\"; the rule gives 7.";
  const parts = requestParts({ spec: { name: "vowel-scale" }, declared: DECLARED, asked, existing: SUITE, revise: ["test/count.test.mjs"] });
  const joined = parts.join("\n");
  const at = (s) => { const i = joined.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("WHAT THEY ASKED FOR ---\nRevise the suite.") < at("THE SPEC ---"));
  assert.ok(joined.includes(`<<<FILE test/count.test.mjs>>>\n${COUNT.text}<<<END>>>`), "the file to revise goes whole");
  assert.ok(joined.includes(`<<<FILE test/say.test.mjs>>>\n${SAY.text}<<<END>>>`), "so does every kept file");
  assert.ok(joined.includes(reviseInstruction(["test/count.test.mjs"])));
  assert.ok(!joined.includes(ADD_INSTRUCTION), "a revision is not an addition");
  const words = reviseInstruction(["test/count.test.mjs"]);
  assert.match(words, /test\/count\.test\.mjs/);
  assert.match(words, /spec governs/i);
  assert.match(words, /kept exactly as/i);
});

test("in a revision a named file may come back under its own name, a kept one may not, and an answer that rewrites none of the named files is a finding", () => {
  const revised = { ...COUNT, text: COUNT.text.replace("counts accented", "counts accented vowels, worked,") };
  const ok = staticFindings([revised], DECLARED, { existing: SUITE, revise: ["test/count.test.mjs"] });
  assert.ok(!ok.some((f) => /already in the suite/.test(f)), ok.join(" | "));
  const kept = staticFindings([revised, SAY], DECLARED, { existing: SUITE, revise: ["test/count.test.mjs"] });
  assert.ok(kept.some((f) => /test\/say\.test\.mjs is already in the suite and is kept as it is/.test(f)), kept.join(" | "));
  const none = staticFindings([{ path: "test/extra.test.mjs", text: SAY.text }], DECLARED, { existing: SUITE, revise: ["test/count.test.mjs"] });
  assert.ok(none.some((f) => /rewrites none of the files it was sent back for: test\/count\.test\.mjs/.test(f)), none.join(" | "));
});

test("a revision is one ask, asked again once when its answer rewrote a kept file", async () => {
  const revised = { ...COUNT, text: COUNT.text.replace("counts accented", "counts accented vowels, worked,") };
  const answers = [answer([revised, SAY]), answer([revised])];
  const asked = [];
  const out = await askForSuite({ call: async (r) => { asked.push(r); return answers.shift(); }, run: failing, declared: DECLARED, spec: { name: "vowel-scale" }, existing: SUITE, revise: ["test/count.test.mjs"] });
  assert.equal(out.calls, 2);
  assert.deepEqual(out.files.map((f) => f.path), ["test/count.test.mjs"]);
  assert.deepEqual(out.findings, []);
});

const SPEC = JSON.stringify({ name: "vowel-scale", version: "0.1.0", jobs: [{ slug: "count", scripts: ["scripts/count.mjs"] }] });
function fakeSpawn(answers, ran = []) {
  return (bin, argv, opts) => {
    const script = basename(argv[0]);
    ran.push({ script, env: opts.env });
    const a = answers[script] ?? { ok: true, code: 0 };
    return { status: a.code ?? 0, stdout: `${JSON.stringify(a)}\n`, stderr: "" };
  };
}

test("a revision with no suite attached is refused in words and nothing is written", () => {
  const dir = mkdtempSync(join(tmpdir(), "tw-revise-"));
  try {
    const spec = join(dir, "spec.json"); writeFileSync(spec, SPEC);
    const text = join(dir, "text.txt"); writeFileSync(text, "Revise the suite.\n\ncount.test.mjs is wrong.");
    const ran = [];
    const out = runJob({ job: join(dir, "j"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: spec }], textFile: text, spawn: fakeSpawn({}, ran) });
    assert.equal(out.code, 3);
    assert.match(out.reply, /no suite came with it/i);
    assert.ok(!ran.some((r) => r.script === "write-suite.mjs"), "the model is not asked");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a revision with the suite attached hands the writing step the suite to revise and says it is a revision", () => {
  const dir = mkdtempSync(join(tmpdir(), "tw-revise-"));
  try {
    const spec = join(dir, "spec.json"); writeFileSync(spec, SPEC);
    const suite = join(dir, "0-abcdefgh-count.test.mjs"); writeFileSync(suite, COUNT.text);
    const text = join(dir, "text.txt"); writeFileSync(text, "Revise the suite.\n\ncount.test.mjs is wrong.");
    const ran = [];
    runJob({ job: join(dir, "j"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: spec }, { path: suite }], textFile: text, spawn: fakeSpawn({ "reply.mjs": { ok: true, code: 0, reply: "Revised." } }, ran) });
    const w = ran.find((r) => r.script === "write-suite.mjs");
    assert.ok(w, "the writing step ran");
    assert.equal(w.env.REVISE, "1");
    assert.ok(w.env.EXISTING, "the suite as it stands is handed over");
    assert.equal(w.env.ASKED_TEXT, text);
    const plain = [];
    writeFileSync(text, "Write a suite.");
    runJob({ job: join(dir, "j2"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: spec }, { path: suite }], textFile: text, spawn: fakeSpawn({}, plain) });
    assert.equal(plain.find((r) => r.script === "write-suite.mjs").env.REVISE, undefined, "an ordinary ask is not a revision");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the reply says which files were revised and that the others were kept and are not sent back", () => {
  const line = wroteLine(DECLARED, { files: [{ path: "test/count.test.mjs", tests: 9 }], revised: ["test/count.test.mjs"], kept: ["test/say.test.mjs", "test/worked-values.test.mjs"] });
  assert.match(line, /^Revised 1 test file the code step sent back for vowel-scale 0\.1\.0: count\.test\.mjs \(9 tests\)\./);
  assert.match(line, /The other 2 files were kept exactly as they were and are not sent back\./);
});
