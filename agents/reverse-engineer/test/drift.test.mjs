// Drift: a codebase with two commits. The record made at the first is given
// with the second, and the new record covers only what changed between them:
// the changed behavior keeps its id, the new one takes the next number, claims
// about unchanged lines are outside the change, settings are read only on
// changed lines, and the bill of materials says what was added.
//   node --test test/drift.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runJob } from "../scripts/describe.mjs";
import { codebase, commitAll, FIXTURES, git, job, readPiece, standIn } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

function testEnv() {
  const env = { ...process.env };
  for (const k of ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL", "MODEL_MAX_OUTPUT_TOKENS", "TEXT_MODEL", "TEXT_API_KEY"]) delete env[k];
  return env;
}

/** The drift fixture at its first commit, described; then its second commit. */
async function twoCommits() {
  const cb = codebase("drift/v1");
  const first = cb.commit;
  const adopt = job({ root: cb.root, id: "adopt", codebase: cb.dir, commit: first });
  const a = await runJob(adopt.argv, testEnv(), { call: standIn("drift-v1.json").call });
  assert.equal(a.code, 0, a.reply);
  cpSync(join(FIXTURES, "drift", "v2"), cb.dir, { recursive: true });
  const second = commitAll(cb.dir, "v2: tax, a discount and a new dependency");
  return { cb, first, second, adopt, lastRecord: join(adopt.jobDir, "out", "as-built", "record.json"), lastBehaviors: join(adopt.jobDir, "out", "as-built", "behaviors.json") };
}

test("drift covers only the files and lines that changed since the last record", async () => {
  const { cb, first, second, lastRecord } = await twoCommits();
  const j = job({ root: cb.root, id: "drift", codebase: cb.dir, commit: second, files: [{ path: lastRecord, type: "application/vnd.agentmesh.as-built-record+json" }] });
  const model = standIn("drift-v2.json");
  const out = await runJob(j.argv, testEnv(), { call: model.call });
  assert.equal(out.code, 0, out.reply);

  const record = readPiece(j.jobDir, "record.json");
  assert.deepEqual([record.trigger, record.commit, record.since.commit], ["drift", second, first]);
  assert.deepEqual(record.changed_files.map((c) => [c.file, c.status]), [["package-lock.json", "modified"], ["package.json", "modified"], ["src/discount.js", "added"], ["src/price.js", "modified"]]);
  assert.ok(!record.changed_files.some((c) => c.file === "src/format.js"), "the unchanged file is not in the change");

  // The model was shown the changed files and the diff, not the unchanged file.
  assert.match(model.prompts[0], /This is drift/);
  assert.match(model.prompts[0], /=== src\/price\.js/);
  assert.match(model.prompts[0], /=== src\/discount\.js/);
  assert.doesNotMatch(model.prompts[0], /=== src\/format\.js/);
  assert.doesNotMatch(model.prompts[0], /diff --git a\/package-lock\.json/, "the lockfile is read by rule, not shown in the diff");

  // Behaviors: the changed one keeps its id, the new one takes the next.
  const { behaviors } = readPiece(j.jobDir, "behaviors.json");
  assert.deepEqual(behaviors.map((b) => [b.id, b.change, b.was ?? null]), [["B1", "changed", "B1"], ["B4", "new", null]]);
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  assert.deepEqual(tg.gaps.filter((g) => g.kind === "outside-the-change").map((g) => g.about.split(":")[0]), ["Receipt line", "Money format"]);

  // Settings only from changed lines; the bill of materials says what was added.
  assert.deepEqual(readPiece(j.jobDir, "architecture.json").settings.map((s) => s.name), ["TAX_RATE"]);
  assert.deepEqual(record.dependencies_changed, { added: [{ name: "ms", version: "2.1.2" }], removed: [], changed: [] });
  assert.ok(readPiece(j.jobDir, "sbom.cdx.json").components.some((c) => c.name === "ms"));

  // The unchanged test file is not described again.
  assert.deepEqual(tg.tests, []);
  assert.match(tg.in_scope, /only the test files that changed/);
  assert.deepEqual(checkDelivered(j.jobDir), []);
});

test("with no manifest changed, drift delivers no bill of materials and says the dependencies stand", async () => {
  const { cb, second, lastRecord, lastBehaviors } = await twoCommits();
  // A third commit that only edits code, described against the record at the second.
  const at2 = job({ root: cb.root, id: "at-two", codebase: cb.dir, commit: second, files: [{ path: lastRecord }] });
  await runJob(at2.argv, testEnv(), { call: standIn("drift-v2.json").call });
  writeFileSync(join(cb.dir, "src", "discount.js"), "function discount(amount, percent) {\n  return amount * (1 - percent / 100);\n}\n\nmodule.exports = { discount };\n");
  const third = commitAll(cb.dir, "v3: no range check");
  const j = job({ root: cb.root, id: "drift-3", codebase: cb.dir, commit: third, files: [{ path: join(at2.jobDir, "out", "as-built", "record.json") }, { path: lastBehaviors }] });
  const out = await runJob(j.argv, testEnv(), { call: standIn("drift-v2.json").call });
  assert.equal(out.code, 0, out.reply);
  const record = readPiece(j.jobDir, "record.json");
  assert.deepEqual(record.changed_files.map((c) => c.file), ["src/discount.js"]);
  assert.deepEqual(record.dependencies, { unchanged_since: second });
  assert.ok(!existsSync(join(j.jobDir, "out", "as-built", "sbom.cdx.json")));
  assert.ok(!record.parts.some((p) => p.file === "sbom.cdx.json"));
  // Every claim the stand-in repeats about src/price.js is outside this change.
  assert.ok(!readPiece(j.jobDir, "behaviors.json").behaviors.some((b) => b.evidence.some((e) => e.file === "src/price.js")));
});

test("the same commit as the last record: nothing changed, and nothing is drafted", async () => {
  const { cb, first, lastRecord } = await twoCommits();
  git(cb.dir, ["checkout", "-q", first]);
  const model = standIn("drift-v2.json");
  const j = job({ root: cb.root, id: "same", codebase: cb.dir, commit: first, files: [{ path: lastRecord }] });
  const out = await runJob(j.argv, testEnv(), { call: model.call });
  assert.equal(out.code, 0, out.reply);
  assert.equal(model.prompts.length, 0);
  const record = readPiece(j.jobDir, "record.json");
  assert.deepEqual([record.nothing_changed, record.changed_files, record.counts.behaviors], [true, [], 0]);
});

test("drift needs the history: a last record whose commit is not in it stops the job", async () => {
  const { cb, second } = await twoCommits();
  const fake = join(cb.root, "fake-record.json");
  writeFileSync(fake, JSON.stringify({ format: "as-built-record-v1", repository: "https://git.example.com/acme/greeter.git", commit: "f".repeat(40) }));
  const j = job({ root: cb.root, id: "fake", codebase: cb.dir, commit: second, files: [{ path: fake }] });
  const out = await runJob(j.argv, testEnv(), { call: standIn("drift-v2.json").call });
  assert.equal(out.code, 3);
  assert.match(out.reply, /not in the codebase's history/);
});
