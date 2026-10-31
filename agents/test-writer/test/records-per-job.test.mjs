// Every suite carries the standard check that each job leaves its own records
// (technical debt 639, 2026-10-31).
//   node --test test/records-per-job.test.mjs
//
// What is worth pinning. The host hands every job of an agent the same
// records folder, the agent's own, and keeps it from one job to the next. A
// record the declaration keeps per job (a `file` pattern such as
// `*/went-without.json`, read relative to that folder) belongs in a folder of
// the job's own, named after the job folder. Three agents built on dev wrote
// it straight into the records folder, so each job overwrote the last, and
// the conformance check's records audit found none; their suites never ran
// two jobs, and handed each job a folder of its own as if it were the records
// folder.
//
// So the check is one file, test/records-per-job.test.mjs, whose master copy
// ships in references/ and is added to every suite this writes, never written
// by the model and never answered with. The model's suite runs two jobs of
// the same kind with one records folder and calls its checkRecordsPerJob, and
// a suite whose declaration keeps a record per job and whose tests never call
// it goes back with that finding. The check bites: against a real script that
// writes the record straight into the records folder the suite fails, and
// against one that writes it under the job's own folder it passes.
//
// Nothing here reaches a network or a model; the stand-in and proving runs
// spawn node over scratch folders that are removed whatever happens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECORDS_TEST, NO_RECORDS_CHECK, FORMAT_TEST, askForSuite, askInParts, callsRecordsCheck, declaresPerJobRecords,
  recordsTestAt, refreshStandardTest, staticFindings, withStandardTests, INSTRUCTION,
} from "../scripts/write-suite.mjs";
import { provingRuns, standInRun } from "../scripts/check-suite.mjs";
import { declaredOf } from "../scripts/declared.mjs";
import { checkRecordsPerJob, perJobRecords } from "../references/records-per-job.test.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MASTER = join(HERE, "..", "references", "records-per-job.test.mjs");
const RECORDS_TEXT = readFileSync(MASTER, "utf8");

const SPEC = {
  name: "word-flipper", version: "0.1.0", description: "Gives a sentence's words back in the opposite order.",
  jobs: [{
    slug: "flip-words", title: "Flip the words", offered: true,
    inputs: [{ name: "sentence", kind: "text", required: true, given_by: "person" }],
    outputs: [],
    scripts: ["scripts/flip.mjs"],
  }],
  refuses: ["changing a word"],
  records: [
    { name: "what the job went without, per job", when: "per_task", file: "*/went-without.json" },
    { name: "every sentence it has flipped", when: "standing", file: "flipped.json" },
  ],
};

/** The test a model would write: two jobs, one records folder, then the check. */
const MODEL_TEST = `// The flip script keeps what each job went without in the job's own folder.
//   node --test test/flip.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flip } from "../scripts/flip.mjs";
import { checkRecordsPerJob } from "./records-per-job.test.mjs";

test("two jobs with nothing to flip each leave their own went-without record", () => {
  const at = mkdtempSync(join(tmpdir(), "flip-"));
  try {
    const records = join(at, "records");
    const jobs = [join(at, "job-1"), join(at, "job-2")];
    for (const job of jobs) { mkdirSync(job); flip({ job, records, sentence: "" }); }
    assert.deepEqual(checkRecordsPerJob(records, jobs), []);
  } finally { rmSync(at, { recursive: true, force: true }); }
});

test("a sentence comes back flipped", () => {
  const at = mkdtempSync(join(tmpdir(), "flip-"));
  try {
    const job = join(at, "job-1"); mkdirSync(job);
    assert.equal(flip({ job, records: join(at, "records"), sentence: "a b c" }).reply, "c b a");
  } finally { rmSync(at, { recursive: true, force: true }); }
});
`;

/** A flip script that keeps the went-without note where \`where\` says. */
const script = (where) => `import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
export function flip({ job, records, sentence }) {
  const words = String(sentence ?? "").split(/\\s+/).filter(Boolean);
  if (!words.length) {
    const dir = ${where};
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "went-without.json"), JSON.stringify({ went_without: "v1", entries: [{ wanted: "sentence", did: "said there was nothing to flip" }] }));
    return { reply: "There was nothing to flip." };
  }
  return { reply: words.reverse().join(" ") };
}
`;

const folders = (fn) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-records-"));
  try { return fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const note = (dir) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "went-without.json"), "{}"); };

test("the records check ships among the references, for both skills that write a suite", () => {
  assert.equal(recordsTestAt({}), MASTER);
  const plugin = JSON.parse(readFileSync(join(HERE, "..", "plugin.json"), "utf8"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  for (const slug of ["write-a-suite", "write-the-suite"]) {
    assert.ok(skills[slug].references.includes("references/records-per-job.test.mjs"), `${slug} does not carry it`);
  }
  assert.equal(RECORDS_TEST, "test/records-per-job.test.mjs");
});

test("a record is kept per job when its file pattern starts with a job's folder, and a standing one is not", () => {
  assert.deepEqual(perJobRecords(SPEC).map((r) => [r.name, r.rest]), [["what the job went without, per job", "went-without.json"]]);
  assert.equal(declaresPerJobRecords(declaredOf(SPEC)), true);
  assert.equal(declaresPerJobRecords(declaredOf({ ...SPEC, records: [SPEC.records[1], { name: "the manifest" }] })), false);
  assert.equal(declaresPerJobRecords(declaredOf({ ...SPEC, records: [{ ...SPEC.records[0], when: "standing" }] })), false);
});

test("the checker passes a record under each job's own folder and names one written straight into the records folder", () => {
  folders((at) => {
    const records = join(at, "records");
    const jobs = [join(at, "job-1"), join(at, "job-2")];
    note(join(records, "job-1")); note(join(records, "job-2"));
    assert.deepEqual(checkRecordsPerJob(records, jobs, { declaration: SPEC }), []);
    note(records);
    assert.match(checkRecordsPerJob(records, jobs, { declaration: SPEC }).join(" "), /straight into the records folder/);
  });
});

test("the checker names a job that left no record of its own, and leaves out a record named in except", () => {
  folders((at) => {
    const records = join(at, "records");
    const jobs = [join(at, "job-1"), join(at, "job-2")];
    note(join(records, "job-2"));
    const found = checkRecordsPerJob(records, jobs, { declaration: SPEC });
    assert.equal(found.length, 1);
    assert.match(found[0], /job-1/);
    assert.match(found[0], /went-without\.json/);
    // went-without.json is never left out (test-writer 0.6.2); another record is.
    assert.equal(checkRecordsPerJob(records, jobs, { declaration: SPEC, except: ["*/went-without.json"] }).length, 1);
    const withImage = { ...SPEC, records: [...SPEC.records, { name: "an image", when: "per_task", file: "*/image.json" }] };
    assert.equal(checkRecordsPerJob(records, jobs, { declaration: withImage, except: ["an image"] }).length, 1);
    assert.equal(checkRecordsPerJob(records, jobs, { declaration: withImage, except: ["*/image.json"] }).length, 1);
  });
});

test("one job, or two jobs in folders of the same name, cannot show that the next job keeps its record", () => {
  folders((at) => {
    const records = join(at, "records");
    note(join(records, "job"));
    assert.match(checkRecordsPerJob(records, [join(at, "job")], { declaration: SPEC }).join(" "), /two job folders/);
    assert.match(checkRecordsPerJob(records, [join(at, "a", "job"), join(at, "b", "job")], { declaration: SPEC }).join(" "), /same name/);
  });
});

test("a declaration with no per-job record has nothing for the checker to hold", () => {
  folders((at) => {
    assert.deepEqual(checkRecordsPerJob(join(at, "records"), [join(at, "a"), join(at, "b")], { declaration: { records: [SPEC.records[1]] } }), []);
  });
});

test("the records check is added to a suite once, beside the format check", () => {
  const one = [{ path: "test/a.test.mjs", text: "x" }];
  assert.deepEqual(withStandardTests(one, { formatTest: "f", recordsTest: RECORDS_TEXT }).map((f) => f.path), ["test/a.test.mjs", FORMAT_TEST, RECORDS_TEST]);
  const has = [...one, { path: RECORDS_TEST, text: "kept" }];
  assert.deepEqual(withStandardTests(has, { recordsTest: RECORDS_TEXT }), has);
});

test("a suite being added to gets the current records check, and keeps one that is already the same bytes", () => {
  const other = { path: "test/a.test.mjs", text: "x" };
  const r = refreshStandardTest([other, { path: RECORDS_TEST, text: "an older copy" }], RECORDS_TEST, RECORDS_TEXT);
  assert.deepEqual(r.existing, [other]);
  assert.deepEqual(r.generated, [{ path: RECORDS_TEST, text: RECORDS_TEXT }]);
  const same = { path: RECORDS_TEST, text: RECORDS_TEXT };
  assert.deepEqual(refreshStandardTest([other, same], RECORDS_TEST, RECORDS_TEXT), { existing: [other, same], generated: [] });
});

test("the model is told the records folder is the agent's own, to run two jobs, and never to write the check", () => {
  assert.match(INSTRUCTION, /same records folder, the agent's own/);
  assert.match(INSTRUCTION, /<records>\/<the job folder's name>\/went-without\.json/);
  assert.match(INSTRUCTION, /test\/records-per-job\.test\.mjs, which the test writer adds itself\. Do not write it/);
  assert.match(INSTRUCTION, /import \{ checkRecordsPerJob \} from "\.\/records-per-job\.test\.mjs"/);
});

test("a suite that never calls the records check, for a spec with a per-job record, is a finding; one that calls it is not", () => {
  const declared = declaredOf(SPEC);
  const without = [{ path: "test/flip.test.mjs", text: MODEL_TEST.replace(/checkRecordsPerJob/g, "nothing") }];
  assert.ok(staticFindings(without, declared, { recordsCheck: true }).includes(NO_RECORDS_CHECK));
  const withIt = [{ path: "test/flip.test.mjs", text: MODEL_TEST }];
  assert.equal(callsRecordsCheck(withIt), true);
  assert.ok(!staticFindings(withIt, declared, { recordsCheck: true }).includes(NO_RECORDS_CHECK));
});

test("an answer that writes the records check itself is told it is the test writer's", () => {
  const found = staticFindings([{ path: RECORDS_TEST, text: RECORDS_TEXT }, { path: "test/flip.test.mjs", text: MODEL_TEST }], declaredOf(SPEC));
  assert.match(found.join(" "), /records-per-job\.test\.mjs is written by the test writer itself/);
});

test("the second ask carries the missing records check, and the stand-in run gets the check beside the suite", async () => {
  const sent = []; const ran = [];
  const answer = (text) => `<<<FILE test/flip.test.mjs>>>\n${text}<<<END>>>`;
  const out = await askForSuite({
    declared: declaredOf(SPEC), spec: SPEC, recordsTest: RECORDS_TEXT,
    call: async (request) => {
      sent.push(request.body.contents[0].parts.map((p) => p.text).join("\n"));
      return answer(sent.length === 1 ? MODEL_TEST.replace(/checkRecordsPerJob/g, "nothing") : MODEL_TEST);
    },
    run: async (files) => { ran.push(files.map((f) => f.path)); return { tests: 2, pass: 0, fail: 2, fails: true, status: 1 }; },
  });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /no test calls checkRecordsPerJob/);
  assert.deepEqual(out.findings, []);
  assert.deepEqual(ran, [["test/flip.test.mjs", RECORDS_TEST]]);
});

test("a suite in parts is held to the records check over the whole suite", async () => {
  const spec = { ...SPEC, jobs: [{ ...SPEC.jobs[0], scripts: ["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs", "scripts/d.mjs"] }] };
  const file = (n) => `<<<FILE test/${n}.test.mjs>>>\n// ${n}\nimport { test } from "node:test";\nimport { ${n} } from "../scripts/${n}.mjs";\ntest("${n} answers", () => ${n}());\ntest("${n} answers twice", () => ${n}());\n<<<END>>>`;
  const out = await askInParts({
    declared: declaredOf(spec), spec, recordsTest: RECORDS_TEXT, size: 3,
    call: async (request) => {
      const text = request.body.contents[0].parts.map((p) => p.text).join("\n");
      const mine = ["a", "b", "c", "d"].filter((n) => new RegExp(`^- scripts/${n}\\.mjs$`, "m").test(text));
      return mine.map(file).join("\n");
    },
  });
  assert.ok(out.findings.includes(`the whole suite: ${NO_RECORDS_CHECK}`), JSON.stringify(out.findings));
});

test("the check bites: a record written straight into the records folder fails the suite, and one under the job's folder passes it", () => {
  folders((at) => {
    const files = withStandardTests([{ path: "test/flip.test.mjs", text: MODEL_TEST }], { recordsTest: RECORDS_TEXT });
    // Against nothing it fails, as every suite must.
    assert.ok(standInRun({ spec: SPEC, files }).fails);
    const pkg = (name, where) => {
      const dir = join(at, name);
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "scripts", "flip.mjs"), script(where));
      writeFileSync(join(dir, "spec.json"), JSON.stringify(SPEC));
      return dir;
    };
    const good = provingRuns({ spec: SPEC, files, realDir: pkg("good", "join(records, basename(job))") });
    assert.equal(good.real.fails, false, JSON.stringify(good.real));
    assert.equal(good.mutations[0].noticed, true);
    const flat = provingRuns({ spec: SPEC, files, realDir: pkg("flat", "records") });
    assert.equal(flat.real.fails, true, "a record written straight into the records folder passed");
  });
});
