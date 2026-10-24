// The job as one command: the spec found by content, the steps in order, the
// pieces filed by pieces.mjs and nobody else.
//   node --test test/job.test.mjs
//
// The steps are stood in by a fake spawn that records which script ran with
// which variables and answers what each script prints, so this holds the
// driver's order and its reading of each answer, not the steps themselves,
// which have suites of their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { findSpec, looksLikeSpecText, parseArgs, runJob } from "../scripts/job.mjs";

const SPEC = JSON.stringify({ name: "adder", version: "0.1.0", jobs: [{ slug: "add", scripts: ["scripts/add.mjs"] }] });

function fakeSpawn(answers, ran = []) {
  return (bin, argv, opts) => {
    const script = basename(argv[0]);
    ran.push({ script, env: opts.env });
    const a = answers[script] ?? { ok: true, code: 0 };
    return { status: a.code ?? 0, stdout: `noise\n${JSON.stringify(a)}\n`, stderr: "" };
  };
}

test("the spec is found by content among files named by piece label with prefixes and no extension", () => {
  const files = [
    { path: "/in/1-n2Auly9Q-1-630zhBvg-job-manifest.json" },
    { path: "/in/0-qHW-qM6g-0-ZChxASLw-spec" },
    { path: "/in/3-uOB3heDQ-notes" },
  ];
  const texts = { "/in/1-n2Auly9Q-1-630zhBvg-job-manifest.json": JSON.stringify({ name: "x", jobs: [{ slug: "y" }] }), "/in/0-qHW-qM6g-0-ZChxASLw-spec": SPEC, "/in/3-uOB3heDQ-notes": "hello" };
  assert.equal(findSpec(files, (p) => texts[p]), "/in/0-qHW-qM6g-0-ZChxASLw-spec", "the manifest is skipped by name, the spec found by content");
  assert.equal(looksLikeSpecText("{}"), false);
  assert.equal(looksLikeSpecText("not json"), false);
});

test("the four steps run in order with the job's own records and work folders, then the pieces are filed, and the reply is reply.mjs's", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-writer-job-"));
  try {
    const spec = join(dir, "0-abcdefgh-spec"); writeFileSync(spec, SPEC);
    const ran = [];
    const spawn = fakeSpawn({ "reply.mjs": { ok: true, code: 0, reply: "Wrote 2 tests in 1 file for adder 0.1.0." }, "pieces.mjs": { ok: true } }, ran);
    const out = runJob({ job: join(dir, "job-1"), records: join(dir, "records"), work: join(dir, "work"), files: [{ path: spec }], spawn });
    assert.equal(out.ok, true);
    assert.equal(out.reply, "Wrote 2 tests in 1 file for adder 0.1.0.");
    assert.deepEqual(ran.map((r) => r.script), ["declared.mjs", "write-suite.mjs", "check-suite.mjs", "reply.mjs", "pieces.mjs"]);
    assert.equal(ran[0].env.SPEC, spec);
    assert.equal(ran[0].env.RECORDS, join(dir, "records", "job-1"));
    assert.equal(ran[1].env.WORK, join(dir, "work", "job-1"));
    assert.equal(ran[1].env.DECLARED, join(dir, "records", "job-1", "declared.json"));
    assert.equal(ran[2].env.SUITE, join(dir, "work", "job-1"));
    assert.equal(ran[4].env.JOB_DIR, join(dir, "job-1"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no spec among the files is said in the reply and nothing runs; a step's exit 3 stops the job with that step's words", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-writer-job-"));
  try {
    const ran = [];
    const none = runJob({ job: join(dir, "j"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: join(dir, "missing") }], spawn: fakeSpawn({}, ran) });
    assert.equal(none.ok, false);
    assert.match(none.reply, /Nothing attached is the agent.s files or a spec/);
    assert.equal(ran.length, 0);
    const spec = join(dir, "spec.json"); writeFileSync(spec, SPEC);
    const stopped = runJob({ job: join(dir, "j"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: spec }], spawn: fakeSpawn({ "declared.mjs": { ok: false, code: 3, reply: "That is not a spec." } }, ran) });
    assert.equal(stopped.reply, "That is not a spec.");
    assert.deepEqual(ran.map((r) => r.script), ["declared.mjs"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the command line is read the way the run declaration writes it", () => {
  const o = parseArgs(["--job", "/j", "--records", "/r", "--work", "/w", "--text-file", "/j/message.txt", "--file", "/in/a::application/json", "--file", "/in/b"]);
  assert.equal(o.job, "/j");
  assert.deepEqual(o.files, [{ path: "/in/a", media_type: "application/json" }, { path: "/in/b", media_type: "" }]);
});
