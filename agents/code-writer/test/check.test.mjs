// The check: whether the harness is done, and what it may not have touched.
//   node --test test/check.test.mjs
//
// Two things are run for real, in a folder that goes away afterwards: a
// stubbed workspace fails round one with the failing tests named, a written
// script passes round two and is delivered as done, a changed test breaks the
// fence and is refused by name, and a used-up ceiling stops the job. The
// rest, the TAP reading, the fence's cases and the verdict's words, is a call
// and an assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { BUILDER_DEFAULT, builderAt, buildRun, fenceOf, suitePaths, tapFailures, tapSummary, verdict } from "../scripts/check.mjs";
import { layOut } from "../scripts/workspace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "check.mjs");

const SPEC = { name: "adder", version: "0.1.0", jobs: [{ slug: "add", offered: true, scripts: ["scripts/add.mjs"] }] };
const SUITE = [{ path: "test/add.test.mjs", text: '// adds\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("two and two are four", () => { assert.equal(add(2, 2), 4); });\ntest("nothing and nothing is nothing", () => { assert.equal(add(0, 0), 0); });\n' }];

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-check-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};
const writable = (p) => { try { chmodSync(p, 0o644); } catch { /* the digest is the fence */ } };

test("each failing test is read by name from the runner's output, and the summary from its end", () => {
  const out = "TAP version 13\nnot ok 1 - two and two are four\n  ---\n  ...\nok 2 - nothing and nothing is nothing\n# Subtest: file\n    not ok 1 - inner one # SKIP\nnot ok 3 - test/add.test.mjs\n# tests 3\n# pass 1\n# fail 2\n# cancelled 0\n";
  assert.deepEqual(tapFailures(out), ["two and two are four", "inner one", "test/add.test.mjs"]);
  assert.deepEqual(tapSummary(out), { tests: 3, pass: 1, fail: 2 });
  assert.deepEqual(tapFailures(""), []);
  assert.equal(tapFailures("not ok 1 - a\n".repeat(60)).length, 1, "a repeated name is listed once");
});

test("the fence: scripts are free, the tests, the spec and the prototype are pinned, and nothing else is added", () => {
  folder((at) => {
    const put = (rel, text) => { mkdirSync(dirname(join(at, rel)), { recursive: true }); writeFileSync(join(at, rel), text); };
    // The fence reads the folder and compares by digest, so the folder is
    // laid out to match the record exactly first.
    const same = { "spec.json": "spec", "test/a.test.mjs": "test", "scripts/a.mjs": "x", "prototype/a.py": "p" };
    for (const [rel, text] of Object.entries(same)) put(rel, text);
    const rec = { digests: { "spec.json": sha("spec"), "test/a.test.mjs": sha("test") }, listing: { "spec.json": sha("spec"), "test/a.test.mjs": sha("test"), "scripts/a.mjs": sha("x"), "prototype/a.py": sha("p") } };
    assert.deepEqual(fenceOf(rec, at), { ok: true, broken: [] });
    put("scripts/a.mjs", "rewritten"); put("scripts/b.mjs", "new");
    assert.deepEqual(fenceOf(rec, at), { ok: true, broken: [] }, "anything under scripts/ is the writer's");
    put("test/a.test.mjs", "changed");
    assert.deepEqual(fenceOf(rec, at).broken, [{ path: "test/a.test.mjs", what: "changed" }]);
    put("test/a.test.mjs", "test");
    put("README.md", "docs");
    assert.deepEqual(fenceOf(rec, at).broken, [{ path: "README.md", what: "added" }]);
    rmSync(join(at, "README.md"));
    put("prototype/a.py", "edited");
    assert.deepEqual(fenceOf(rec, at).broken, [{ path: "prototype/a.py", what: "changed" }]);
    put("prototype/a.py", "p");
    rmSync(join(at, "spec.json"));
    assert.deepEqual(fenceOf(rec, at).broken, [{ path: "spec.json", what: "removed" }]);
  });
});

const sha = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

test("the builder is a path with a default, and its word is read from what it prints", () => {
  assert.equal(builderAt({}), BUILDER_DEFAULT);
  assert.equal(builderAt({ BUILDER: "/x/builder" }), "/x/builder");
  const absent = buildRun({ dir: "/nowhere", builder: "/nowhere/builder" });
  assert.equal(absent.checked, false);
  assert.match(absent.said, /not on this host.*package-maker builds it/);
  folder((at) => {
    const fake = join(at, "builder");
    writeFileSync(fake, "");
    const ok = buildRun({ dir: at, builder: fake, run: () => ({ status: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }) });
    assert.deepEqual([ok.checked, ok.ok, ok.said], [true, true, "The builder takes the package."]);
    // Never "builds" when something was stood in: the reply names the empty files.
    const stood = buildRun({ dir: at, builder: fake, stoodIn: ["references/rules.md"], run: () => ({ status: 0, stdout: JSON.stringify({ ok: true }), stderr: "" }) });
    assert.match(stood.said, /^The builder takes the declaration and the scripts, with 1 file the spec names stood in as empty \(references\/rules\.md\); those are not this job's to write\.$/);
    const no = buildRun({ dir: at, builder: fake, run: () => ({ status: 1, stdout: JSON.stringify({ ok: false, error: "job add: scripts/add.mjs does not exist" }), stderr: "" }) });
    assert.deepEqual([no.checked, no.ok], [true, false]);
    assert.match(no.said, /refuses the package: job add: scripts\/add\.mjs does not exist/);
  });
});

test("the verdict says each thing in words", () => {
  assert.match(verdict({ stop: "ceiling", roundsMax: 30, run: { fail: 2, tests: 9 } }), /^The rounds are used up: 30 of 30, and the suite still fails \(2 of 9\)\. Nothing is delivered\.$/);
  assert.match(verdict({ stop: "fence", fence: { broken: [{ path: "test/a.test.mjs", what: "changed" }] } }), /^The fence was broken: test\/a\.test\.mjs changed\. Put it back/);
  assert.match(verdict({ run: { fails: true, fail: 3, tests: 9 }, round: 4, roundsMax: 30 }), /^Round 4 of 30: 3 of 9 fail\.$/);
  assert.match(verdict({ run: { fails: true, timed_out: true }, round: 1 }), /did not finish in 120 seconds/);
  const done = verdict({ run: { fails: false, pass: 9, tests: 9 }, round: 5, blanks: [{ script: "scripts/a.mjs", noticed: true }, { script: "scripts/b.mjs", noticed: false }], build: { said: "The builder takes the package." } });
  assert.match(done, /^Round 5: the suite passes, 9 of 9\. Blanked one at a time, the suite did not notice scripts\/b\.mjs going missing: nothing tests it, which is the test-writer's to fix, not this job's\. The builder takes the package\.$/);
  assert.match(verdict({ run: { fails: false, pass: 1, tests: 1 }, round: 1, blanks: [{ script: "a", noticed: true }] }), /noticed every one of the 1\./);
});

test("as a process: a stub fails round one with the test named, a written script is done on round two, a changed test breaks the fence, and a used-up ceiling stops it", () => {
  folder((at) => {
    const ws = join(at, "ws");
    const records = join(at, "records");
    const out = layOut({ workspace: ws, spec: SPEC, suite: SUITE });
    mkdirSync(records, { recursive: true });
    writeFileSync(join(records, "workspace.json"), JSON.stringify({ workspace: "v1", folder: ws, rounds_max: 3, ...out }));
    const env = { ...process.env, WORKSPACE: ws, RECORDS: records, BUILDER: join(at, "no-builder-here") };
    const wrong = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, WORKSPACE: "", RECORDS: "" } });
    assert.equal(wrong.status, 2);

    const one = spawnSync("node", [script], { encoding: "utf8", env });
    assert.equal(one.status, 1, one.stderr);
    assert.match(one.stdout, /^Round 1 of 3: 2 of 2 fail\./);
    assert.match(one.stdout, /not ok: two and two are four/);
    let runs = JSON.parse(readFileSync(join(records, "runs.json"), "utf8")).runs;
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].failing, ["two and two are four", "nothing and nothing is nothing"]);
    assert.equal(JSON.parse(readFileSync(join(records, "verdict.json"), "utf8")).done, false);

    writeFileSync(join(ws, "scripts", "add.mjs"), "// adds two numbers\nexport function add(a, b) { return a + b; }\n");
    const two = spawnSync("node", [script], { encoding: "utf8", env });
    assert.equal(two.status, 0, two.stdout + two.stderr);
    assert.match(two.stdout, /^Done\. Round 2: the suite passes, 2 of 2\. Blanked one at a time, the suite noticed every one of the 1\. The builder is not on this host/);
    const v = JSON.parse(readFileSync(join(records, "verdict.json"), "utf8"));
    assert.equal(v.done, true);
    assert.equal(v.round, 2);
    assert.deepEqual(v.unnoticed, []);
    assert.equal(v.build.checked, false);

    const testFile = join(ws, "test", "add.test.mjs");
    writable(testFile);
    writeFileSync(testFile, SUITE[0].text.replace("assert.equal(add(2, 2), 4)", "assert.ok(true)"));
    const three = spawnSync("node", [script], { encoding: "utf8", env });
    assert.equal(three.status, 3);
    assert.match(three.stdout, /^The fence was broken: test\/add\.test\.mjs changed\./);
    runs = JSON.parse(readFileSync(join(records, "runs.json"), "utf8")).runs;
    assert.equal(runs.length, 2, "a refused round is not a round");
    writeFileSync(testFile, SUITE[0].text);

    const four = spawnSync("node", [script], { encoding: "utf8", env });
    assert.equal(four.status, 0, "put back, the fence is whole again");
    const five = spawnSync("node", [script], { encoding: "utf8", env });
    assert.equal(five.status, 4);
    assert.match(five.stdout, /^The rounds are used up: 3 of 3/);
    assert.equal(JSON.parse(readFileSync(join(records, "verdict.json"), "utf8")).stop, "ceiling");
    assert.equal(existsSync(join(ws, "records")), true, "records under the workspace are not part of the fence");
    assert.deepEqual(suitePaths(ws), ["test/add.test.mjs"]);
  });
});
