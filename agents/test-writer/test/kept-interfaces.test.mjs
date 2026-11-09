// The fifth standard file, test/kept-interfaces.test.mjs, made from the spec
// by code (test-writer 0.9.0).
//   node --test test/kept-interfaces.test.mjs
//
// What is pinned, on the made-up spec in test/fixtures/spec-v1/:
// - only interfaces with keep true are in it; a kept function gets a test that
//   it is exported under its name from its module, async as its signature
//   says; a kept command, that it accepts its flags; a kept file, that its
//   examples fit its schema, with checkKept for the suite's own tests; a kept
//   message, keptProblems; an http interface, nothing, said as what could
//   not be tested;
// - the same spec always gives the same bytes, and the file is the master
//   copy with two lines filled;
// - run in a package, the file passes against scripts that keep the
//   interfaces and fails, naming the interface, against ones that rename a
//   function, make it sync or refuse a flag, and against empty stand-ins;
// - checkKept holds what a job wrote to the kept file's JSON Schema, and an
//   id it expects must be there;
// - the writing step adds it to the suite, never lets the model write it,
//   and never revises it.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FROM_LINE, KEPT_LINE, keptInterfacesTest, keptPlan, unreadKeywords } from "../scripts/kept-interfaces.mjs";
import { KEPT_TEST, STANDARD_TESTS, keptTestAt, namedForRevision, staticFindings, withStandardTests } from "../scripts/write-suite.mjs";
import { unreadKeywords as masterUnread, valueProblems } from "../references/kept-interfaces.test.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MASTER_PATH = join(HERE, "..", "references", "kept-interfaces.test.mjs");
const MASTER = readFileSync(MASTER_PATH, "utf8");
const FIXTURE = join(HERE, "fixtures", "spec-v1");
const SPEC = JSON.parse(readFileSync(join(FIXTURE, "points-reader.spec.json"), "utf8"));

const folders = async (fn) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-kept-"));
  try { return await fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

// The script, three ways: keeping the interfaces, breaking them, and empty.
const GUARD = 'import { pathToFileURL } from "node:url";\nconst main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;\n';
const KEEPS = `${GUARD}export async function readPoints(text, { limit = 30 } = {}) { return { items: [], total: 0, limit, text }; }
export function formatReply() { return ""; }
if (main) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) if (!["--job", "--records"].includes(args[i])) { console.error("unknown flag " + args[i]); process.exit(2); }
  console.log("Read by points-reader.");
}
`;
const BREAKS = `${GUARD}export function readPoints(text) { return { items: [], total: 0, text }; }
if (main) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) if (args[i] !== "--job") { console.error("unknown flag " + args[i]); process.exit(2); }
  console.log("Read by points-reader.");
}
`;

/** A package folder holding the agent's files, scripts/read.mjs as given and
 *  the generated file under test/; the TAP lines of running that file. */
function runIn(dir, script, text) {
  cpSync(join(FIXTURE, "points-reader"), dir, { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(join(dir, "scripts", "read.mjs"), script);
  writeFileSync(join(dir, "test", "kept-interfaces.test.mjs"), text);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "test/kept-interfaces.test.mjs"], { cwd: dir, env, encoding: "utf8", timeout: 120000 });
  const lines = String(r.stdout ?? "").split("\n");
  return {
    status: r.status,
    ok: lines.filter((l) => /^ok \d+ - /.test(l)).map((l) => l.replace(/^ok \d+ - /, "")),
    failed: lines.filter((l) => /^not ok \d+ - /.test(l)).map((l) => l.replace(/^not ok \d+ - /, "")),
    out: r.stdout,
  };
}

test("only the interfaces the spec keeps are in it, each with the test its kind gets or why it gets none", () => {
  const plan = keptPlan(SPEC);
  assert.deepEqual(plan.map((i) => i.id), ["I1", "I2", "I3", "I4"], "I5 may change, so it is not kept");
  const by = Object.fromEntries(plan.map((i) => [i.id, i]));
  assert.equal(by.I1.test, "[I1] readPoints is exported from scripts/read.mjs as an async function, as the spec keeps it");
  assert.equal(by.I2.test, "[I2] out/points.json, in each job folder kept as an example, is what the JSON Schema the spec keeps for it says");
  assert.equal(by.I2.held_by, "checkKept");
  assert.equal(by.I3.test, '[I3] the command "node scripts/read.mjs" accepts its flags --job and --records, as the spec keeps them');
  assert.equal(by.I4.test, null);
  assert.match(by.I4.not_checked, /nothing in a suite stands in for the address/);
  const sync = keptPlan({ interfaces: [{ id: "I7", kind: "function", name: "countOf", module: "scripts/c.mjs", signature: "countOf(text)", keep: true }] });
  assert.match(sync[0].test, /as a function that is not async/);
  const loose = keptPlan({ interfaces: [{ id: "I8", kind: "function", name: "x", keep: true }, { id: "I9", kind: "message", name: "m", keep: true, schema: { type: "string" } }] });
  assert.match(loose[0].not_checked, /names no module/);
  assert.equal(loose[1].held_by, "keptProblems");
  assert.equal(loose[1].test, null);
});

test("the same spec gives the same bytes: the master copy with its two lines filled, and what could not be tested said", () => {
  const a = keptInterfacesTest(SPEC, MASTER);
  const b = keptInterfacesTest(JSON.parse(JSON.stringify(SPEC)), MASTER);
  assert.equal(a.text, b.text);
  assert.equal(a.path, KEPT_TEST);
  assert.deepEqual(a.tests, keptPlan(SPEC).filter((i) => i.test).map((i) => i.test));
  assert.ok(!a.text.includes(KEPT_LINE) && !a.text.includes(FROM_LINE));
  assert.ok(a.text.includes('export const FROM = {"product":"points-reader","version":"1.0.0"};'));
  const rest = (t) => t.replace(/^export const FROM = .*$/m, "").replace(/^export const KEPT = [\s\S]*?^\];$|^export const KEPT = \[\];$/m, "");
  assert.equal(rest(a.text), rest(MASTER), "nothing but the two lines differs from the master copy");
  assert.deepEqual(a.could_not, [{ what: "the kept interface I4 (http GET /points)", why: keptPlan(SPEC)[3].not_checked }]);
  assert.equal(keptInterfacesTest({ ...SPEC, interfaces: SPEC.interfaces.map((i) => ({ ...i, keep: false })) }, MASTER), null, "a spec that keeps nothing gives no file");
  assert.throws(() => keptInterfacesTest(SPEC, MASTER.replace(KEPT_LINE, "")), /does not carry/);
  // A $ in a schema's pattern is copied as it is.
  const dollar = keptInterfacesTest({ interfaces: [{ id: "I1", kind: "file", name: "a.json", keep: true, schema: { type: "string", pattern: "^a$'$&" } }] }, MASTER);
  assert.ok(dollar.text.includes('"pattern": "^a$\'$&"'));
});

test("a schema keyword the check does not read is said beside the suite, and the generator and the master copy read the same ones", () => {
  const schema = { type: "object", properties: { a: { type: "string", if: {}, then: {} } }, patternProperties: {}, $defs: { b: { contains: {} } }, title: "t", format: "x" };
  assert.deepEqual(unreadKeywords(schema), masterUnread(schema));
  assert.deepEqual(unreadKeywords(schema).sort(), ["contains", "if", "patternProperties", "then"]);
  const got = keptInterfacesTest({ interfaces: [{ id: "I1", kind: "file", name: "a.json", keep: true, schema }] }, MASTER);
  assert.match(got.could_not[0].why, /does not read if, then, patternProperties and contains, so those keywords are not held/);
});

test("run in a package that keeps the interfaces, every test of the file passes, and the example check skips with no example", async () => {
  await folders(async (dir) => {
    const got = runIn(dir, KEEPS, keptInterfacesTest(SPEC, MASTER).text);
    assert.equal(got.status, 0, got.out);
    assert.ok(got.ok.some((n) => n.startsWith("[I1] readPoints is exported")));
    assert.ok(got.ok.some((n) => n.startsWith('[I3] the command "node scripts/read.mjs" accepts')));
    assert.match(got.out, /\[I2\] out\/points\.json[^\n]*# SKIP/);
  });
});

test("run against a function made sync and a flag refused, the file fails naming each interface", async () => {
  await folders(async (dir) => {
    const got = runIn(dir, BREAKS, keptInterfacesTest(SPEC, MASTER).text);
    assert.notEqual(got.status, 0);
    assert.ok(got.failed.some((n) => n.startsWith("[I1] ")), got.out);
    assert.ok(got.failed.some((n) => n.startsWith("[I3] ")), got.out);
    assert.match(got.out, /\[I1\] readPoints is not async, and its signature as the spec keeps it/);
    assert.match(got.out, /\[I3\] node scripts\/read\.mjs stopped with exit 2/);
  });
  await folders(async (dir) => {
    const renamed = KEEPS.replace("export async function readPoints", "export async function readAllPoints");
    const got = runIn(dir, renamed, keptInterfacesTest(SPEC, MASTER).text);
    assert.match(got.out, /\[I1\] scripts\/read\.mjs does not export a function named readPoints/);
  });
});

test("against an empty stand-in for the script, the file fails", async () => {
  await folders(async (dir) => {
    const got = runIn(dir, "", keptInterfacesTest(SPEC, MASTER).text);
    assert.notEqual(got.status, 0);
    assert.ok(got.failed.some((n) => n.startsWith("[I1] ")));
  });
});

test("a command with no script in its name is found by the job command in agent-runtime-requirements.json carrying its flags", async () => {
  await folders(async (dir) => {
    const spec = { ...SPEC, interfaces: [{ id: "I3", kind: "command", name: "read-points", keep: true, flags: ["--job", "--records"] }] };
    const got = runIn(dir, BREAKS, keptInterfacesTest(spec, MASTER).text);
    assert.match(got.out, /\[I3\] read-points stopped with exit 2/, "the packed path skills/read-points/scripts/read.mjs is read from scripts/");
  });
});

test("checkKept holds what a job wrote to the kept file's schema, and an id it expects must be there", async () => {
  await folders(async (dir) => {
    const at = join(dir, "kept.mjs");
    writeFileSync(at, keptInterfacesTest(SPEC, MASTER).text);
    const { checkKept, keptProblems } = await import(pathToFileURL(at).href);
    const job = join(dir, "job-1");
    mkdirSync(join(job, "out"), { recursive: true });
    const put = (v) => writeFileSync(join(job, "out", "points.json"), JSON.stringify(v));
    put({ items: [{ title: "Alpha", points: 12 }], total: 12 });
    assert.deepEqual(checkKept(job, { expect: ["I2"] }), []);
    put({ items: [{ title: "Alpha", points: "12" }], total: 12, extra: true });
    const bad = checkKept(job);
    assert.ok(bad.some((p) => /^\[I2\] out\/points\.json\.items\[0\]\.points is string, and the schema says integer \(out\/points\.json\)$/.test(p)), bad.join("\n"));
    assert.ok(bad.some((p) => /has extra, which the schema does not allow/.test(p)));
    put({ items: Array.from({ length: 31 }, () => ({ title: "x", points: 1 })), total: 31 });
    assert.match(checkKept(job).join(" "), /has 31 items, more than 30/);
    writeFileSync(join(job, "out", "points.json"), "not json");
    assert.match(checkKept(job).join(" "), /does not parse as JSON/);
    rmSync(join(job, "out", "points.json"));
    assert.deepEqual(checkKept(job), [], "a folder whose job writes no kept file has nothing wrong");
    assert.deepEqual(checkKept(job, { expect: ["I2"] }), [`[I2] the job wrote no out/points.json under ${job}`]);
    assert.match(checkKept(job, { expect: ["I1"] }).join(" "), /is a function, not a file/);
    assert.match(keptProblems("I7", {}).join(" "), /not an interface the spec keeps/);
    assert.deepEqual(keptProblems("I2", '{"items":[],"total":0}'), [], "a string is read as JSON");
  });
});

test("the schema reading covers the keywords it names", () => {
  const s = { type: "object", required: ["a"], properties: { a: { enum: ["x", "y"] }, b: { anyOf: [{ type: "string" }, { type: "null" }] }, c: { type: "string", pattern: "^\\d+$", maxLength: 3 }, d: { $ref: "#/$defs/n" } }, $defs: { n: { type: "number", minimum: 1 } } };
  assert.deepEqual(valueProblems({ a: "x", b: null, c: "12", d: 2 }, s), []);
  const got = valueProblems({ b: 3, c: "1234a", d: 0 }, s).join("\n");
  for (const w of ["has no a, which the schema requires", "fits none of the shapes", "longer than 3 characters", "does not match the pattern", "below the minimum 1"]) assert.match(got, new RegExp(w));
  assert.deepEqual(valueProblems(1.5, { type: "integer" }), ["the value is number, and the schema says integer"]);
  assert.deepEqual(valueProblems("a", { oneOf: [{ type: "string" }, { minLength: 1 }] }), ["the value fits 2 of the shapes the schema allows one of (oneOf)"]);
});

test("the writing step adds the file as a standard check the model never writes and a revision never names", () => {
  assert.ok(STANDARD_TESTS.includes(KEPT_TEST));
  assert.equal(keptTestAt({}), MASTER_PATH);
  const plugin = JSON.parse(readFileSync(join(HERE, "..", "plugin.json"), "utf8"));
  for (const slug of ["write-a-suite", "write-the-suite"]) {
    const b = plugin.extensions["net.agentdoc.package"].build.skills[slug];
    assert.ok(b.references.includes("references/kept-interfaces.test.mjs"), `${slug} does not carry the master copy`);
    for (const s of ["scripts/spec-rules.mjs", "scripts/kept-interfaces.mjs"]) assert.ok(b.scripts.includes(s), `${slug} does not carry ${s}`);
  }
  const text = keptInterfacesTest(SPEC, MASTER).text;
  assert.deepEqual(withStandardTests([], { keptTest: text }).map((f) => f.path), [KEPT_TEST]);
  assert.deepEqual(withStandardTests([], {}).map((f) => f.path), [], "no kept interface, no file");
  const f = staticFindings([{ path: KEPT_TEST, text }], null);
  assert.match(f[0], /kept-interfaces\.test\.mjs is written by the test writer itself/);
  assert.deepEqual(namedForRevision([{ path: KEPT_TEST, text }], "kept-interfaces.test.mjs is wrong"), []);
});
