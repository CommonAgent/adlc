// The job on adoption, with the model stood in: the role's own checks
// (agentroles.ai/reverse-engineer.html, section 40.4) on fixture codebases.
// Every behavior delivered names a file and line that exists; claims with
// bad evidence, a judgment or an inference are gaps; the unreachable function
// is a gap and not a behavior; the setting is named with no value; the
// dependencies are CycloneDX; the tests are listed with what they cover and
// one baseline run; it declines to judge and to write tests.
//   node --test test/describe.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runJob } from "../scripts/describe.mjs";
import { pack } from "../scripts/archive.mjs";
import { codebase, job, pieceBytes, readPiece, REPOSITORY, standIn } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

/** This process's environment without the model settings, by exact name, so
 *  only a stand-in answers. */
function testEnv() {
  const env = { ...process.env };
  for (const k of ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL", "MODEL_MAX_OUTPUT_TOKENS", "TEXT_MODEL", "TEXT_API_KEY"]) delete env[k];
  return env;
}

test("adoption: the node-app described at its commit, read and run, every claim checked", async () => {
  const cb = codebase("node-app");
  const j = job({ root: cb.root, codebase: cb.dir, commit: cb.commit, mayRun: "yes" });
  const model = standIn("node-app.json");
  const out = await runJob(j.argv, testEnv(), { call: model.call });
  assert.equal(out.code, 0, out.reply);

  const record = readPiece(j.jobDir, "record.json");
  assert.deepEqual([record.format, record.repository, record.commit, record.commit_checked, record.read_mode, record.trigger, record.drafted, record.done],
    ["as-built-record-v1", REPOSITORY, cb.commit, true, "read and run", "adoption", true, true]);
  assert.deepEqual(record.parts.map((p) => p.file), ["behaviors.json", "architecture.json", "interfaces.json", "sbom.cdx.json", "tests-and-gaps.json"]);

  // Behaviors: the six with evidence that checks, in the feature list's shape.
  const { behaviors } = readPiece(j.jobDir, "behaviors.json");
  assert.deepEqual(behaviors.map((b) => b.id), ["B1", "B2", "B3", "B4", "B5", "B6"]);
  for (const b of behaviors) {
    assert.ok(b.name && b.does && b.evidence.length, b.id);
    assert.equal(b.as_built, true);
    for (const e of b.evidence) {
      const lines = readFileSync(join(cb.dir, e.file), "utf8").split("\n").length;
      assert.ok(e.line >= 1 && e.line <= lines, `${b.id} cites ${e.file}:${e.line}`);
    }
  }
  assert.equal(behaviors.find((b) => b.id === "B6").offering, "greet");
  assert.ok(!("offering" in behaviors[0]), "no offering where the code shows none");
  // The quirk is recorded as what the code does, not as a bug.
  assert.match(behaviors.find((b) => b.id === "B5").does, /no exclamation mark/);

  // Gaps: bad evidence, the judgment, the unreachable function, each marked.
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  const kinds = (k) => tg.gaps.filter((g) => g.kind === k).map((g) => g.about);
  assert.deepEqual(kinds("claim-without-evidence").length, 5);
  assert.ok(kinds("claim-without-evidence").some((a) => /Greet in French/.test(a)));
  assert.ok(kinds("claim-without-evidence").some((a) => /API_TOKEN/.test(a)));
  assert.ok(kinds("claim-without-evidence").some((a) => /GET \/greet/.test(a)));
  assert.deepEqual(kinds("held-back").length, 1);
  assert.match(kinds("unreachable")[0], /unusedHelper/);
  assert.ok(!behaviors.some((b) => /unusedHelper/.test(JSON.stringify(b))), "the unreachable function is not a behavior");
  for (const g of tg.gaps) assert.match(g.id, /^G\d+$/);

  // Architecture: the setting named with no value, entry points read by rule.
  const arch = readPiece(j.jobDir, "architecture.json");
  assert.deepEqual([arch.record, arch.as_built], ["architecture-record-v1", true]);
  assert.deepEqual(arch.settings, [{ name: "GREETING_STYLE", credential: false, evidence: [{ file: "src/index.js", line: 2 }] }]);
  assert.doesNotMatch(JSON.stringify(arch), /"plain"|"loud"/, "no setting's value is written");
  assert.deepEqual(arch.entry_points.map((e) => e.name), ["src/index.js", "bin/greet.js"]);

  // Interfaces: the derived JSON Schema is delivered as its own file.
  const ifs = readPiece(j.jobDir, "interfaces.json");
  assert.deepEqual(ifs.interfaces.map((i) => [i.id, i.kind]), [["I1", "command"], ["I2", "function"]]);
  assert.equal(ifs.interfaces[1].schema, "schemas/I2.schema.json");
  assert.equal(readPiece(j.jobDir, "schemas/I2.schema.json").type, "string");

  // Dependencies: CycloneDX, naming every package.
  const bom = readPiece(j.jobDir, "sbom.cdx.json");
  assert.equal(bom.bomFormat, "CycloneDX");
  assert.deepEqual(bom.components.map((c) => c.name), ["debug", "is-number", "left-pad", "ms"]);

  // Tests: listed with their cases, what they cover, and one baseline run.
  assert.deepEqual(tg.tests.map((t) => [t.file, t.cases.length, t.covers]), [["test/greet.test.js", 3, ["B1", "B2", "B3"]]]);
  assert.deepEqual(tg.test_command.command, "node --test");
  assert.equal(tg.baseline.ran, true);
  assert.deepEqual([tg.baseline.exit_code, tg.baseline.passed, tg.baseline.failed], [0, 3, 0], tg.baseline.output_tail);
  assert.deepEqual(tg.behaviors_without_tests, ["B4", "B5", "B6"]);
  assert.doesNotMatch(JSON.stringify(tg), new RegExp(cb.dir.replace(/[\\]/g, "\\\\").replace(/[.*+?^${}()|[\]]/g, "\\$&")), "no local path in the record");

  // The prompt showed the code with line numbers, and the delivery is in its declared formats.
  assert.match(model.prompts[0], /=== src\/index\.js\n\s+1\| \/\/ Greets people by name\./);
  assert.deepEqual(checkDelivered(j.jobDir), []);
  assert.deepEqual(out.listed, ["as-built record", "behaviors", "architecture as built", "interfaces", "dependencies", "existing tests and gaps", "json schema (schemas/I2.schema.json)"]);
  assert.ok(existsSync(join(j.recordsDir, "draft.json")));
  assert.ok(existsSync(join(j.recordsDir, "baseline.log")));
});

test("asked whether the quirk is a bug and to write the missing tests, it declines both and still describes", async () => {
  const cb = codebase("node-app");
  const j = job({ root: cb.root, codebase: cb.dir, commit: cb.commit, message: "Is this a bug that farewell has no exclamation mark? And write tests for the uncovered behaviors." });
  const out = await runJob(j.argv, testEnv(), { call: standIn("node-app.json").call });
  assert.equal(out.code, 0);
  assert.deepEqual(out.declined, ["judging", "writing-tests"]);
  assert.match(out.reply, /^I will not do that part: I describe what the code does and never say whether it is right, wrong, wanted or a bug\. The person decides at Requirements/);
  assert.match(out.reply, /I write no tests\. Test writes the characterization tests/);
  assert.ok(existsSync(join(j.jobDir, "out", "as-built", "record.json")));
  assert.ok(!existsSync(join(cb.dir, "test", "farewell.test.js")));
});

test("read only: no run, the read mode says so, and run-time behavior is a gap", async () => {
  const cb = codebase("node-app");
  const j = job({ root: cb.root, codebase: cb.dir, commit: cb.commit });
  const out = await runJob(j.argv, testEnv(), { call: standIn("node-app.json").call });
  const record = readPiece(j.jobDir, "record.json");
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  assert.equal(out.code, 0);
  assert.equal(record.read_mode, "read");
  assert.deepEqual(tg.baseline, { ran: false, why: "running was not allowed for this job, so the code was only read" });
  assert.ok(tg.gaps.some((g) => g.kind === "run-time-only"));
});

test("the same codebase and the same draft give the same parts, byte for byte", async () => {
  const cb = codebase("node-app");
  const one = job({ root: cb.root, id: "one", codebase: cb.dir, commit: cb.commit });
  const two = job({ root: cb.root, id: "two", codebase: cb.dir, commit: cb.commit });
  await runJob(one.argv, testEnv(), { call: standIn("node-app.json").call });
  await runJob(two.argv, testEnv(), { call: standIn("node-app.json").call });
  for (const f of ["record.json", "behaviors.json", "architecture.json", "interfaces.json", "sbom.cdx.json", "tests-and-gaps.json"]) {
    assert.ok(pieceBytes(one.jobDir, f).equals(pieceBytes(two.jobDir, f)), f);
  }
});

test("no tests and no model: the parts read by rule are delivered, the drafted parts are gaps", async () => {
  const cb = codebase("no-tests");
  const j = job({ root: cb.root, codebase: cb.dir, commit: cb.commit, mayRun: "yes", repository: "https://git.example.com/acme/notes-api" });
  const out = await runJob(j.argv, testEnv());
  assert.equal(out.code, 0, out.reply);
  assert.match(out.reply, /No model drafted from the code/);
  const record = readPiece(j.jobDir, "record.json");
  assert.deepEqual([record.drafted, record.read_mode], [false, "read"]);
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  assert.deepEqual(tg.tests, []);
  assert.match(tg.test_command.none, /npm's placeholder/);
  assert.deepEqual(tg.baseline.ran, false);
  assert.match(tg.baseline.why, /placeholder/);
  assert.deepEqual(tg.gaps.filter((g) => g.kind === "not-drafted").map((g) => g.part), ["behaviors", "architecture as built", "interfaces", "what each test covers"]);
  assert.ok(tg.gaps.some((g) => /no lockfile sits beside it/.test(g.why)));
  const arch = readPiece(j.jobDir, "architecture.json");
  assert.deepEqual(arch.settings.map((s) => [s.name, s.credential, s.evidence[0].line]), [["DB_PASSWORD", true, 4], ["PORT", false, 3]]);
  const bom = readPiece(j.jobDir, "sbom.cdx.json");
  assert.deepEqual(bom.components.map((c) => [c.name, c.version]), [["express", "^4.18.0"]]);
  assert.deepEqual(readPiece(j.jobDir, "behaviors.json").behaviors, []);
  assert.ok(out.went_without.some((w) => w.wanted === "a model to draft from the code"));
  assert.deepEqual(checkDelivered(j.jobDir), []);
});

test("a folder with no history is described with the commit taken as given, and said", async () => {
  const cb = codebase("node-app", { checkout: false });
  const j = job({ root: cb.root, codebase: cb.dir, commit: "1234567890abcdef1234567890abcdef12345678" });
  const out = await runJob(j.argv, testEnv(), { call: standIn("node-app.json").call });
  assert.equal(out.code, 0, out.reply);
  const record = readPiece(j.jobDir, "record.json");
  assert.equal(record.commit_checked, false);
  assert.ok(readPiece(j.jobDir, "tests-and-gaps.json").gaps.some((g) => g.kind === "not-checked"));
  assert.match(out.reply, /taken as given/);
});

test("the codebase attached as a gzip tar with its history is unpacked and checked", async () => {
  const cb = codebase("node-app");
  const archive = join(cb.root, "attached", "code.tar.gz");
  mkdirSync(join(cb.root, "attached"), { recursive: true });
  pack(cb.dir, archive);
  const j = job({ root: cb.root, commit: cb.commit, files: [{ path: archive, type: "application/gzip" }] });
  const out = await runJob(j.argv, testEnv(), { call: standIn("node-app.json").call });
  assert.equal(out.code, 0, out.reply);
  const record = readPiece(j.jobDir, "record.json");
  assert.deepEqual([record.commit, record.commit_checked], [cb.commit, true]);
});

test("it stops, saying what it needs, without the repository, at another commit, or with changes", async () => {
  const cb = codebase("node-app");
  const noRepo = job({ root: cb.root, id: "no-repo", codebase: cb.dir, commit: cb.commit, repository: "" });
  const a = await runJob(noRepo.argv, testEnv(), { call: standIn("node-app.json").call });
  assert.equal(a.code, 3);
  assert.match(a.reply, /I need the repository's address/);

  const other = job({ root: cb.root, id: "other", codebase: cb.dir, commit: "0".repeat(40) });
  const b = await runJob(other.argv, testEnv(), { call: standIn("node-app.json").call });
  assert.equal(b.code, 3);
  assert.match(b.reply, /not in its history/);

  appendFileSync(join(cb.dir, "src", "index.js"), "// changed by hand\n");
  const dirty = job({ root: cb.root, id: "dirty", codebase: cb.dir, commit: cb.commit });
  const c = await runJob(dirty.argv, testEnv(), { call: standIn("node-app.json").call });
  assert.equal(c.code, 3);
  assert.match(c.reply, /tracked files changed since the commit \(src\/index\.js\)/);
  assert.ok(!existsSync(join(dirty.jobDir, "out")), "nothing is delivered");
});
