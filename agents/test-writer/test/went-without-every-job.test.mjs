// Every job writes its went-without record, a job that lacked nothing with no
// entries, and the records check never leaves it out (found 2026-10-31 in
// build ab_3508d5dec3d4642113).
//   node --test test/went-without-every-job.test.mjs
//
// What is worth pinning. vowel-meter 0.1.0 came through every stage to
// installed, its suite's worked values all held, and Conformance said
// does-not-conform for one thing: no went-without.json anywhere in its records
// folder. Every case the checker ran handed it a sentence, so no job lacked
// anything, and its script wrote the record only when one did. The House
// Stack says a job writes its declared records whether it succeeded or not,
// and the checker reads every per-job record after whatever jobs it ran. The
// suite let it through: it ran its two-job records check on two ordinary jobs
// with { except: ["*/went-without.json"] }, as the instruction allowed for a
// record "written only in some cases".
//
// So went-without.json is never excepted: checkRecordsPerJob holds every job
// to it whatever `except` names, and says why. The instruction tells the model
// that every job writes it, with no entries when it lacked nothing, and to
// run the two-job check on ordinary jobs.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTRUCTION } from "../scripts/write-suite.mjs";
import { checkRecordsPerJob } from "../references/records-per-job.test.mjs";

const DECL = { records: [
  { name: "what was counted, per job", when: "per_task", file: "*/counted.json" },
  { name: "what the job did not have and did anyway, per job", when: "per_task", file: "*/went-without.json" },
  { name: "an image, when one was asked for", when: "per_task", file: "*/image.json" },
] };

const folders = (fn) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-ww-"));
  try { return fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
};
const put = (p) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, "{}"); };

test("two ordinary jobs that wrote no went-without record are named, even when except names it", () => {
  folders((at) => {
    const records = join(at, "records");
    for (const j of ["job1", "job2"]) put(join(records, j, "counted.json"));
    const jobs = [join(at, "job1"), join(at, "job2")];
    for (const except of [["*/went-without.json"], ["what the job did not have and did anyway, per job"], ["went-without.json"]]) {
      const found = checkRecordsPerJob(records, jobs, { declaration: DECL, except: [...except, "*/image.json"] });
      assert.equal(found.length, 2, `${except}: ${JSON.stringify(found)}`);
      assert.match(found[0], /job1 left no record "what the job did not have and did anyway, per job"/);
    }
  });
});

test("the finding says every job writes it, with no entries when it lacked nothing", () => {
  folders((at) => {
    const records = join(at, "records");
    for (const j of ["job1", "job2"]) put(join(records, j, "counted.json"));
    const found = checkRecordsPerJob(records, [join(at, "job1"), join(at, "job2")], { declaration: DECL, except: ["*/went-without.json", "*/image.json"] });
    assert.match(found.join(" "), /every job writes went-without\.json, with no entries when it lacked nothing/);
  });
});

test("every job's went-without record passes, and another record may still be excepted", () => {
  folders((at) => {
    const records = join(at, "records");
    for (const j of ["job1", "job2"]) { put(join(records, j, "counted.json")); put(join(records, j, "went-without.json")); }
    assert.deepEqual(checkRecordsPerJob(records, [join(at, "job1"), join(at, "job2")], { declaration: DECL, except: ["*/image.json"] }), []);
  });
});

test("the model is told every job writes went-without.json and to run the check on ordinary jobs", () => {
  assert.match(INSTRUCTION, /Every job writes went-without\.json/);
  assert.match(INSTRUCTION, /with no entries when it lacked nothing/);
  assert.match(INSTRUCTION, /two ordinary jobs/);
  assert.match(INSTRUCTION, /never excepted/);
  assert.doesNotMatch(INSTRUCTION, /two jobs that go without the same thing each note went-without\.json/);
});
