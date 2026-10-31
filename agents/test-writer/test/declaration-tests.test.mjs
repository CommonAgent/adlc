// A test that touches no script must already pass.
//   node --test test/declaration-tests.test.mjs
//
// A test that reads only the agent's own files (agent-descriptor.json,
// plugin.json, agent-runtime-requirements.json, a SKILL.md) has nothing a
// code writer can change. If it fails before any script exists, it fails
// forever, and every build stops at the code step (technical debt 618: the
// writer asserted desc.name === "word-tally" and offering.offered === true,
// neither of which the Common Agent descriptor carries).
//
// What is pinned: the suite's imports from the scripts are read, with the
// names each takes; a stand-in that exports those names and does nothing lets
// every file load; a test's body is judged to touch a script when it names a
// script, an imported script function, or a helper that does; a real run
// beside the agent's own files names each test that touches no script and
// still fails, and nothing else; the finding and the verdict say so in
// words; and the writer is given the agent's own files whole, with the word
// that a declaration test asserts only what they carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  declarationRun, declarationStandIn, importsOf, scriptFreeTests, unpassableFrom, verdict,
} from "../scripts/check-suite.mjs";
import { AGENT_FILES_INSTRUCTION, agentFilesOf, requestParts, standInFindings } from "../scripts/write-suite.mjs";

const folder = async (body) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-decl-"));
  try { return await body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

// The agent's own files as the spec writer delivers them today: no name in
// the descriptor, none of `offered`, the name in plugin.json.
const DESCRIPTOR = {
  format: "agent-descriptor-v1", agent_version: "0.1.0",
  does: "Counts the words in a piece of text.",
  offerings: [{ id: "count-words", name: "Count words", does: "Counts the words.", how: { control: "script", intelligence: "none", cost: "none", contract: "full" } }],
  refusals: "Counting anything it was not handed.",
  records: [],
};
const PLUGIN = { name: "word-tally", version: "0.1.0", description: "Counts words." };
const SPEC = { name: "word-tally", version: "0.1.0", jobs: [{ slug: "count-words", offered: true, scripts: ["scripts/count.mjs", "scripts/went-without.mjs"] }] };

const agentFolder = (at) => {
  const dir = join(at, "word-tally");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent-descriptor.json"), JSON.stringify(DESCRIPTOR, null, 2));
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(PLUGIN, null, 2));
  return dir;
};

// The shape of the suite the dev run delivered, cut down: script tests that
// import, one that spawns through a helper, and the declaration test that
// can never pass.
const DEFECTIVE = `// Counting words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { countWords, words as split } from "../scripts/count.mjs";
import * as ww from "../scripts/went-without.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "..", "scripts", "count.mjs");
function runIt(args) { return spawnSync("node", [scriptPath, ...args], { encoding: "utf8" }); }

test("empty text counts as zero words", () => {
  assert.equal(countWords(""), 0);
});

test("words are split on whitespace alone", () => {
  assert.deepEqual(split("a  b"), ["a", "b"]);
});

test("the went-without record is a list", () => {
  assert.ok(Array.isArray(ww.read("x")));
});

test("running the script without arguments exits 2", () => {
  assert.equal(runIt([]).status, 2);
});

test("the package declaration offers count-words as a script job with no model", () => {
  const desc = JSON.parse(readFileSync(join(here, "..", "agent-descriptor.json"), "utf8"));
  assert.equal(desc.name, "word-tally");
  const jobs = desc.jobs ?? desc.offerings ?? [];
  const job = jobs.find((j) => (j.slug ?? j.id) === "count-words");
  assert.equal(job.offered, true);
  assert.equal(job.how.control, "script");
});
`;

// The same suite with the declaration test asserting what the files carry.
const SOUND = DEFECTIVE.replace(/test\("the package declaration[\s\S]*$/, `test("the package declaration offers count-words as a script job with no model", () => {
  const desc = JSON.parse(readFileSync(join(here, "..", "agent-descriptor.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(here, "..", "plugin.json"), "utf8"));
  assert.equal(plugin.name, "word-tally");
  const job = desc.offerings.find((o) => o.id === "count-words");
  assert.equal(job.how.control, "script");
  assert.equal(job.how.intelligence, "none");
});
`);

const lineOf = (text, needle) => text.split("\n").findIndex((l) => l.includes(needle)) + 1;

test("the suite's imports from the scripts are read with the names each takes, and nothing else counts as a script", () => {
  const got = importsOf(DEFECTIVE);
  const count = got.find((i) => i.from === "scripts/count.mjs");
  assert.ok(count, "../scripts/count.mjs resolves to scripts/count.mjs");
  assert.equal(count.script, true);
  assert.deepEqual(count.names, [{ imported: "countWords", local: "countWords" }, { imported: "words", local: "split" }]);
  const ww = got.find((i) => i.from === "scripts/went-without.mjs");
  assert.equal(ww.namespace, "ww");
  assert.equal(got.some((i) => i.from.startsWith("node:")), false, "node's own modules are not imports of the package");
  const mixed = importsOf('import def, { a } from "../scripts/x.mjs";\nimport { checkDelivered } from "./delivered-formats.test.mjs";\n');
  assert.deepEqual(mixed.find((i) => i.from === "scripts/x.mjs").names, [{ imported: "default", local: "def" }, { imported: "a", local: "a" }]);
  const helper = mixed.find((i) => i.from === "test/delivered-formats.test.mjs");
  assert.equal(helper.script, false, "a file beside the tests is not a script");
});

test("a declaration stand-in exports every name the suite imports, and each does nothing but say it is a stand-in", async () => {
  await folder(async (at) => {
    const file = join(at, "count.mjs");
    writeFileSync(file, declarationStandIn(["countWords", "words", "default"]));
    const m = await import(pathToFileURL(file).href);
    assert.equal(typeof m.countWords, "function");
    assert.equal(typeof m.words, "function");
    assert.equal(typeof m.default, "function");
    assert.throws(() => m.countWords("a b"), /stand-in/);
  });
  assert.doesNotMatch(declarationStandIn(["not a name", "x-y"]), /not a name|x-y =/, "a name that is not an identifier is not written");
});

test("a test touches a script when its body names one, a function imported from one, or a helper that does", () => {
  const files = [{ path: "test/count.test.mjs", text: DEFECTIVE }];
  const free = scriptFreeTests(files[0], { files, scripts: SPEC.jobs[0].scripts });
  assert.deepEqual(free, [lineOf(DEFECTIVE, 'test("the package declaration')],
    "only the declaration test touches no script: the others call countWords, the renamed split, the ww namespace, or spawn through runIt");
});

test("the failures that count are the ones in tests that touch no script, and a parent failing for its children is not one", () => {
  const files = [{ path: "test/count.test.mjs", text: DEFECTIVE }];
  const decl = lineOf(DEFECTIVE, 'test("the package declaration');
  const script = lineOf(DEFECTIVE, 'test("empty text');
  const failures = [
    { file: "/tmp/x/test/count.test.mjs", line: decl, name: "the package declaration offers count-words as a script job with no model", failureType: "testCodeFailure", error: "undefined !== 'word-tally'" },
    { file: "/tmp/x/test/count.test.mjs", line: script, name: "empty text counts as zero words", failureType: "testCodeFailure", error: "stand-in" },
    { file: "/tmp/x/test/count.test.mjs", line: 1, name: "test/count.test.mjs", failureType: "testCodeFailure", error: "load" },
    { file: "/tmp/x/test/count.test.mjs", line: decl, name: "the package declaration offers count-words as a script job with no model", failureType: "subtestsFailed", error: "1 subtest failed" },
  ];
  const got = unpassableFrom(failures, { dir: "/tmp/x", files, scripts: SPEC.jobs[0].scripts });
  assert.deepEqual(got.map((u) => [u.path, u.line, u.name]), [["test/count.test.mjs", decl, "the package declaration offers count-words as a script job with no model"]]);
  assert.match(got[0].error, /word-tally/);
});

test("run beside the agent's own files, the declaration test that asserts what they do not carry is named, and the script tests are not", async () => {
  // Run for real: this is the check, and a handed-in spawn would prove nothing about it.
  await folder(async (at) => {
    const dir = agentFolder(at);
    const bad = declarationRun({ spec: SPEC, files: [{ path: "test/count.test.mjs", text: DEFECTIVE }], folder: dir });
    assert.equal(bad.timed_out, false);
    assert.deepEqual(bad.unpassable.map((u) => u.name), ["the package declaration offers count-words as a script job with no model"], JSON.stringify(bad));
    assert.equal(bad.unpassable[0].path, "test/count.test.mjs");
    const good = declarationRun({ spec: SPEC, files: [{ path: "test/count.test.mjs", text: SOUND }], folder: dir });
    assert.deepEqual(good.unpassable, [], JSON.stringify(good));
    assert.ok(good.pass >= 1, "the sound declaration test passes against the files before any script exists");
  });
});

test("an unpassable test is a finding that goes back to the writer, and the verdict names it", () => {
  const unpassable = [{ path: "test/count.test.mjs", line: 40, name: "the package declaration offers count-words", error: "undefined !== 'word-tally'" }];
  const findings = standInFindings({ fails: true, tests: 5, pass: 0, fail: 5, unpassable });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /touch(es)? no script/);
  assert.match(findings[0], /no script can (ever )?make/);
  assert.match(findings[0], /"the package declaration offers count-words"/);
  assert.match(findings[0], /word-tally/, "the failure is quoted so the writer sees what it asserted");
  assert.deepEqual(standInFindings({ fails: true, tests: 5, pass: 0, fail: 5, unpassable: [] }), []);
  const said = verdict({ standIns: { scripts: 2, tests: 5, pass: 0, fail: 5, fails: true, unpassable } });
  assert.match(said, /fails \(0 of 5 pass\)/);
  assert.match(said, /touch(es)? no script/);
  assert.match(said, /"the package declaration offers count-words"/);
  assert.doesNotMatch(verdict({ standIns: { scripts: 2, tests: 5, pass: 0, fail: 5, fails: true } }), /touch/, "a run without the check says nothing of it");
});

test("the writer is given the agent's own files whole, after the spec, with the word that a declaration test asserts only what they carry", async () => {
  await folder(async (at) => {
    const dir = agentFolder(at);
    const files = agentFilesOf(dir);
    assert.deepEqual(files.map((f) => f.path), ["agent-descriptor.json", "plugin.json"], "the files that are there, and none made up");
    const parts = requestParts({ spec: SPEC, agentFiles: files });
    const at2 = parts.findIndex((p) => p.startsWith("--- THE AGENT'S OWN FILES ---"));
    const spec = parts.findIndex((p) => p.startsWith("--- THE SPEC ---"));
    assert.ok(at2 > spec, "after the spec");
    assert.ok(parts[at2].includes(JSON.stringify(DESCRIPTOR, null, 2)), "the descriptor whole, as it stands");
    assert.ok(parts[at2].includes(AGENT_FILES_INSTRUCTION));
    assert.match(AGENT_FILES_INSTRUCTION, /plugin\.json's `?name`?/);
    assert.match(AGENT_FILES_INSTRUCTION, /offered/);
    assert.match(AGENT_FILES_INSTRUCTION, /touches no script/);
    assert.equal(requestParts({ spec: SPEC }).some((p) => p.includes("THE AGENT'S OWN FILES")), false, "a spec.json alone has no files to show");
  });
});
