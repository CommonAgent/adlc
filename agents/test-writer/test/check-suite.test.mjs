// The checking step: a suite is proved by running it, against nothing and
// against something.
//   node --test test/check-suite.test.mjs
//
// Two things are worth pinning and both are run for real, in a folder that
// goes away afterwards: that a suite which imports from the scripts fails
// against empty stand-ins while one that imports nothing passes, which is the
// whole reason the stand-in run exists; and that against a real package the
// suite passes and blanking the script it tests is noticed. Everything else,
// the TAP summary, the path rules and the verdict's wording, is a call and an
// assertion, with node's spawn handed in where a real run is not the point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  RUN_SECONDS, copyPackage, placeSuite, provingRuns, runSuite, scriptsOf, standInPackage, standInRun, staysInside,
  suiteFiles, tapSummary, verdict,
} from "../scripts/check-suite.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "check-suite.mjs");

const SPEC = { name: "adder", version: "0.1.0", jobs: [{ slug: "add", offered: true, scripts: ["scripts/add.mjs"] }, { slug: "x", scripts: ["scripts/add.mjs"] }] };
const REAL_ADD = "export function add(a, b) { return a + b; }\n";
const SUITE_THAT_IMPORTS = {
  path: "test/add.test.mjs",
  text: '// adds\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("two and two are four", () => { assert.equal(add(2, 2), 4); });\n',
};
const SUITE_THAT_IMPORTS_NOTHING = {
  path: "test/nothing.test.mjs",
  text: '// asserts nothing about the scripts\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("one is one", () => { assert.equal(1, 1); });\n',
};

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-check-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

test("scripts are listed once, in the order named, and a path that climbs out is refused before anything is written", () => {
  assert.deepEqual(scriptsOf(SPEC), ["scripts/add.mjs"]);
  assert.deepEqual(scriptsOf({ jobs: [] }), []);
  assert.equal(staysInside("scripts/a.mjs"), true);
  assert.equal(staysInside("../a.mjs"), false);
  assert.equal(staysInside("scripts/../../a.mjs"), false);
  assert.equal(staysInside("/etc/a.mjs"), false);
  assert.equal(staysInside("C:\\a.mjs"), false);
  assert.equal(staysInside(""), false);
  folder((at) => {
    assert.throws(() => standInPackage({ jobs: [{ slug: "a", scripts: ["../escape.mjs"] }] }, at), /outside the package/);
    assert.equal(existsSync(join(at, "..", "escape.mjs")), false, "nothing was written first");
  });
});

test("a stand-in package is an empty file where every script would be, with the spec beside them", () => {
  folder((at) => {
    const scripts = standInPackage({ ...SPEC, jobs: [{ slug: "a", scripts: ["scripts/add.mjs", "scripts/deep/one.mjs"] }] }, at);
    assert.deepEqual(scripts, ["scripts/add.mjs", "scripts/deep/one.mjs"]);
    assert.equal(readFileSync(join(at, "scripts", "add.mjs"), "utf8"), "");
    assert.equal(readFileSync(join(at, "scripts", "deep", "one.mjs"), "utf8"), "");
    assert.equal(JSON.parse(readFileSync(join(at, "spec.json"), "utf8")).name, "adder");
  });
});

test("a suite file must be test/<name>.test.mjs, and the files under a folder are read back in order", () => {
  folder((at) => {
    assert.throws(() => placeSuite([{ path: "scripts/add.mjs", text: "" }], at), /must be test\/<name>\.test\.mjs/);
    assert.throws(() => placeSuite([{ path: "test/../x.test.mjs", text: "" }], at), /must be test\/<name>\.test\.mjs/);
    assert.throws(() => placeSuite([{ path: "test/a.mjs", text: "" }], at), /must be test\/<name>\.test\.mjs/);
    assert.deepEqual(placeSuite([{ path: "test/b.test.mjs", text: "// b\n" }, { path: "test/a.test.mjs", text: "// a\n" }], at), ["test/b.test.mjs", "test/a.test.mjs"]);
    assert.deepEqual(suiteFiles(at).map((f) => f.path), ["test/a.test.mjs", "test/b.test.mjs"]);
    assert.deepEqual(suiteFiles(join(at, "nowhere")), []);
  });
});

test("the TAP summary is read from the end, and a run with nothing counted is a failure", () => {
  assert.deepEqual(tapSummary("ok 1 - a\n# tests 3\n# suites 0\n# pass 2\n# fail 1\n# cancelled 0\n"), { tests: 3, pass: 2, fail: 1 });
  assert.deepEqual(tapSummary("# tests 2\n# pass 1\n# fail 0\n# cancelled 1\n"), { tests: 2, pass: 1, fail: 1 }, "a cancelled test did not pass");
  assert.deepEqual(tapSummary("SyntaxError: nope"), { tests: 0, pass: 0, fail: 0 });
  const spawn = (cmd, args, opts) => {
    assert.equal(cmd, "node");
    assert.deepEqual(args.slice(0, 2), ["--test", "--test-reporter=tap"]);
    assert.equal(opts.timeout, RUN_SECONDS * 1000);
    return { status: 1, stdout: "SyntaxError: nope", stderr: "" };
  };
  const r = runSuite("/nowhere", ["test/a.test.mjs"], { spawn });
  assert.equal(r.fails, true, "nothing counted and a bad status is a suite that did not load");
  assert.equal(r.tests, 0);
  const clean = runSuite("/nowhere", ["test/a.test.mjs"], { spawn: () => ({ status: 0, stdout: "# tests 5\n# pass 5\n# fail 0\n", stderr: "" }) });
  assert.equal(clean.fails, false);
  const hung = runSuite("/nowhere", ["test/a.test.mjs"], { spawn: () => ({ status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } }) });
  assert.equal(hung.timed_out, true);
  assert.equal(hung.fails, true);
});

test("against empty stand-ins a suite that imports a function fails, and one that imports nothing passes", () => {
  // Run for real: this is the check the writing step is held to, and a
  // handed-in spawn would prove nothing about it.
  const imports = standInRun({ spec: SPEC, files: [SUITE_THAT_IMPORTS] });
  assert.equal(imports.against, "stand-ins");
  assert.equal(imports.scripts, 1);
  assert.equal(imports.fails, true, imports.tail);
  const nothing = standInRun({ spec: SPEC, files: [SUITE_THAT_IMPORTS_NOTHING] });
  assert.equal(nothing.fails, false, nothing.tail);
  assert.equal(nothing.tests, 1);
  assert.equal(nothing.pass, 1);
});

test("against a real package the suite passes, and blanking the script it tests is noticed", () => {
  folder((at) => {
    const pkg = join(at, "adder");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    mkdirSync(join(pkg, "test"), { recursive: true });
    writeFileSync(join(pkg, "scripts", "add.mjs"), REAL_ADD);
    writeFileSync(join(pkg, "spec.json"), JSON.stringify(SPEC));
    // The package's own test folder is not what is being proved, so it is
    // left behind by the copy.
    writeFileSync(join(pkg, "test", "old.test.mjs"), 'import { test } from "node:test";\ntest("old", () => { throw new Error("must not run"); });\n');
    const copy = join(at, "copy");
    copyPackage(pkg, copy);
    assert.equal(existsSync(join(copy, "scripts", "add.mjs")), true);
    assert.equal(existsSync(join(copy, "test", "old.test.mjs")), false, "the old suite does not come along");
    const { real, mutations } = provingRuns({ spec: SPEC, files: [SUITE_THAT_IMPORTS], realDir: pkg });
    assert.equal(real.against, "adder");
    assert.equal(real.fails, false, real.tail);
    assert.equal(real.tests, 1);
    assert.deepEqual(mutations.map((m) => [m.script, m.noticed]), [["scripts/add.mjs", true]]);
    // And a suite that imports nothing notices nothing.
    const blind = provingRuns({ spec: SPEC, files: [SUITE_THAT_IMPORTS_NOTHING], realDir: pkg });
    assert.equal(blind.real.fails, false);
    assert.deepEqual(blind.mutations.map((m) => m.noticed), [false]);
  });
});

test("the verdict says each thing in words, and names the script nothing tests", () => {
  const failsStandIns = { scripts: 4, tests: 1, pass: 0, fail: 1, fails: true };
  assert.match(verdict({ standIns: failsStandIns }), /^Against empty stand-ins for the 4 scripts it names, the suite fails \(0 of 1 pass\), which is what a suite written before the scripts must do\.$/);
  assert.match(verdict({ standIns: { scripts: 1, tests: 3, pass: 3, fail: 0, fails: false } }), /the suite passes \(3 of 3\), so it asserts nothing about them\. It is not a suite yet\./);
  assert.match(verdict({ standIns: { scripts: 1, timed_out: true, fails: true } }), /did not finish in 120 seconds, which is a fault in the suite/);
  const real = { against: "publisher", tests: 25, pass: 25, fail: 0, fails: false };
  assert.match(verdict({ real }), /^Against publisher's own scripts, all 25 pass\.$/);
  assert.match(verdict({ real: { ...real, pass: 23, fail: 2, fails: true } }), /2 of 25 fail\. The failures are the script owner's to read; nothing here changed a test to make them pass\./);
  const noticed = [{ script: "scripts/a.mjs", noticed: true }, { script: "scripts/b.mjs", noticed: true }];
  assert.match(verdict({ mutations: noticed }), /Broken one script at a time, the suite noticed every one of the 2\./);
  const missed = [{ script: "scripts/a.mjs", noticed: true }, { script: "scripts/b.mjs", noticed: false }, { script: "scripts/c.mjs", noticed: false }];
  assert.match(verdict({ mutations: missed }), /did not notice scripts\/b\.mjs, scripts\/c\.mjs going missing: nothing tests them\./);
  assert.match(verdict({ mutations: [missed[1]] }), /nothing tests it\./);
  const whole = verdict({ standIns: failsStandIns, real, mutations: noticed });
  assert.ok(whole.indexOf("stand-ins") < whole.indexOf("own scripts") && whole.indexOf("own scripts") < whole.indexOf("Broken"));
  assert.equal(verdict({}), "");
});

test("as a process it exits 2 when called wrong, 3 when there is no suite, and writes the record when there is", () => {
  const wrong = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, SUITE: "", SPEC: "", RECORDS: "" } });
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /SUITE, SPEC and RECORDS are required/);
  folder((at) => {
    const specPath = join(at, "spec.json");
    writeFileSync(specPath, JSON.stringify(SPEC));
    const empty = join(at, "empty");
    mkdirSync(empty);
    const none = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, SUITE: empty, SPEC: specPath, RECORDS: join(at, "r1"), AGAINST: "" } });
    assert.equal(none.status, 3);
    assert.match(JSON.parse(none.stdout).reply, /no suite under/);
    const suite = join(at, "suite");
    placeSuite([SUITE_THAT_IMPORTS], suite);
    const records = join(at, "r2");
    const ok = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, SUITE: suite, SPEC: specPath, RECORDS: records, AGAINST: "" } });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /the suite fails/);
    const rec = JSON.parse(readFileSync(join(records, "checked.json"), "utf8"));
    assert.equal(rec.checked, "v1");
    assert.equal(rec.stand_ins.fails, true);
    assert.equal(rec.real, null);
    assert.deepEqual(rec.mutations, []);
    assert.equal(rec.verdict, ok.stdout.trim());
  });
});
