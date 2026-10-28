// Reading what a review is given.
//   node --test test/read-change.test.mjs
//
// What is worth pinning: an archive keeps every path and loses the folder
// around it; loose files arrive under the process runner's prefixes and are
// put back where the package's build entry says they live, with the agent's
// own files found by content and tests under test/; a diff, the Code stage's
// account and an earlier review from this agent are told apart by content; a
// diff's repository paths are matched to the package's, with the lines it
// adds; a zip is said, not guessed at; and nothing given is ever run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff, plainName, readChange, roleOf, tarEntries, writeRead } from "../scripts/read-change.mjs";
import { badPackage, tarOf } from "./helpers.mjs";

const given = (dir, files) => Object.entries(files).map(([name, body], i) => {
  const at = join(dir, `${i}-Ab12cdEF-${name.split("/").pop()}`);
  writeFileSync(at, body);
  return { path: at, media_type: "" };
});

test("an archive keeps its paths and loses the one folder around them", () => {
  const files = Object.fromEntries(Object.entries(badPackage()).map(([p, t]) => [`bad/${p}`, t]));
  const entries = tarEntries(tarOf(files));
  assert.ok(entries.some((e) => e.path === "scripts/make.mjs"));
  assert.ok(entries.some((e) => e.path === "skills/make/SKILL.md"));
  assert.ok(entries.every((e) => !e.path.startsWith("bad/")));
  assert.equal(tarEntries(Buffer.from("not an archive")), null);
});

test("a package sent as a tar.gz is laid out with its roles and digests", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-read-"));
  try {
    const at = join(dir, "0-Ab12cdEF-bad.tgz");
    writeFileSync(at, tarOf({ ...badPackage(), "test/make.test.mjs": "import { test } from \"node:test\";\n" }));
    const r = readChange([{ path: at, media_type: "application/gzip" }]);
    assert.equal(r.archive, "bad.tgz");
    assert.equal(r.package.name, "bad");
    const role = Object.fromEntries(r.files.map((f) => [f.path, f.role]));
    assert.equal(role["agent-descriptor.json"], "declaration");
    assert.equal(role["skills/make/SKILL.md"], "declaration");
    assert.equal(role["scripts/make.mjs"], "script");
    assert.equal(role["test/make.test.mjs"], "test");
    assert.ok(r.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
    assert.equal(r.change.scope, "package");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("loose files are put back where the package keeps them", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-read-"));
  try {
    const pkg = badPackage();
    const files = given(dir, { ...pkg, "make.test.mjs": "import { test } from \"node:test\";\n" });
    const r = readChange(files);
    const paths = r.files.map((f) => f.path).sort();
    for (const p of ["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json", "skills/make/SKILL.md", "scripts/make.mjs", "scripts/pieces.mjs", "test/make.test.mjs"]) {
      assert.ok(paths.includes(p), `${p} not in ${paths.join(", ")}`);
    }
    assert.equal(plainName("3-Zz98yxWV-1-Ab12cdEF-make.mjs"), "make.mjs");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a diff, the account and an earlier review are found by content", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-read-"));
  try {
    const diff = "diff --git a/packages/x/bad/scripts/make.mjs b/packages/x/bad/scripts/make.mjs\n--- a/packages/x/bad/scripts/make.mjs\n+++ b/packages/x/bad/scripts/make.mjs\n@@ -3,2 +3,3 @@\n import { join } from \"node:path\";\n+export const MODEL = \"x\";\n const API = 1;\n";
    const files = [
      ...given(dir, badPackage()),
      ...given(dir, {
        "change.patch": diff,
        "account.md": "# The account\n\nI wrote make.mjs.\n",
        "findings.md": "# Review of bad 0.1.0\n\n- reviewed_by: code-critic 0.1.0\n",
      }),
    ];
    const r = readChange(files, { asked: "look at the model handling" });
    assert.equal(r.change.scope, "diff");
    assert.deepEqual(r.change.files.map((d) => [d.path, d.in_package, d.lines]), [["scripts/make.mjs", true, [4]]]);
    assert.equal(r.account.name, "account.md");
    assert.equal(r.earlier.name, "findings.md");
    assert.ok(!r.files.some((f) => /patch|account|findings/.test(f.path)));
    assert.equal(r.asked, "look at the model handling");
    const rec = mkdtempSync(join(tmpdir(), "cc-rec-"));
    writeRead(rec, r);
    for (const n of ["read.json", "account.md", "earlier-review.md", "change.diff", "package/scripts/make.mjs"]) assert.ok(existsSync(join(rec, n)), n);
    assert.equal(JSON.parse(readFileSync(join(rec, "read.json"), "utf8")).texts, undefined);
    rmSync(rec, { recursive: true, force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a diff is read for the lines it adds on the new side", () => {
  const d = parseDiff("--- a/s.mjs\n+++ b/s.mjs\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n+C\n c\n@@ -10,1 +11,1 @@\n-x\n+y\n");
  assert.deepEqual(d, [{ from: "s.mjs", path: "s.mjs", lines: [2, 3, 11], removed: 2, deleted: false }]);
});

test("a zip is said, not guessed at", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-read-"));
  try {
    const at = join(dir, "pkg.zip");
    writeFileSync(at, Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(40)]));
    const r = readChange([{ path: at }]);
    assert.equal(r.files.length, 0);
    assert.match(r.notes[0], /zip archive, which is not read here/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("each file's role is read from its path", () => {
  assert.equal(roleOf("rules.md"), "declaration");
  assert.equal(roleOf("references/a.test.mjs"), "reference");
  assert.equal(roleOf("scripts/node_modules/x/index.js"), "other");
  assert.equal(roleOf("records/build-0.1.0.md"), "other");
  assert.equal(roleOf("scripts/x.py"), "script");
});

test("a pax header's long path, and git archive's global header, are read the way tar reads them", () => {
  const long = `${"deep/".repeat(25)}x.mjs`;
  const rec = (k, v) => { let n = k.length + v.length + 3; n += String(n).length; if (String(n).length !== String(n - String(n).length).length) n += 1; return `${n} ${k}=${v}\n`; };
  const entries = tarEntries(tarOf({
    pax_global_header: { type: "g", body: rec("comment", "abc123") },
    "PaxHeader/x.mjs": { type: "x", body: rec("path", long) },
    "x.mjs": "export const a = 1;\n",
    "plugin.json": "{}\n",
  }, { gzip: false }));
  assert.deepEqual(entries.map((e) => e.path), [long, "plugin.json"]);
});
