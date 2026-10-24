// The delivery check the host runs, against real job folders.
//   node --test test/verify.test.mjs
//
// Each case lays out a job folder the way the adapter does (the spec and the
// suite under in/ with the inbound prefix on each name, the delivery under
// out/scripts) and asks verify what it makes of it. Nothing the harness
// could have written under the job folder (a verdict, a runs record, its own
// workspace) is read, so a folder full of claims and no scripts is refused
// the same as an empty one. The script's own command-line shape is run once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verify, whatCameIn, whatWentOut } from "../scripts/verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "verify.mjs");

const SPEC = { name: "adder", version: "0.1.0", jobs: [{ slug: "add", offered: true, scripts: ["scripts/add.mjs", "scripts/sub.mjs"] }] };
const SUITE = '// adds and subtracts\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\nimport { sub } from "../scripts/sub.mjs";\ntest("two and two are four", () => { assert.equal(add(2, 2), 4); });\ntest("four less one is three", () => { assert.equal(sub(4, 1), 3); });\n';
const ADD = "export const add = (a, b) => a + b;\n";
const SUB = "export const sub = (a, b) => a - b;\n";

/** A job folder: what came in, and what went out. */
function job({ spec = SPEC, suite = SUITE, out = { "add.mjs": ADD, "sub.mjs": SUB }, extra = {} } = {}) {
  const at = mkdtempSync(join(tmpdir(), "code-writer-verify-test-"));
  mkdirSync(join(at, "in"), { recursive: true });
  if (spec) writeFileSync(join(at, "in", "0-Ab3dEf9h-spec.json"), JSON.stringify(spec));
  if (suite) writeFileSync(join(at, "in", "1-Zy8xWv7u-add.test.mjs"), suite);
  if (out) {
    mkdirSync(join(at, "out", "scripts"), { recursive: true });
    for (const [name, text] of Object.entries(out)) writeFileSync(join(at, "out", "scripts", name), text);
  }
  for (const [rel, text] of Object.entries(extra)) { mkdirSync(dirname(join(at, rel)), { recursive: true }); writeFileSync(join(at, rel), text); }
  return at;
}
const withJob = (opts, body) => { const at = job(opts); try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); } };

test("files that travelled through the process runner, named by piece label with two prefixes and no extension, are told apart by content", () => {
  withJob({ spec: null, suite: null, extra: {
    "in/0-qHW-qM6g-0-ZChxASLw-spec": JSON.stringify(SPEC),
    "in/2-8Sx6cOng-0-BTKu3WIg-suite_test_file": SUITE,
    "in/3-uOB3heDQ-1-8eVth_OA-suite_details": "28 tests in one file\n",
  } }, (at) => {
    const seen = whatCameIn(at);
    assert.equal(seen.spec?.name, "adder");
    assert.deepEqual(seen.suite.map((f) => f.path), ["test/suite_test_file.test.mjs", "test/suite_details"], "the note that came with the suite is staged beside it");
    const v = verify(at);
    assert.equal(v.ok, true, v.said);
  });
});

test("a helper that arrived with the suite is staged beside the tests, and the delivery is checked with it in place", () => {
  const helperSuite = '// adds\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\nimport { sub } from "../scripts/sub.mjs";\nimport { four } from "./helpers.mjs";\ntest("two and two are four", () => { assert.equal(add(2, 2), four()); });\ntest("four less one is three", () => { assert.equal(sub(4, 1), 3); });\n';
  withJob({ spec: null, suite: null, extra: {
    "in/0-qHW-qM6g-spec.json": JSON.stringify(SPEC),
    "in/1-8Sx6cOng-add.test.mjs": helperSuite,
    "in/2-uOB3heDQ-helpers.mjs": "export const four = () => 4;\n",
    "in/3-M5PShlMA-job-manifest.json": JSON.stringify({ format: "job-manifest-v1", pieces: [] }),
  } }, (at) => {
    const seen = whatCameIn(at);
    assert.deepEqual(seen.suite.map((f) => f.path).sort(), ["test/add.test.mjs", "test/helpers.mjs"], "the manifest is not staged, the helper is");
    const v = verify(at);
    assert.equal(v.ok, true, v.said);
    assert.equal(v.pass, 2);
  });
});

test("a reference or asset the spec names is laid out from the file that came in by that name, and stood in as empty only when none came", () => {
  // explainer-maker, 2026-09-28: its scripts read their own assets/frame.html
  // and its suite reads sample/script.json, and a check that stood both in as
  // empty refused every honest delivery.
  const spec = { ...SPEC, jobs: [{ ...SPEC.jobs[0], assets: ["sample/numbers.json"] }] };
  const suite = '// adds the sample\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { add } from "../scripts/add.mjs";\nimport { sub } from "../scripts/sub.mjs";\nconst n = JSON.parse(readFileSync(new URL("../sample/numbers.json", import.meta.url), "utf8"));\ntest("the sample adds up", () => { assert.equal(add(n.a, n.b), 4); });\ntest("and takes away", () => { assert.equal(sub(n.b, 1), 1); });\n';
  withJob({ spec, suite, extra: { "in/4-Qw7eRt5y-numbers.json": JSON.stringify({ a: 2, b: 2 }) } }, (at) => {
    const v = verify(at);
    assert.equal(v.ok, true, v.said);
    assert.equal(v.pass, 2);
  });
  withJob({ spec, suite }, (at) => {
    assert.equal(verify(at).ok, false, "with no file of that name, the asset is empty and the suite that reads it fails");
  });
});

test("what came in is the spec and the suite, with the inbound prefix taken off the suite's name", () => {
  withJob({}, (at) => {
    const seen = whatCameIn(at);
    assert.equal(seen.spec.name, "adder");
    assert.deepEqual(seen.suite.map((f) => f.path), ["test/add.test.mjs"]);
    assert.deepEqual(whatWentOut(at).map((f) => f.path), ["scripts/add.mjs", "scripts/sub.mjs"]);
  });
});

test("a delivery the suite passes against is accepted, and every script is one the suite notices missing", () => {
  withJob({}, (at) => {
    const v = verify(at);
    assert.equal(v.ok, true, v.said);
    assert.equal(v.pass, 2);
    assert.match(v.said, /passes against the delivered scripts, 2 of 2/);
    assert.match(v.said, /noticed every one of the 2/);
  });
});

test("a job folder full of the harness's own claims and no scripts is refused, and the claims are not read", () => {
  const claims = {
    "out/verdict.json": JSON.stringify({ done: true, tests: 28, pass: 28 }),
    "out/runs.jsonl": JSON.stringify({ round: 1, pass: 28, fail: 0 }) + "\n",
    "tests/add.test.mjs": SUITE,
    "tests/scripts/add.mjs": ADD,
  };
  withJob({ out: null, extra: claims }, (at) => {
    const v = verify(at);
    assert.equal(v.ok, false);
    assert.match(v.said, /no scripts were delivered under out\/scripts; the spec names 2: scripts\/add\.mjs, scripts\/sub\.mjs/);
  });
});

test("a delivery missing one of the scripts the spec names is refused by name", () => {
  withJob({ out: { "add.mjs": ADD } }, (at) => {
    const v = verify(at);
    assert.equal(v.ok, false);
    assert.match(v.said, /missing 1 of the 2 scripts the spec names: scripts\/sub\.mjs/);
  });
});

test("a delivery the suite fails against is refused with the failing tests named", () => {
  withJob({ out: { "add.mjs": ADD, "sub.mjs": "export const sub = (a, b) => a + b;\n" } }, (at) => {
    const v = verify(at);
    assert.equal(v.ok, false);
    assert.match(v.said, /the suite fails against the delivered scripts, 1 of 2: four less one is three/);
  });
});

test("nothing to check against is said plainly: no spec, or no suite", () => {
  withJob({ spec: null }, (at) => assert.match(verify(at).said, /nothing under in\/ is a spec/));
  withJob({ suite: null }, (at) => assert.match(verify(at).said, /no test file came in with the spec/));
});

test("run as the host runs it, it prints one JSON line and exits 0 only when the delivery is accepted", () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
  // The host runs this suite from inside verify.mjs when the delivery is this
  // package's own, with JOB_DIR set to the real job: inherited, the last case
  // below verified that job again, which ran this suite again, until the
  // host's time limit (2026-09-28).
  delete env.JOB_DIR;
  withJob({}, (at) => {
    const r = spawnSync(process.execPath, [script], { env: { ...env, JOB_DIR: at }, encoding: "utf8", timeout: 120_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doc = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    assert.equal(doc.ok, true);
  });
  withJob({ out: null }, (at) => {
    const r = spawnSync(process.execPath, [script], { env: { ...env, JOB_DIR: at }, encoding: "utf8", timeout: 120_000 });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout.trim().split(/\r?\n/).pop()).ok, false);
  });
  const r = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.equal(r.status, 2, "JOB_DIR is required");
});
