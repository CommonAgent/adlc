// The whole job, end to end, with the model handed in.
//   node --test test/job.test.mjs
//
// What is worth pinning: a package sent as a tar.gz comes back as one
// findings piece, text/markdown as declared, filed by the step that made it;
// the house-rule findings come first and the model's kept findings after
// them, with the dropped ones in the records and not in the document; every
// record the descriptor declares is written, whether the model answered or
// not; with no model configured the house-rule findings still go and the
// reply says what the review went without; with nothing reviewable the job
// stops with exit 3 and calls no model; and sending the document back closes
// what was answered.
//
// Nothing here reaches a network or a real model, and nothing given is run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runJob, EMPTY } from "../scripts/job.mjs";
import { badPackage, tarOf } from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const descriptor = JSON.parse(readFileSync(join(HERE, "..", "agent-descriptor.json"), "utf8"));
const env = { TEXT_MODEL: "some-model", TEXT_API_KEY: "k" };

function setUp() {
  const dir = mkdtempSync(join(tmpdir(), "cc-job-"));
  const tgz = join(dir, "0-Ab12cdEF-bad.tgz");
  writeFileSync(tgz, tarOf({ ...badPackage(), "test/make.test.mjs": "import { test } from \"node:test\";\ntest(\"x\", () => {});\n" }));
  const msg = join(dir, "message.txt");
  writeFileSync(msg, "Please review this.");
  return { dir, tgz, msg, job: join(dir, "job-1"), records: join(dir, "records"), work: join(dir, "work") };
}

const answer = [
  "<<<FINDING>>>\nplace: scripts/think.mjs:2\nrule: general\nclaim: think returns the same value for every job.\nconsequence: The step the descriptor calls a judgment decides nothing, so every buyer gets the same answer.\n<<<END>>>",
  "<<<FINDING>>>\nplace: scripts/nowhere.mjs:1\nrule: general\nclaim: Something.\nconsequence: Something else.\n<<<END>>>",
].join("\n");

test("a package comes back as one findings piece, its declared kind, with every declared record written", async () => {
  const s = setUp();
  try {
    const asks = [];
    const out = await runJob({ job: s.job, records: s.records, work: s.work, files: [{ path: s.tgz, media_type: "application/gzip" }], textFile: s.msg, env,
      call: async (prompt) => { asks.push(prompt); return { model: "some-model", answered_by: "some-model-001", text: answer }; } });
    assert.equal(out.ok, true, out.reply);
    assert.equal(asks.length, 1);
    const pieces = JSON.parse(readFileSync(join(s.job, "pieces.json"), "utf8"));
    assert.equal(pieces.length, 1);
    const declared = descriptor.offerings[0].outputs.find((o) => o.name === pieces[0].name);
    assert.ok(declared, "the piece is not a declared output");
    assert.equal(pieces[0].media_type, declared.kind);
    assert.ok(descriptor.offerings[0].steps.some((st) => st.id === pieces[0].step));
    const doc = readFileSync(join(s.job, pieces[0].path), "utf8");
    assert.match(doc, /^# Review of bad 0\.1\.0/);
    assert.match(doc, /Found by: the review/);
    assert.match(doc, /think returns the same value for every job/);
    assert.doesNotMatch(doc, /nowhere\.mjs/);
    const house = doc.indexOf("Found by: the house-rule check"), model = doc.indexOf("Found by: the review");
    assert.ok(house > 0 && house < model, "house-rule findings come first");
    const rec = join(s.records, "job-1");
    for (const r of descriptor.records.filter((x) => x.file)) {
      const name = r.file.replace(/^\*\//, "");
      if (["account.md", "change.diff", "earlier-review.md"].includes(name)) continue;
      assert.ok(existsSync(join(rec, name.replace(/\/\*$/, ""))), `${r.file} was not written`);
    }
    assert.equal(JSON.parse(readFileSync(join(rec, "checked.json"), "utf8")).dropped.length, 1);
    assert.equal(JSON.parse(readFileSync(join(rec, "calls.json"), "utf8")).calls[0].answered_by, "some-model-001");
    assert.match(out.reply, /^Reviewed the whole package of bad 0\.1\.0: \d+ findings, \d+ open\./);
    assert.match(out.reply, /without the Code stage's account/);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("with no model configured the house-rule findings still go, and the reply says so", async () => {
  const s = setUp();
  try {
    let called = false;
    const out = await runJob({ job: s.job, records: s.records, work: s.work, files: [{ path: s.tgz }], textFile: s.msg, env: {}, call: async () => { called = true; } });
    assert.equal(called, false);
    assert.equal(out.ok, true);
    assert.ok(out.findings > 0);
    assert.match(out.reply, /without .*the model's review/);
    assert.match(readFileSync(join(s.job, "out", "findings.md"), "utf8"), /no model is configured/);
    assert.ok(existsSync(join(s.records, "job-1", "calls.json")));
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("with nothing reviewable the job stops with exit 3 and calls no model", async () => {
  const s = setUp();
  try {
    const notes = join(s.dir, "notes.txt");
    writeFileSync(notes, "just words");
    let called = false;
    const out = await runJob({ job: s.job, records: s.records, work: s.work, files: [{ path: notes }], textFile: s.msg, env, call: async () => { called = true; } });
    assert.equal(out.code, 3);
    assert.equal(called, false);
    assert.ok(out.reply.startsWith(EMPTY));
    assert.equal(existsSync(join(s.job, "pieces.json")), false);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("sending the document back with a reason written in closes that finding", async () => {
  const s = setUp();
  try {
    const none = async () => ({ model: "some-model", text: "<<<NONE>>>" });
    await runJob({ job: s.job, records: s.records, work: s.work, files: [{ path: s.tgz }], textFile: s.msg, env, call: none });
    const first = readFileSync(join(s.job, "out", "findings.md"), "utf8");
    const total = Number(/- findings: (\d+)/.exec(first)[1]);
    const answered = first.replace(/- Answer: open/, "- Answer: Kept on purpose; the reason is in the build record.");
    const back = join(s.dir, "1-Ab12cdEF-findings.md");
    writeFileSync(back, answered);
    const out = await runJob({ job: join(s.dir, "job-2"), records: s.records, work: s.work, files: [{ path: s.tgz }, { path: back, media_type: "text/markdown" }], textFile: s.msg, env, call: none });
    const second = readFileSync(join(s.dir, "job-2", "out", "findings.md"), "utf8");
    assert.match(second, /## Answers to the earlier review/);
    assert.match(second, /F1 at `[^`]+`: answered by a reason: Kept on purpose/);
    assert.equal(out.open, total - 1);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});
