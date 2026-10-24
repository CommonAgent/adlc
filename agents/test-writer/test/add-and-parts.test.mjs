// Adding to a suite a package already has, and writing a big suite in parts.
//   node --test test/add-and-parts.test.mjs
//
// What is pinned: a message that carries a released package's suite gets new
// files added beside it and never a rewrite, because the old writer answered
// "add two files" by writing the whole suite again (debt 43); the existing
// files go to the model whole, a file under one of their names is a finding,
// and reach and count are over the suite as it will stand. A spec with more
// scripts than one part holds is asked for in parts, each part checked on its
// own and told which scripts are its own, and a part whose answer is cut at
// the output limit is asked again one script at a time (debt 66). The job
// finds the suite among the attachments by content and lays it out by its
// bytes beside the work folder, and the reply says what was kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  ADD_INSTRUCTION, PART_SCRIPTS, askInParts, partsOf, requestParts, staticFindings,
} from "../scripts/write-suite.mjs";
import { findSuite, runJob, testNameOf } from "../scripts/job.mjs";
import { wroteLine } from "../scripts/reply.mjs";

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const fileFor = (script, n = 3) => {
  const name = script.split("/").pop();
  const fn = name.replace(/\.mjs$/, "").replace(/-(.)/g, (_, c) => c.toUpperCase());
  const tests = Array.from({ length: n }, (_, i) => `test("${fn} decides case ${i} the way the spec says", () => { assert.equal(${fn}(${i}), ${i}); });`).join("\n");
  return { path: `test/${name.replace(/\.mjs$/, "")}.test.mjs`, text: `// ${name}: what it decides.\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { ${fn} } from "../scripts/${name}";\n${tests}\n` };
};
const answer = (files) => files.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n");
const textOf = (request) => request.body.contents[0].parts.map((p) => p.text).join("\n");
const failing = async () => ({ tests: 1, pass: 0, fail: 1, status: 1, fails: true });

const TWO = { name: "adder", version: "0.2.0", scripts: ["scripts/add.mjs", "scripts/say.mjs"], jobs: [] };
const KEPT = [fileFor("scripts/add.mjs"), fileFor("scripts/say.mjs")];

test("the suite the package already has goes to the model whole, after the worked example, with the instruction to add and never rewrite", () => {
  const parts = requestParts({ spec: { name: "adder" }, declared: TWO, asked: "Add tests for the broker.", existing: KEPT, worked: "// a suite" });
  const joined = parts.join("\n");
  const at = (s) => { const i = joined.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("WHAT THEY ASKED FOR ---\nAdd tests for the broker.") < at("THE SPEC ---"), "their words come before the spec");
  assert.ok(at("A SUITE THAT WORKS") < at("THE SUITE IT ALREADY HAS"));
  assert.ok(joined.includes(`<<<FILE test/add.test.mjs>>>\n${KEPT[0].text}<<<END>>>`), "each kept file goes whole");
  assert.ok(at("THE SUITE IT ALREADY HAS") < at(ADD_INSTRUCTION));
  assert.match(ADD_INSTRUCTION, /Do not rewrite it/);
  assert.doesNotMatch(requestParts({ spec: { name: "adder" }, declared: TWO }).join("\n"), /THE SUITE IT ALREADY HAS|WHAT THEY ASKED FOR/);
});

test("a new file under a name the suite already has is a finding, and reach and count are over the suite as it will stand", () => {
  const rewrite = staticFindings([KEPT[0]], TWO, { existing: KEPT });
  assert.ok(rewrite.some((f) => /test\/add\.test\.mjs is already in the suite and is kept as it is/.test(f)), rewrite.join(" | "));
  const added = { path: "test/broker.test.mjs", text: fileFor("scripts/add.mjs", 2).text.replace("add.mjs: what", "broker: what") };
  assert.deepEqual(staticFindings([added], TWO, { existing: KEPT }), [], "say.mjs is reached by a kept file, so the new one need not reach it");
  assert.ok(staticFindings([added], TWO).some((f) => /nothing reaches scripts\/say\.mjs/.test(f)), "without the kept suite it would be a finding");
});

test("adding to a suite is one ask however many scripts the spec names", async () => {
  const many = { ...TWO, scripts: Array.from({ length: 7 }, (_, i) => `scripts/s${i}.mjs`) };
  const existing = many.scripts.map((s) => fileFor(s));
  let calls = 0;
  const out = await askInParts({
    declared: many, spec: { name: "adder" }, existing, run: failing,
    call: async (request) => { calls += 1; assert.match(textOf(request), /THE SUITE IT ALREADY HAS/); return answer([{ path: "test/more.test.mjs", text: existing[0].text }]); },
  });
  assert.equal(calls, 1);
  assert.equal(out.parts, undefined);
  assert.deepEqual(out.files.map((f) => f.path), ["test/more.test.mjs"]);
});

test("a spec with more scripts than one part holds is written in parts, each told its own scripts and the names already taken", async () => {
  const scripts = Array.from({ length: 7 }, (_, i) => `scripts/s${i}.mjs`);
  assert.equal(PART_SCRIPTS, 3);
  assert.deepEqual(partsOf(scripts).map((g) => g.length), [3, 3, 1]);
  const sent = []; const runs = [];
  const out = await askInParts({
    declared: { name: "planner", version: "0.1.0", scripts, jobs: [] }, spec: { name: "planner" },
    run: async (files) => { runs.push(files.map((f) => f.path)); return failing(); },
    call: async (request) => {
      const t = textOf(request); sent.push(t);
      const mine = scripts.filter((s) => t.includes(`- ${s}\n`) || t.endsWith(`- ${s}`));
      return answer(mine.map((s) => fileFor(s)));
    },
  });
  assert.equal(sent.length, 3);
  assert.match(sent[0], /THIS PART ---[\s\S]*- scripts\/s0\.mjs\n- scripts\/s1\.mjs\n- scripts\/s2\.mjs/);
  assert.match(sent[0], /This is the first part, so it also carries the tests on the spec itself/);
  assert.match(sent[1], /already written by earlier parts; do not use their names: test\/s0\.test\.mjs, test\/s1\.test\.mjs, test\/s2\.test\.mjs/);
  assert.match(sent[2], /The tests on the spec itself are in the first part/);
  assert.equal(out.parts, 3);
  assert.equal(out.files.length, 7);
  assert.deepEqual(out.findings, []);
  assert.equal(runs.length, 4, "one stand-in run per part, then the whole suite once");
  assert.equal(runs[3].length, 7);
});

test("a part cut at the output limit is asked again one script at a time, and a single script cut is the error it was", async () => {
  const scripts = ["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs", "scripts/d.mjs"];
  const sent = [];
  const out = await askInParts({
    declared: { name: "p", version: "0.1.0", scripts, jobs: [] }, spec: { name: "p" }, run: failing,
    call: async (request) => {
      const t = textOf(request); sent.push(t);
      const mine = scripts.filter((s) => t.includes(`- ${s}`));
      if (mine.length > 1) throw new Error("the answer was cut at the output limit");
      return answer(mine.map((s) => fileFor(s)));
    },
  });
  assert.equal(out.files.length, 4);
  assert.equal(out.parts, 4, "the first part of three came back as three parts of one");
  assert.equal(out.calls, 5, "the cut call is counted: one cut, three singles, and the last part");
  await assert.rejects(askInParts({
    declared: { name: "p", version: "0.1.0", scripts, jobs: [] }, spec: { name: "p" }, run: failing, size: 1,
    call: async () => { throw new Error("the answer was cut at the output limit"); },
  }), /cut at the output limit/);
});

test("the job finds an attached suite by content, names it under test/, and hands it to the writer with the message words", () => {
  assert.equal(testNameOf("/in/0-abcdefgh-1-ABCD_efg-publish.test.mjs"), "publish.test.mjs");
  assert.equal(testNameOf("/in/2-zzzzzzzz-suite_test_file"), "suite_test_file.test.mjs");
  assert.equal(testNameOf("/in/store.mjs"), "store.test.mjs");
  const dir = mkdtempSync(join(tmpdir(), "test-writer-add-"));
  try {
    const spec = join(dir, "0-abcdefgh-spec"); writeFileSync(spec, JSON.stringify({ name: "adder", version: "0.2.0", jobs: [{ slug: "add", scripts: ["scripts/add.mjs"] }] }));
    const kept = join(dir, "1-abcdefgh-add.test.mjs"); writeFileSync(kept, KEPT[0].text);
    const notes = join(dir, "notes.txt"); writeFileSync(notes, "just words");
    const message = join(dir, "message.txt"); writeFileSync(message, "Add a test for the empty case.");
    assert.deepEqual(findSuite([{ path: spec }, { path: kept }, { path: notes }], spec).map((f) => f.path), ["test/add.test.mjs"]);
    const ran = [];
    const spawn = (bin, argv, opts) => { ran.push({ script: basename(argv[0]), env: opts.env }); return { status: 0, stdout: JSON.stringify({ ok: true, code: 0, reply: "done" }), stderr: "" }; };
    runJob({ job: join(dir, "job-1"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: spec }, { path: kept }], textFile: message, spawn });
    const writing = ran.find((r) => r.script === "write-suite.mjs");
    assert.equal(writing.env.EXISTING, join(dir, "w", "job-1.existing"));
    assert.equal(readFileSync(join(writing.env.EXISTING, "test", "add.test.mjs"), "utf8"), KEPT[0].text);
    assert.equal(writing.env.ASKED_TEXT, message);
    ran.length = 0;
    runJob({ job: join(dir, "job-2"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: spec }], spawn });
    assert.equal(ran.find((r) => r.script === "write-suite.mjs").env.EXISTING, undefined, "no suite attached, nothing to add to");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the reply says what was added and that the kept files were not touched, or how many parts a big suite took", () => {
  const declared = { name: "adder", version: "0.2.0" };
  const added = wroteLine(declared, { files: [{ path: "test/broker.test.mjs", tests: 4 }], kept: ["test/add.test.mjs", "test/say.test.mjs"] });
  assert.equal(added, "Added 4 tests in 1 new file to the suite adder 0.2.0 already has: broker.test.mjs. The 2 files it already had were kept exactly as they were and are not sent back.");
  const parted = wroteLine(declared, { files: [{ path: "test/a.test.mjs", tests: 3 }, { path: "test/b.test.mjs", tests: 3 }], parts: 2 });
  assert.match(parted, /^Wrote 6 tests in 2 files for adder 0\.2\.0: a\.test\.mjs, b\.test\.mjs\. It was written in 2 parts/);
});
