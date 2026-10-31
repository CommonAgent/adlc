// run.reply is always one the package maker takes (technical debt 652,
// 2026-10-31).
//   node --test test/run-reply.test.mjs
//
// What is worth pinning. In build ab_481ac696b24d8cf8fd (vowel-scale, dev)
// spec-writer 0.6.1 drafted a job whose run.reply was "text:counts". Nothing
// before the package step checks it: the test writer and the code writer
// worked to the spec, the sandbox passed it, and the package maker refused it
// ("job count-vowels: run.reply is 'stdout' or 'json:<member>'; bad:
// 'text:counts'"). There is no way back from Package to the spec, so the build
// could only be stopped. Other builds from the same version wrote "json:reply".
//
// So the rule is the package maker's, named once in build.py
// (RUN_REPLY_STDOUT, RUN_REPLY_MEMBER) and held here by a test that reads it.
// A drafted run.reply outside it is corrected before the person sees the
// spec: one that names a member after the wrong word ("text:counts") replies
// with that member ("json:counts"), anything else replies with what the
// command prints ("stdout"), and the reply says what changed. Where the
// builder is not on the host, the builds step refuses one still outside the
// rule, in the package maker's words, so a spec from anywhere stops before
// the person approves it rather than at Package.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN_REPLY_MEMBER, RUN_REPLY_STDOUT, checkSpec, fitRunReply, runReplyProblems } from "../scripts/check-spec.mjs";
import { checkBuilds } from "../scripts/builds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_PY = join(HERE, "..", "..", "package-maker", "build.py");

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const job = (reply) => ({
  slug: "count-vowels", title: "Count vowels", offered: true, how,
  when: "when somebody wants the vowels in a sentence counted",
  good: "A tally naming each of a, e, i, o and u with how many times it appears in the sentence, and the total of the five, which a reader can count again by hand.",
  empty: "With no sentence it says there was nothing to count.",
  does: "Counts the vowels in a sentence.",
  // Since 0.6.3 a json:<member> is kept only when the job prints it (debt 657).
  instructions: "It prints one JSON object with `reply` and `counts` members.",
  run: { command: ["node", "{home}/{package}/skills/count-vowels/scripts/count.mjs", "--job", "{job_dir}"], ...(reply === undefined ? {} : { reply }) },
});
const specWith = (reply) => ({
  name: "vowel-scale", version: "0.1.0",
  jobs: [job(reply)],
  refuses: Array.from({ length: 4 }, (_, i) => `refusing act ${i}, because it is not this agent's to do, and it says so instead`),
  records: [{ name: "the signed job manifest" }],
  price: { model: "free" },
  systems: [],
});

test("the rule is the package maker's, named once in build.py and used by its run check", () => {
  const py = readFileSync(BUILD_PY, "utf8");
  assert.equal(/^RUN_REPLY_STDOUT = "([^"]+)"$/m.exec(py)?.[1], RUN_REPLY_STDOUT);
  assert.equal(/^RUN_REPLY_MEMBER = "([^"]+)"$/m.exec(py)?.[1], RUN_REPLY_MEMBER);
  assert.equal(RUN_REPLY_STDOUT, "stdout");
  assert.equal(RUN_REPLY_MEMBER, "json:");
  assert.match(py, /if not run_reply_ok\(reply\):/, "the run check reads the named rule");
  assert.doesNotMatch(py, /reply\.startswith\("json:"\)/, "no literal rule is left in build.py");
});

test("a reply that names a member after the wrong word replies with that member, and it is said", () => {
  const got = fitRunReply(specWith("text:counts"));
  assert.equal(got.spec.jobs[0].run.reply, "json:counts");
  assert.match(got.note, /count-vowels/);
  assert.match(got.note, /"text:counts"/);
  assert.match(got.note, /'stdout' or 'json:<member>'/);
  assert.match(got.note, /written as "json:counts"/);
});

test("anything else outside the rule replies with what the command prints; one inside it, or none, is left alone", () => {
  for (const bad of ["text", "json:", "", 5, null, "counts as text"]) {
    const got = fitRunReply(specWith(bad));
    assert.equal(got.spec.jobs[0].run.reply, "stdout", JSON.stringify(bad));
    assert.match(got.note, /written as "stdout"/);
  }
  for (const good of ["stdout", "json:reply", "json:counts"]) {
    const s = specWith(good);
    assert.deepEqual(fitRunReply(s), { spec: s, note: "" });
  }
  const none = specWith(undefined);
  assert.deepEqual(fitRunReply(none), { spec: none, note: "" });
  const noRun = { ...specWith(undefined), jobs: [{ ...job(undefined), run: undefined }] };
  assert.deepEqual(fitRunReply(noRun), { spec: noRun, note: "" });
});

test("check-spec's finding and the builds step's refusal use the package maker's words", () => {
  const p = runReplyProblems(specWith("text:counts"));
  assert.equal(p.length, 1);
  assert.match(p[0], /^job count-vowels: run\.reply is 'stdout' or 'json:<member>'; bad: 'text:counts'/);
  assert.match(p[0], /agent-runtime-requirements\.json/);
  assert.deepEqual(runReplyProblems(specWith("json:reply")), []);
  assert.deepEqual(runReplyProblems(specWith(undefined)), []);
  assert.ok(checkSpec(specWith("text:counts")).includes(p[0]));
});

test("a drafted run.reply of text:counts is delivered as json:counts, with no finding and a note, in one call", async () => {
  const { askForSpec } = await import("../scripts/draft.mjs");
  let calls = 0;
  const out = await askForSpec({
    asked: { asked: "v1", said: "count the vowels in a sentence", attached: [], missing_files: [] },
    call: async () => { calls += 1; return JSON.stringify({ spec: specWith("text:counts"), blanks: [] }); },
  });
  assert.equal(calls, 1);
  assert.equal(out.spec.jobs[0].run.reply, "json:counts");
  assert.ok(!out.findings.some((f) => /run\.reply/.test(f)), JSON.stringify(out.findings));
  assert.match(out.notes, /"text:counts".*written as "json:counts"/);
});

test("where the builder is not on the host, the builds step refuses a run.reply outside the rule and keeps no files", () => {
  const r = checkBuilds({ spec: specWith("text:counts"), env: { BUILD_PY: "/nowhere/build.py" } });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /run\.reply is 'stdout' or 'json:<member>'; bad: 'text:counts'/);
  assert.equal(r.files, undefined);
  const fine = checkBuilds({ spec: specWith("json:counts"), env: { BUILD_PY: "/nowhere/build.py" } });
  assert.equal(fine.ok, null);
  assert.deepEqual(fine.problems, []);
});
