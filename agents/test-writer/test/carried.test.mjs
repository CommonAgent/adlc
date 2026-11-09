// The original's own tests are carried into the suite (test-writer 0.10.0).
//   node --test test/carried.test.mjs
//
// What is pinned, on the made-up write-up in test/fixtures/carried/: an echo
// agent's own test, which imports a matcher at its repository's top, which
// imports a plan, which imports agreements, which import a table (a closure
// three files deep below the one the test imports):
// - the carried manifest is found by content under any name, and each file
//   by its digest, under the names the hops gave it;
// - the test goes to test/<its name> with only the import specifier the
//   manifest lists rewritten, to ./support/<path from the repository's top>,
//   and the check that nothing else changed is made the other way round;
// - every support file goes to test/support/<the same path>, byte for byte,
//   so the imports between them work unchanged: the placed suite runs and
//   passes against the agent's script;
// - a test the manifest lists that did not come, a support file missing, and
//   a test that sat deeper in the codebase are said as gaps;
// - the record the suite carries finds the tests again in a revision, by
//   digest, and an original sent again beside it is taken;
// - only the person drops a carried test, by naming it, and the drop is
//   recorded;
// - every test loads: node --check, and no CommonJS name an ES module lacks.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CARRIED_RECORD, carriedAmong, carriedWords, changedBeyondImports, commonJsNamesUsed, dropsAsked,
  loadProblems, placeCarried, placedName, rewriteImports, sha256, supportSpecifier,
} from "../scripts/carried.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "carried");
const WRITE_UP = join(FIXTURE, "write-up");
const ORIGINAL = readFileSync(join(WRITE_UP, "tests", "test", "echo.test.mjs"), "utf8");
const SUPPORT = ["support/lib/match-reply.mjs", "support/lib/plan.mjs", "support/lib/agreements.mjs", "support/lib/words/table.mjs"];

const folders = async (fn) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-carried-"));
  try { return await fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
};
const bytes = (p) => readFileSync(p);

/** The manifest Product Factory makes from the write-up's carried list. */
const manifest = ({ withDigests = true } = {}) => ({
  carried_tests: "v1",
  tests: [{
    file: "test/echo.test.mjs", at: "tests/test/echo.test.mjs",
    ...(withDigests ? { sha256: sha256(bytes(join(WRITE_UP, "tests", "test", "echo.test.mjs"))) } : {}),
    imports: [{ from: "../../../lib/match-reply.mjs", support: "support/lib/match-reply.mjs" }],
  }],
  support: SUPPORT.map((p) => ({ path: p, ...(withDigests ? { sha256: sha256(bytes(join(WRITE_UP, p))) } : {}) })),
});

/** The write-up's files as attachments, named the way pieces arrive: a
 *  prefix per hop and no folders. */
function attach(dir, { leave = [], doc = manifest() } = {}) {
  const files = [];
  const put = (from, sent, text) => {
    const at = join(dir, `${files.length}-Zx81Qa0b-${sent}`);
    if (text !== undefined) writeFileSync(at, text); else cpSync(from, at);
    files.push({ path: at });
  };
  put(null, "carried", JSON.stringify(doc));
  put(join(WRITE_UP, "tests", "test", "echo.test.mjs"), "echo.test.mjs");
  for (const p of SUPPORT) if (!leave.includes(p)) put(join(WRITE_UP, p), p.split("/").pop());
  return files;
}

test("the manifest is found by content, each file by its digest, and the test placed with only its listed import rewritten", async () => {
  await folders(async (dir) => {
    const files = attach(dir);
    const found = carriedAmong(files, bytes);
    assert.equal(found.kind, "manifest");
    const got = placeCarried({ found, files, readBytes: bytes });
    assert.deepEqual(got.gaps, []);
    assert.deepEqual(got.tests.map((t) => t.path), ["test/echo.test.mjs"]);
    const placed = got.tests[0].text;
    assert.equal(placed, ORIGINAL.replace('"../../../lib/match-reply.mjs"', '"./support/lib/match-reply.mjs"'));
    assert.match(placed, /from "\.\.\/scripts\/echo\.mjs"/, "an import inside the codebase is left as it is");
    assert.deepEqual(changedBeyondImports(ORIGINAL, placed, rewriteImports(ORIGINAL, manifest().tests[0].imports).rewrites), []);
    assert.deepEqual(got.support.map((s) => s.path), SUPPORT.map((p) => `test/${p}`));
    for (const s of got.support) assert.ok(s.bytes.equals(bytes(join(WRITE_UP, s.from))), `${s.path} is byte for byte`);
    assert.equal(got.used.length, 1 + 1 + SUPPORT.length, "the manifest, the test and every support file are taken");
    assert.deepEqual(got.record.placed.map((p) => [p.test, p.file]), [["test/echo.test.mjs", "test/echo.test.mjs"]]);
    assert.equal(got.record.placed[0].sha256, sha256(Buffer.from(placed)));
  });
});

test("the support closure three files deep keeps its layout, so the placed suite runs and passes against the agent's script", async () => {
  await folders(async (dir) => {
    const files = attach(dir);
    const got = placeCarried({ found: carriedAmong(files, bytes), files, readBytes: bytes });
    const pkg = join(dir, "package");
    for (const f of [...got.tests.map((t) => ({ path: t.path, bytes: Buffer.from(t.text) })), ...got.support]) {
      mkdirSync(dirname(join(pkg, f.path)), { recursive: true });
      writeFileSync(join(pkg, f.path), f.bytes);
    }
    cpSync(join(FIXTURE, "scripts"), join(pkg, "scripts"), { recursive: true });
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
    const run = (only) => spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...only], { cwd: pkg, env, encoding: "utf8", timeout: 60000 });
    const tests = readdirSync(join(pkg, "test")).filter((n) => n.endsWith(".test.mjs")).map((n) => `test/${n}`);
    assert.deepEqual(tests, ["test/echo.test.mjs"], "no support file is a test the suite runs");
    const r = run(tests);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^# pass 2$/m);
    writeFileSync(join(pkg, "scripts", "echo.mjs"), "export {};\n");
    assert.notEqual(run(tests).status, 0, "against an empty script the original's test fails");
  });
});

test("the check that nothing else changed is made the other way round, and finds a change outside the specifiers", () => {
  const imports = manifest().tests[0].imports;
  const { text, rewrites } = rewriteImports(ORIGINAL, imports);
  assert.deepEqual(rewrites, [{ from: "../../../lib/match-reply.mjs", to: "./support/lib/match-reply.mjs", times: 1 }]);
  assert.deepEqual(changedBeyondImports(ORIGINAL, text.replace('"greeting"', '"farewell"'), rewrites), ["it differs from the original at line 9 by more than its import specifiers"]);
  assert.equal(supportSpecifier("support/lib/words/table.mjs"), "./support/lib/words/table.mjs");
  const dynamic = 'const m = await import("../../lib/a.mjs");\nimport "../../lib/a.mjs";\nconst s = "../../lib/a.mjs";\n';
  const out = rewriteImports(dynamic, [{ from: "../../lib/a.mjs", support: "support/lib/a.mjs" }]);
  assert.equal(out.text, 'const m = await import("./support/lib/a.mjs");\nimport "./support/lib/a.mjs";\nconst s = "../../lib/a.mjs";\n', "a string that is not an import is not touched");
});

test("without digests a file is matched by its name when only one has it; what did not come is said as a gap", async () => {
  await folders(async (dir) => {
    const files = attach(dir, { doc: manifest({ withDigests: false }), leave: ["support/lib/agreements.mjs"] });
    const got = placeCarried({ found: carriedAmong(files, bytes), files, readBytes: bytes });
    assert.deepEqual(got.tests.map((t) => t.path), ["test/echo.test.mjs"]);
    assert.deepEqual(got.gaps, ["the support file support/lib/agreements.mjs did not come with the message, so a carried test that imports it will not load"]);
    const doc = { ...manifest(), tests: [...manifest().tests, { file: "test/gone.test.mjs", at: "tests/test/gone.test.mjs", sha256: "0".repeat(64), imports: [] }] };
    const sent = attach(dir, { doc });
    const more = placeCarried({ found: carriedAmong(sent, bytes), files: sent, readBytes: bytes });
    assert.ok(more.gaps.includes("the original test test/gone.test.mjs did not come with the message, so it is not in the suite"));
  });
});

test("a test that sat deeper in the codebase takes the folder it sat in when its name is taken, and its own relative imports are said", async () => {
  assert.equal(placedName("test/echo.test.mjs"), "test/echo.test.mjs");
  assert.equal(placedName("test/unit/echo.test.mjs", new Set(["test/echo.test.mjs"])), "test/unit-echo.test.mjs");
  assert.equal(placedName("test/echo.spec.js"), "test/echo.spec.test.mjs");
  assert.equal(placedName("test/x.test.mjs", new Set(["test/x.test.mjs"])), "test/x-2.test.mjs");
  await folders(async (dir) => {
    const doc = manifest();
    doc.tests[0].file = "test/unit/echo.test.mjs";
    const files = attach(dir, { doc });
    const got = placeCarried({ found: carriedAmong(files, bytes), files, readBytes: bytes, taken: ["test/echo.test.mjs"] });
    assert.deepEqual(got.tests.map((t) => t.path), ["test/unit-echo.test.mjs"]);
    assert.deepEqual(got.gaps, ["test/unit/echo.test.mjs sat in test/unit/ in the codebase and now runs from test/, so its own relative imports (../scripts/echo.mjs) are read from test/"]);
  });
});

test("in a revision the record finds the carried tests and support by digest, and an original sent again is taken", async () => {
  await folders(async (dir) => {
    const first = placeCarried({ found: carriedAmong(attach(dir), bytes), files: attach(dir), readBytes: bytes });
    // The suite as delivered, flattened by the hops, with the record.
    const sent = [];
    const put = (name, b) => { const at = join(dir, `${sent.length}-Ab12cdEF-${name}`); writeFileSync(at, b); sent.push({ path: at }); };
    put("carried-tests.json", JSON.stringify(first.record));
    put("echo.test.mjs", first.tests[0].text);
    for (const s of first.support) put(s.path.split("/").pop(), s.bytes);
    put("echo-original.test.mjs", ORIGINAL);
    put("manifest.json", JSON.stringify(manifest()));
    const found = carriedAmong(sent, bytes);
    assert.equal(found.kind, "record", "the record governs over a manifest sent beside it");
    const again = placeCarried({ found, files: sent, readBytes: bytes });
    assert.deepEqual(again.gaps, []);
    assert.deepEqual(again.tests.map((t) => [t.path, t.text]), [["test/echo.test.mjs", first.tests[0].text]]);
    assert.deepEqual(again.support.map((s) => s.path), first.support.map((s) => s.path));
    assert.equal(again.used.length, sent.length, "every file is taken, so none is read as a test or a dependency");
  });
});

test("only the person drops a carried test, by naming it, and the drop is recorded", async () => {
  assert.deepEqual(dropsAsked("Revise the suite.\n\nDrop the original test echo.test.mjs, it reads a file we no longer have."), ["echo.test.mjs"]);
  assert.deepEqual(dropsAsked("please drop the carried test `test/echo.test.mjs`"), ["test/echo.test.mjs"]);
  assert.deepEqual(dropsAsked("echo.test.mjs fails; the original test should stay"), []);
  await folders(async (dir) => {
    const first = placeCarried({ found: carriedAmong(attach(dir), bytes), files: attach(dir), readBytes: bytes });
    const at = join(dir, "record.json"); writeFileSync(at, JSON.stringify(first.record));
    const test1 = join(dir, "t.mjs"); writeFileSync(test1, first.tests[0].text);
    const got = placeCarried({ found: carriedAmong([{ path: at }], bytes), files: [{ path: at }, { path: test1 }], readBytes: bytes, drops: ["echo.test.mjs"], now: () => "2026-11-09T12:00:00.000Z" });
    assert.deepEqual(got.tests, []);
    assert.deepEqual(got.dropped, [{ file: "test/echo.test.mjs", test: "test/echo.test.mjs", at: "2026-11-09T12:00:00.000Z", by: "the person, by naming it" }]);
    assert.deepEqual(got.record.dropped, got.dropped);
    assert.deepEqual(got.record.placed, []);
    assert.match(carriedWords(got), /^Dropped the original test test\/echo\.test\.mjs, as you named it; the drop is recorded in test\/carried-tests\.json\.$/);
    const none = placeCarried({ found: carriedAmong([{ path: at }], bytes), files: [{ path: at }, { path: test1 }], readBytes: bytes, drops: ["other.test.mjs"] });
    assert.ok(none.gaps.includes("other.test.mjs was asked to be dropped, and no original test carried here has that name"));
  });
  assert.equal(CARRIED_RECORD, "test/carried-tests.json");
});

test("every test loads: a file node cannot parse, and an ES module test using __dirname, __filename or require, are named by line", () => {
  assert.deepEqual(loadProblems({ path: "test/ok.test.mjs", text: 'import { test } from "node:test";\ntest("a", () => {});\n' }), []);
  const broken = loadProblems({ path: "test/broken.test.mjs", text: 'import { test } from "node:test";\ntest("a", () => {\n' });
  assert.equal(broken.length, 1);
  assert.match(broken[0], /^test\/broken\.test\.mjs does not parse \(node --check\): SyntaxError/);
  const cjs = loadProblems({ path: "test/paths.test.mjs", text: 'import { test } from "node:test";\nconst at = __dirname + "/x";\nconst fs = require("node:fs");\n' });
  assert.deepEqual(cjs.map((w) => w.split(" uses ")[0]), ["test/paths.test.mjs:2", "test/paths.test.mjs:3"]);
  assert.match(cjs[0], /throws a ReferenceError before any test runs; make it from import\.meta\.url \(dirname\(fileURLToPath\(import\.meta\.url\)\)\)$/);
  // Declared, in a comment, in a string, as a member or a key: not one.
  assert.deepEqual(commonJsNamesUsed('const __dirname = dirname(fileURLToPath(import.meta.url));\nconst at = join(__dirname, "x");\n'), []);
  assert.deepEqual(commonJsNamesUsed('import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nrequire("x");\n'), []);
  assert.deepEqual(commonJsNamesUsed('// uses __dirname in words only\nconst s = "require(x)";\nconst o = { require: 1 };\nmodule.require;\nconst t = `__filename`;\n'), []);
  assert.deepEqual(commonJsNamesUsed("const t = `${__filename}`;\n"), [{ name: "__filename", line: 1 }]);
});

test("a suite's support files and record are placed beside its tests and never run; anything else outside test/<name>.test.mjs is refused", async () => {
  const { placeSuite, supportFiles, isSupportPath, isTestPath } = await import("../scripts/check-suite.mjs");
  await folders(async (dir) => {
    const placed = placeSuite([
      { path: "test/echo.test.mjs", text: "// t\n" },
      { path: "test/support/lib/words/table.mjs", bytes: Buffer.from("export const TABLE = {};\n") },
      { path: "test/carried-tests.json", text: "{}\n" },
    ], dir);
    assert.deepEqual(placed, ["test/echo.test.mjs"], "only the test is run");
    assert.deepEqual(supportFiles(dir).map((f) => f.path), ["test/support/lib/words/table.mjs", "test/carried-tests.json"]);
    assert.throws(() => placeSuite([{ path: "test/helpers.mjs", text: "" }], dir), /a suite file must be test\/<name>\.test\.mjs, or a file it carries under test\/support\//);
    assert.equal(isTestPath("test/support/x.test.mjs"), false, "a file under test/support/ is never a test, whatever its name");
    assert.equal(isSupportPath("test/support/x.test.mjs"), true);
  });
});
