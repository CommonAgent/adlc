// run.reply names a member the job's command prints (technical debt 657,
// 2026-10-31).
//   node --test test/run-reply-printed.test.mjs
//
// What is worth pinning. spec-writer 0.6.2 drafted consonant-ledger
// (ab_c2add1d21b685b80aa) and consonant-meter (ab_5f3651347f159dc723) with
// run.reply "json:consonant-count-report.md": the package maker's form, so
// nothing refused it, but the name of the report the job files rather than a
// member of what it prints. The scripts printed {"code":0,"reply":"..."}. On
// the host every job's reply was empty, so the host recorded it as stopped and
// told the sender the work was cut short, and Conformance was inconclusive.
//
// The host reads json:<member> as that member of the one JSON object the
// command prints. Every house script prints one, and its `reply` member is the
// words the sender reads. So a drafted json:<member> names `reply`, or a member
// the job's own instructions say it prints (in backticks, as a plain name);
// anything else is written as json:reply before the person sees the spec, and
// the reply says what changed. A file the job writes is a piece it files, never
// a member of what it prints. `stdout` stays as it is.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINTED_MEMBER, checkSpec, fitRunReply, printedMembers, runReplyProblems, runReplyUnprinted } from "../scripts/check-spec.mjs";
import { INSTRUCTION } from "../scripts/draft.mjs";

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const job = (reply, instructions) => ({
  slug: "count-consonants", title: "Count consonants", offered: true, how,
  when: "when somebody wants the consonants in a sentence counted",
  good: "A total of the consonant letters in the sentence, and how many of each, which a reader can count again by hand.",
  empty: "With no sentence it says there was nothing to count.",
  does: "Counts the consonants in a sentence.",
  outputs: [{ name: "consonant-count-report.md", kind: "text/markdown", when: "per_task" }],
  ...(instructions ? { instructions } : {}),
  run: { command: ["node", "{home}/{package}/skills/count-consonants/scripts/count-consonants.mjs", "--job", "{job_dir}"], ...(reply === undefined ? {} : { reply }) },
});
const specWith = (reply, instructions) => ({
  name: "consonant-ledger", version: "0.1.0",
  jobs: [job(reply, instructions)],
  refuses: Array.from({ length: 4 }, (_, i) => `refusing act ${i}, because it is not this agent's to do, and it says so instead`),
  records: [{ name: "the signed job manifest" }],
  price: { model: "free" },
  systems: [],
});

test("the member every house script prints is reply, and a job's instructions may name others it prints", () => {
  assert.equal(PRINTED_MEMBER, "reply");
  assert.deepEqual(printedMembers(job("json:reply")), ["reply"]);
  assert.deepEqual(printedMembers(job("json:total", "Run it. It prints one JSON object with `reply` and `total` members, and writes `out/report.md`.")), ["reply", "total"]);
});

test("the consonant-ledger draft: a run.reply naming the report it files is written as json:reply, and it is said", () => {
  const got = fitRunReply(specWith("json:consonant-count-report.md"));
  assert.equal(got.spec.jobs[0].run.reply, "json:reply");
  assert.match(got.note, /count-consonants/);
  assert.match(got.note, /"json:consonant-count-report\.md"/);
  assert.match(got.note, /written as "json:reply"/);
  assert.match(got.note, /cut short/);
});

test("a member the job's instructions say it prints is kept; one they do not name becomes reply; stdout and json:reply stay", () => {
  const says = "It prints one JSON object with `reply` and `total` members.";
  const kept = specWith("json:total", says);
  assert.deepEqual(fitRunReply(kept), { spec: kept, note: "" });
  assert.equal(fitRunReply(specWith("json:total")).spec.jobs[0].run.reply, "json:reply");
  assert.equal(fitRunReply(specWith("json:counts.total", "It prints `counts.total`.")).spec.jobs[0].run.reply, "json:reply");
  for (const good of ["stdout", "json:reply", undefined]) {
    const s = specWith(good);
    assert.deepEqual(fitRunReply(s), { spec: s, note: "" });
  }
});

test("a member after the wrong word is kept only when the job prints it", () => {
  assert.equal(fitRunReply(specWith("text:counts")).spec.jobs[0].run.reply, "json:reply");
  assert.equal(fitRunReply(specWith("text:counts", "It prints one JSON object with `reply` and `counts`.")).spec.jobs[0].run.reply, "json:counts");
});

test("check-spec names a run.reply the command never prints; the package maker's own rule is unchanged", () => {
  const p = runReplyUnprinted(specWith("json:consonant-count-report.md"));
  assert.equal(p.length, 1);
  assert.match(p[0], /^job count-consonants: run\.reply is "json:consonant-count-report\.md"/);
  assert.match(p[0], /prints no member consonant-count-report\.md/);
  assert.ok(checkSpec(specWith("json:consonant-count-report.md")).includes(p[0]));
  assert.deepEqual(runReplyProblems(specWith("json:consonant-count-report.md")), []);
  assert.deepEqual(runReplyUnprinted(specWith("json:reply")), []);
  assert.deepEqual(runReplyUnprinted(specWith("stdout")), []);
});

test("a drafted json:consonant-count-report.md is delivered as json:reply, with no finding and a note, in one call", async () => {
  const { askForSpec } = await import("../scripts/draft.mjs");
  let calls = 0;
  const out = await askForSpec({
    asked: { asked: "v1", said: "count the consonants in a sentence", attached: [], missing_files: [] },
    call: async () => { calls += 1; return JSON.stringify({ spec: specWith("json:consonant-count-report.md"), blanks: [] }); },
  });
  assert.equal(calls, 1);
  assert.equal(out.spec.jobs[0].run.reply, "json:reply");
  assert.ok(!out.findings.some((f) => /run\.reply/.test(f)), JSON.stringify(out.findings));
  assert.match(out.notes, /"json:consonant-count-report\.md".*written as "json:reply"/);
});

test("the drafting instruction says a job's run.reply is json:reply unless its instructions name another member it prints", () => {
  assert.match(INSTRUCTION, /"json:reply"/);
  assert.match(INSTRUCTION, /never the name of a file/);
});
