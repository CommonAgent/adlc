// eval-run.py signs a verdict that names the package it checked, by the
// archive's digest when the caller knows it, and says the verdict in the
// role's own words (fix pass, 2026-10-28: the auditor binds a verdict to a
// version by the digest it names, and none named one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(HERE, "..", "eval-run.py");
const PY = process.platform === "win32" ? "python" : "python3";
const SHA = "ab".repeat(32);

function run(spec, { work = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "eval-run-"));
  try {
    const path = join(dir, "spec.json");
    writeFileSync(path, JSON.stringify(spec));
    if (work) mkdirSync(join(dir, "work"));
    // No identity and no cases: nothing is sent, nothing is signed or filed.
    const p = spawnSync(PY, [RUN, path, "x.p@example.com", join(dir, "work"), join(dir, "no-identity.json")], { encoding: "utf8", env: { ...process.env, AGENTMESH_ENV: "example" } });
    const line = p.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    return JSON.parse(line).record;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the record names the archive's digest and version when the spec carries them", () => {
  const rec = run({ agent: "x", package_tree_sha256: "cd".repeat(32), subject_key: "U" + "A".repeat(55), cases: [], package_sha256: SHA, package_version: "1.2.0" });
  assert.equal(rec.package.sha256, SHA);
  assert.equal(rec.package.version, "1.2.0");
  assert.equal(rec.verdict, "conforms");
  assert.equal(rec.conforms, true);
});

test("a spec without them names neither, as before", () => {
  const rec = run({ agent: "x", subject_key: "U" + "A".repeat(55), cases: [] });
  assert.equal(rec.package.sha256, undefined);
  assert.equal(rec.package.version, undefined);
});

test("a promised record that is missing is does-not-conform, never rounded up", () => {
  const rec = run({ agent: "x", subject_key: "U" + "A".repeat(55), cases: [], records_required: ["run log"], records_files: ["*.log"] }, { work: true });
  assert.equal(rec.verdict, "does-not-conform");
  assert.equal(rec.conforms, false);
});

test("records in a folder this checker cannot read are not observed: inconclusive, never missing", () => {
  const rec = run({ agent: "x", subject_key: "U" + "A".repeat(55), cases: [], records_required: ["run log"], records_files: ["*.log"] });
  assert.equal(rec.verdict, "inconclusive");
  assert.deepEqual(rec.records_audit.missing, []);
  assert.deepEqual(rec.records_audit.unobserved, ["run log"]);
});
