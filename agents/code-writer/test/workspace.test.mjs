// The workspace step: the folder the harness writes in, and the record the
// check holds it to.
//   node --test test/workspace.test.mjs
//
// Worth pinning: a stub exports exactly what the suite imports, by name, so
// the first round fails for the right reasons; a prototype file at a named
// script's own path seeds that script only when it is already in the stack,
// and everything else the prototype held is placed to be read and never
// changed; the digests of every test and the spec are recorded; and a spec
// that names a script outside scripts/ is refused before anything is written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ROUNDS_MAX_DEFAULT, digestOf, importsOf, layOut, listing, plainName, roundsMaxOf, scriptsOf, sortAttachments, staysInside, stubFor,
} from "../scripts/workspace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "workspace.mjs");

const SPEC = { name: "adder", version: "0.1.0", jobs: [
  { slug: "add", offered: true, scripts: ["scripts/add.mjs", "scripts/pieces.mjs"] },
  { slug: "say", scripts: ["scripts/add.mjs", "scripts/say.mjs"] },
] };
const SUITE = [
  { path: "test/add.test.mjs", text: '// adds\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add, LIMIT, sub as minus } from "../scripts/add.mjs";\nimport reply from "../scripts/say.mjs";\ntest("two and two are four", () => { assert.equal(add(2, 2), 4); });\n' },
  { path: "test/pieces.test.mjs", text: '// pieces\nimport { test } from "node:test";\nconst { plan } = await import("../scripts/pieces.mjs");\ntest("x", () => {});\n' },
];

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-ws-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

test("scripts are listed once in the order named, and a path that climbs out is refused before anything is written", () => {
  assert.deepEqual(scriptsOf(SPEC), ["scripts/add.mjs", "scripts/pieces.mjs", "scripts/say.mjs"]);
  assert.equal(staysInside("scripts/a.mjs"), true);
  assert.equal(staysInside("scripts/../a.mjs"), false);
  assert.equal(staysInside("/etc/a.mjs"), false);
  folder((at) => {
    assert.throws(() => layOut({ workspace: at, spec: { name: "x", version: "1", jobs: [{ slug: "a", scripts: ["../escape.mjs"] }] }, suite: SUITE }), /outside scripts\//);
    assert.throws(() => layOut({ workspace: at, spec: { name: "x", version: "1", jobs: [{ slug: "a", scripts: ["lib/a.mjs"] }] }, suite: SUITE }), /outside scripts\//);
  });
});

test("what the suite imports is read per script: named, aliased, default and dynamic", () => {
  const got = importsOf(SUITE[0].text);
  assert.deepEqual(got, [
    { script: "scripts/add.mjs", names: ["add", "LIMIT", "sub"] },
    { script: "scripts/say.mjs", names: ["default"] },
  ]);
  assert.deepEqual(importsOf(SUITE[1].text), [{ script: "scripts/pieces.mjs", names: [] }]);
  assert.deepEqual(importsOf("import { x } from \"node:fs\";"), [], "node's own modules are not scripts");
});

test("a stub exports exactly what the suite imports, each throwing until written, and says so", () => {
  const s = stubFor("scripts/add.mjs", ["add", "LIMIT", "sub"]);
  assert.match(s, /^\/\/ add\.mjs: not written yet\./);
  assert.match(s, /export function add\(\) \{ throw new Error\("add is not written yet"\); \}/);
  assert.match(s, /export const LIMIT = undefined;/);
  assert.match(s, /export function sub\(\)/);
  assert.match(stubFor("scripts/say.mjs", ["default"]), /export default function \(\) \{ throw/);
  assert.match(stubFor("scripts/pieces.mjs", []), /export \{\};/);
});

test("the workspace holds the spec and the suite as they arrived, a stub for each named script, and the digests the check will hold it to", () => {
  folder((at) => {
    const out = layOut({ workspace: at, spec: SPEC, suite: SUITE });
    assert.deepEqual(out.scripts.map((s) => [s.path, s.from]), [["scripts/add.mjs", "stub"], ["scripts/pieces.mjs", "empty"], ["scripts/say.mjs", "stub"]]);
    assert.match(readFileSync(join(at, "scripts", "add.mjs"), "utf8"), /export function add\(\)/);
    assert.equal(readFileSync(join(at, "test", "add.test.mjs"), "utf8"), SUITE[0].text);
    assert.equal(JSON.parse(readFileSync(join(at, "spec.json"), "utf8")).name, "adder");
    assert.deepEqual(Object.keys(out.digests).sort(), ["spec.json", "test/add.test.mjs", "test/pieces.test.mjs"]);
    assert.equal(out.digests["test/add.test.mjs"], digestOf(Buffer.from(SUITE[0].text)));
    assert.deepEqual(out.prototype, []);
    assert.deepEqual(out.unnamed, []);
    assert.ok("scripts/add.mjs" in out.listing && "spec.json" in out.listing, "the listing covers the workspace");
    assert.equal("records/workspace.json" in out.listing, false, "records are not part of the fence");
  });
});

test("a prototype seeds a named script only when it is already in the stack at that path, and the rest is placed to be read", () => {
  folder((at) => {
    const code = [
      { path: "scripts/add.mjs", bytes: Buffer.from("export function add(a, b) { return a + b; }\n") },
      { path: "add.py", bytes: Buffer.from("def add(a, b): return a + b\n") },
      { path: "notes/why.md", bytes: Buffer.from("# because\n") },
      { path: "../escape.txt", bytes: Buffer.from("no") },
    ];
    const out = layOut({ workspace: at, spec: SPEC, suite: SUITE, code });
    assert.deepEqual(out.scripts.find((s) => s.path === "scripts/add.mjs").from, "prototype");
    assert.match(readFileSync(join(at, "scripts", "add.mjs"), "utf8"), /return a \+ b/);
    assert.equal(out.scripts.find((s) => s.path === "scripts/say.mjs").from, "stub");
    assert.deepEqual(out.prototype, ["scripts/add.mjs", "add.py", "notes/why.md"], "a path that climbs out is dropped");
    assert.equal(readFileSync(join(at, "prototype", "add.py"), "utf8"), "def add(a, b): return a + b\n");
    assert.equal(existsSync(join(at, "..", "escape.txt")), false);
  });
});

test("a script the suite imports that the spec never names is said, not made", () => {
  folder((at) => {
    const suite = [{ path: "test/x.test.mjs", text: 'import { test } from "node:test";\nimport { y } from "../scripts/extra.mjs";\ntest("a", () => {});\n' }];
    const out = layOut({ workspace: at, spec: { name: "x", version: "1", jobs: [{ slug: "a", scripts: ["scripts/a.mjs"] }] }, suite });
    assert.deepEqual(out.unnamed, ["scripts/extra.mjs"]);
    assert.equal(existsSync(join(at, "scripts", "extra.mjs")), false);
  });
});

test("references and assets the spec names are laid out when the prototype carried them, stood in as empty otherwise, and pinned either way", () => {
  const spec = { name: "x", version: "1", jobs: [
    { slug: "a", scripts: ["scripts/a.mjs"], references: ["references/rules.md", "references/a-folder"], assets: ["assets/logo.png"] },
    { slug: "b", scripts: ["scripts/a.mjs"], references: ["references/rules.md"] },
  ] };
  const suite = [{ path: "test/a.test.mjs", text: 'import { test } from "node:test";\nimport { a } from "../scripts/a.mjs";\ntest("x", () => {});\n' }];
  folder((at) => {
    const code = [{ path: "references/rules.md", bytes: Buffer.from("# rules\n") }, { path: "references/a-folder/one.md", bytes: Buffer.from("one\n") }];
    const out = layOut({ workspace: at, spec, suite, code });
    assert.deepEqual(out.extras, [
      { path: "references/rules.md", from: "prototype" },
      { path: "references/a-folder", from: "prototype" },
      { path: "assets/logo.png", from: "stand-in" },
    ]);
    assert.deepEqual(out.stood_in, ["assets/logo.png"]);
    assert.equal(readFileSync(join(at, "references", "rules.md"), "utf8"), "# rules\n");
    assert.equal(readFileSync(join(at, "references", "a-folder", "one.md"), "utf8"), "one\n");
    assert.equal(readFileSync(join(at, "assets", "logo.png")).length, 0);
    for (const p of ["references/rules.md", "references/a-folder/one.md", "assets/logo.png"]) assert.ok(p in out.digests, `${p} is pinned`);
    assert.throws(() => layOut({ workspace: join(at, "w2"), spec: { name: "x", version: "1", jobs: [{ slug: "a", scripts: ["scripts/a.mjs"], references: ["scripts/r.md"] }] }, suite }), /may not/);
  });
});

test("the rounds ceiling is a setting with a default, and the listing skips what it is told to", () => {
  assert.equal(roundsMaxOf({}), ROUNDS_MAX_DEFAULT);
  assert.equal(roundsMaxOf({ ROUNDS_MAX: "5" }), 5);
  assert.equal(roundsMaxOf({ ROUNDS_MAX: "nope" }), ROUNDS_MAX_DEFAULT);
  folder((at) => {
    mkdirSync(join(at, "a"), { recursive: true });
    mkdirSync(join(at, "skip"), { recursive: true });
    writeFileSync(join(at, "a", "one.txt"), "1");
    writeFileSync(join(at, "skip", "two.txt"), "2");
    assert.deepEqual(Object.keys(listing(at, { skip: ["skip"] })), ["a/one.txt"]);
  });
});

test("as a process it exits 2 when called wrong, 3 with a reply when there is no suite, and writes the record when there is", () => {
  const wrong = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, WORKSPACE: "", SPEC: "", SUITE: "", RECORDS: "" } });
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /WORKSPACE and RECORDS are required, with FILES \(the attached files\) or SPEC and SUITE/);
  folder((at) => {
    const specPath = join(at, "spec.json");
    writeFileSync(specPath, JSON.stringify(SPEC));
    const empty = join(at, "nosuite");
    mkdirSync(empty);
    const none = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, WORKSPACE: join(at, "ws1"), SPEC: specPath, SUITE: empty, RECORDS: join(at, "r1"), CODE: "" } });
    assert.equal(none.status, 3);
    assert.match(JSON.parse(none.stdout).reply, /no suite in /);
    const suiteDir = join(at, "suite", "test");
    mkdirSync(suiteDir, { recursive: true });
    for (const f of SUITE) writeFileSync(join(at, "suite", f.path), f.text);
    const records = join(at, "r2");
    const ok = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, WORKSPACE: join(at, "ws2"), SPEC: specPath, SUITE: join(at, "suite"), RECORDS: records, CODE: "", ROUNDS_MAX: "7" } });
    assert.equal(ok.status, 0, ok.stderr);
    const said = JSON.parse(ok.stdout);
    assert.match(said.said, /3 scripts laid out \(0 from the prototype, 2 stubbed, 1 empty\); 2 test files/);
    const rec = JSON.parse(readFileSync(join(records, "workspace.json"), "utf8"));
    assert.equal(rec.workspace, "v1");
    assert.equal(rec.rounds_max, 7);
    assert.equal(rec.prototype_given, false);
    assert.equal(rec.scripts.length, 3);
  });
});


test("a suite that carries a helper beside its tests is laid out whole, the helper pinned like a test", async () => {
  const { layOut } = await import("../scripts/workspace.mjs");
  const { mkdtempSync, rmSync, existsSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const ws = mkdtempSync(join(tmpdir(), "code-writer-ws-helper-"));
  try {
    const spec = { name: "adder", version: "0.1.0", jobs: [{ slug: "add", offered: true, scripts: ["scripts/add.mjs"] }] };
    const suite = [
      { path: "test/add.test.mjs", text: 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\nimport { two } from "./helpers.mjs";\ntest("two", () => { assert.equal(add(1, 1), two()); });\n' },
      { path: "test/helpers.mjs", text: "export const two = () => 2;\n" },
      { path: "test/fixtures/sample.json", text: "{}\n" },
    ];
    const out = layOut({ workspace: ws, spec, suite });
    assert.ok(existsSync(join(ws, "test", "helpers.mjs")));
    assert.ok(existsSync(join(ws, "test", "fixtures", "sample.json")));
    assert.ok("test/helpers.mjs" in out.digests, "the helper is pinned by the fence");
    assert.ok("test/fixtures/sample.json" in out.digests);
    assert.ok(out.scripts.some((s) => s.path === "scripts/add.mjs" && s.names.includes("add")), "the stub's names come from the test files only");
    const ws2 = mkdtempSync(join(tmpdir(), "code-writer-ws-helper-"));
    const ws3 = mkdtempSync(join(tmpdir(), "code-writer-ws-helper-"));
    try {
      assert.throws(() => layOut({ workspace: ws2, spec, suite: [{ path: "test/helpers.mjs", text: "" }] }), /no test\/<name>\.test\.mjs/);
      assert.throws(() => layOut({ workspace: ws3, spec, suite: [{ path: "test/../scripts/x.mjs", text: "" }] }), /under test\//);
    } finally { rmSync(ws2, { recursive: true, force: true }); rmSync(ws3, { recursive: true, force: true }); }
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test("a named script that is not a module is never given a JavaScript stub: the prototype's own bytes, or empty", () => {
  const spec = { name: "adder", version: "0.1.0", jobs: [{ slug: "add", offered: true, scripts: ["scripts/add.mjs", "scripts/package.json", "scripts/table.json"] }] };
  folder((at) => {
    const out = layOut({ workspace: at, spec, suite: SUITE, code: [{ path: "scripts/package.json", bytes: Buffer.from('{"type":"module"}\n') }] });
    assert.equal(readFileSync(join(at, "scripts", "package.json"), "utf8"), '{"type":"module"}\n');
    assert.equal(readFileSync(join(at, "scripts", "table.json"), "utf8"), "");
    assert.doesNotMatch(readFileSync(join(at, "scripts", "table.json"), "utf8"), /not written yet/);
    assert.deepEqual(out.scripts.map((s) => [s.path, s.from]), [["scripts/add.mjs", "stub"], ["scripts/package.json", "prototype"], ["scripts/table.json", "empty"]]);
  });
});

test("attached files are sorted by what is in them, prefixes taken off their names, and nothing is copied by name", () => {
  const files = {
    "/mesh/in/0-abcdefgh-spec": JSON.stringify(SPEC),
    "/mesh/in/1-abcdefgh-suite_test_file": SUITE[0].text.replace('import reply from "../scripts/say.mjs";', 'import reply from "../scripts/say.mjs";\nimport { fake } from "./helpers.mjs";'),
    "/mesh/in/2-abcdefgh-helpers.mjs": "export const fake = () => 1;\n",
    "/mesh/in/3-abcdefgh-old_adder.py": "def add(a, b): return a + b\n",
    "/mesh/in/4-abcdefgh-job-manifest.json": JSON.stringify({ name: "x", jobs: [{ slug: "y" }] }),
  };
  const sorted = sortAttachments(Object.keys(files), (p) => Buffer.from(files[p]));
  assert.equal(sorted.spec.from, "/mesh/in/0-abcdefgh-spec");
  assert.deepEqual(sorted.suite.map((f) => f.path), ["test/suite_test_file.test.mjs", "test/helpers.mjs"]);
  assert.deepEqual(sorted.code.map((f) => f.path), ["old_adder.py"]);
  assert.equal(plainName("/in/0-qHW-qM6g-0-ZChxASLw-spec"), "spec");
  assert.equal(sortAttachments(["/nowhere"], () => { throw new Error("gone"); }).spec, null);
});

test("as a process given FILES it lays the workspace out from the attachments themselves, and says so when no spec came", () => {
  folder((at) => {
    const inbox = join(at, "mesh-in"); mkdirSync(inbox);
    const specAt = join(inbox, "0-abcdefgh-spec"); writeFileSync(specAt, JSON.stringify(SPEC));
    const t1 = join(inbox, "1-abcdefgh-add.test.mjs"); writeFileSync(t1, SUITE[0].text);
    const t2 = join(inbox, "2-abcdefgh-pieces"); writeFileSync(t2, SUITE[1].text);
    const proto = join(inbox, "3-abcdefgh-adder.js"); writeFileSync(proto, "module.exports = (a, b) => a + b;\n");
    const records = join(at, "r");
    const ok = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, WORKSPACE: join(at, "ws"), FILES: [specAt, t1, `${t2}::text/javascript`, proto].join(","), RECORDS: records, SPEC: "", SUITE: "", CODE: "" } });
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(existsSync(join(at, "ws", "test", "add.test.mjs")));
    assert.ok(existsSync(join(at, "ws", "test", "pieces.test.mjs")));
    assert.ok(existsSync(join(at, "ws", "prototype", "adder.js")));
    const rec = JSON.parse(readFileSync(join(records, "workspace.json"), "utf8"));
    assert.equal(rec.from_attachments, true);
    assert.equal(rec.prototype_given, true);
    const none = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, WORKSPACE: join(at, "ws2"), FILES: t1, RECORDS: join(at, "r2"), SPEC: "", SUITE: "", CODE: "" } });
    assert.equal(none.status, 3);
    assert.match(JSON.parse(none.stdout).reply, /Nothing attached is a spec/);
  });
});
