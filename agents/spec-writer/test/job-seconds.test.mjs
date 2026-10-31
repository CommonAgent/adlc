// job_seconds is always one the package maker takes (technical debt 648,
// 2026-10-31).
//   node --test test/job-seconds.test.mjs
//
// What is worth pinning. In build ab_33e1e3fe53252ceed3 (vowel-gauge, dev) the
// model drafted "job_seconds": 30 for a small script job. check-spec named it,
// the second go kept it, the draft stood with the finding, and the finding
// never reached the reply: the reply carries the builder's problems, and the
// builder is not in this agent's container. Test and Code finished, and
// Package refused it ("a whole number of seconds from 60 to 7200; bad: 30").
// It had happened before, to the ping-pong smoke test on 2026-10-03.
//
// So the range is the package maker's, named once in build.py
// (JOB_SECONDS_MIN, JOB_SECONDS_MAX) and held here by a test that reads it.
// A drafted job_seconds outside it is brought to the nearest bound, a value
// that is not a number is taken out (the package maker's default then holds),
// and the reply says what was changed. And where the builder is not on the
// host, the builds step refuses a job_seconds outside the range itself, in the
// package maker's own words, so a spec from anywhere is stopped before
// Package with words the person can act on.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_SECONDS_MAX, JOB_SECONDS_MIN, checkSpec, fitJobSeconds, jobSecondsProblem } from "../scripts/check-spec.mjs";
import { checkBuilds } from "../scripts/builds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_PY = join(HERE, "..", "..", "package-maker", "build.py");

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const SPEC = {
  name: "vowel-gauge", version: "0.1.0",
  jobs: [{ slug: "count-vowels", title: "Count vowels", offered: true, how,
    when: "when somebody wants the vowels in a sentence counted",
    good: "A tally naming each of a, e, i, o and u with how many times it appears in the sentence, and the total of the five, which a reader can count again by hand.",
    empty: "With no sentence it says there was nothing to count.",
    does: "Counts the vowels in a sentence." }],
  refuses: Array.from({ length: 4 }, (_, i) => `refusing act ${i}, because it is not this agent's to do, and it says so instead`),
  records: [{ name: "the signed job manifest" }],
  price: { model: "free" },
  systems: [],
};

test("the range is the package maker's, named once in build.py and used by both of its checks", () => {
  const py = readFileSync(BUILD_PY, "utf8");
  assert.equal(Number(/^JOB_SECONDS_MIN = (\d+)$/m.exec(py)?.[1]), JOB_SECONDS_MIN);
  assert.equal(Number(/^JOB_SECONDS_MAX = (\d+)$/m.exec(py)?.[1]), JOB_SECONDS_MAX);
  assert.equal((py.match(/JOB_SECONDS_MIN <= \w+ <= JOB_SECONDS_MAX/g) ?? []).length, 2, "both checks in build.py read the named range");
  assert.doesNotMatch(py, /60 <= \w+ <= 7200/, "no literal range is left in build.py");
});

test("a job_seconds below the floor is raised to it, one above the cap lowered to it, and each is said", () => {
  const low = fitJobSeconds({ ...SPEC, job_seconds: 30 });
  assert.equal(low.spec.job_seconds, JOB_SECONDS_MIN);
  assert.match(low.note, /job_seconds 30/);
  assert.match(low.note, new RegExp(`${JOB_SECONDS_MIN} to ${JOB_SECONDS_MAX}`));
  assert.match(low.note, new RegExp(`written as ${JOB_SECONDS_MIN}`));
  const high = fitJobSeconds({ ...SPEC, job_seconds: 9000 });
  assert.equal(high.spec.job_seconds, JOB_SECONDS_MAX);
  assert.match(high.note, /written as 7200/);
});

test("a fraction is rounded, a value that is not a number is taken out, and one in range or absent is left alone", () => {
  assert.equal(fitJobSeconds({ ...SPEC, job_seconds: 90.4 }).spec.job_seconds, 90);
  const word = fitJobSeconds({ ...SPEC, job_seconds: "fast" });
  assert.equal("job_seconds" in word.spec, false);
  assert.match(word.note, /taken out/);
  assert.deepEqual(fitJobSeconds({ ...SPEC, job_seconds: 600 }), { spec: { ...SPEC, job_seconds: 600 }, note: "" });
  assert.deepEqual(fitJobSeconds(SPEC), { spec: SPEC, note: "" });
});

test("check-spec's finding and the builds step's refusal use the package maker's words and range", () => {
  const p = jobSecondsProblem({ job_seconds: 30 });
  assert.match(p, /job_seconds is the longest one job may take, a whole number of seconds from 60 to 7200; bad: 30/);
  assert.match(p, /agent-runtime-requirements\.json/);
  assert.equal(jobSecondsProblem({ job_seconds: 60 }), "");
  assert.equal(jobSecondsProblem({}), "");
  assert.ok(checkSpec({ ...SPEC, job_seconds: 30 }).includes(p));
});

test("a drafted job_seconds of 30 is delivered as 60, with no finding and a note, in one call", async () => {
  const { askForSpec } = await import("../scripts/draft.mjs");
  let calls = 0;
  const out = await askForSpec({
    asked: { asked: "v1", said: "count the vowels in a sentence", attached: [], missing_files: [] },
    call: async () => { calls += 1; return JSON.stringify({ spec: { ...SPEC, job_seconds: 30 }, blanks: [] }); },
  });
  assert.equal(calls, 1);
  assert.equal(out.spec.job_seconds, JOB_SECONDS_MIN);
  assert.ok(!out.findings.some((f) => /job_seconds/.test(f)), JSON.stringify(out.findings));
  assert.match(out.notes, /job_seconds 30.*written as 60/);
});

test("where the builder is not on the host, the builds step refuses a job_seconds outside the range and keeps no files", () => {
  const r = checkBuilds({ spec: { ...SPEC, job_seconds: 30 }, env: { BUILD_PY: "/nowhere/build.py" } });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /from 60 to 7200; bad: 30/);
  assert.equal(r.files, undefined);
  const fine = checkBuilds({ spec: { ...SPEC, job_seconds: 60 }, env: { BUILD_PY: "/nowhere/build.py" } });
  assert.equal(fine.ok, null);
  assert.deepEqual(fine.problems, []);
});
