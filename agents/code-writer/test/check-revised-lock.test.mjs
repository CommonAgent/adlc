// The local check after the tests were revised on the branch (technical debt 636).
//   node --test test/check-revised-lock.test.mjs
//
// When a build goes back to Test, the revised tests come back to the hand-off
// branch as a new commit that also moves build.lock.json to their digests. A
// coding agent that ran `node .adlc/check.mjs` before then holds a record of
// the old lock under records/, and the check compared the clone against that
// record, so it called the revised tests changed by the coding agent (seen in
// acronym-maker's round on dev, where Claude Code had to move the record
// aside by hand). The check now takes a new lock as the new baseline when the
// record came from a build folder's lock; a change the coding agent made to a
// pinned file still breaks the fence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { recordFromLock, recordIsStale } from "../scripts/check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(here, "..", "scripts");
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const TEST_V1 = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("two and two are five", () => { assert.equal(add(2, 2), 5); });\n';
const TEST_V2 = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("two and two are four", () => { assert.equal(add(2, 2), 4); });\n';
const lockFor = (testText) => ({ build_lock: "v1", digests: { "test/add.test.mjs": sha(testText), "AGENTS.md": sha("rules\n") }, scripts: [{ path: "scripts/add.mjs", from: "stub" }] });

test("a record taken from a build folder's lock is stale once the lock on disk is a different one, and not before", () => {
  const lockBytes = Buffer.from(JSON.stringify(lockFor(TEST_V1)));
  const record = recordFromLock(JSON.parse(lockBytes), lockBytes, { folder: "/w", roundsMax: 30 });
  assert.equal(record.from_build_folder, true);
  assert.deepEqual(record.digests, lockFor(TEST_V1).digests);
  assert.equal(recordIsStale(record, lockBytes), false);
  assert.equal(recordIsStale(record, Buffer.from(JSON.stringify(lockFor(TEST_V2)))), true);
  assert.equal(recordIsStale({ ...record, from_build_folder: false }, Buffer.from("{}")), false, "a workspace laid out by workspace.mjs keeps its own record");
});

test("as a process: the revised tests and their new lock pass the fence, a test the coding agent changes still does not", () => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-revised-lock-"));
  try {
    const put = (rel, text) => { mkdirSync(dirname(join(at, rel)), { recursive: true }); writeFileSync(join(at, rel), text); };
    put("AGENTS.md", "rules\n");
    put("test/add.test.mjs", TEST_V1);
    put("scripts/add.mjs", "export function add(a, b) { return a + b; }\n");
    for (const f of ["check.mjs", "workspace.mjs", "agent-folder.mjs", "archive.mjs"]) { mkdirSync(join(at, ".adlc"), { recursive: true }); copyFileSync(join(scriptsDir, f), join(at, ".adlc", f)); }
    put("build.lock.json", JSON.stringify(lockFor(TEST_V1), null, 2) + "\n");
    const run = () => {
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_") || k === "WORKSPACE" || k === "RECORDS") delete env[k];
      return spawnSync("node", [join(at, ".adlc", "check.mjs")], { cwd: at, encoding: "utf8", env });
    };
    const first = run();
    assert.equal(first.status, 1, first.stdout + first.stderr);
    assert.match(first.stdout, /two and two are five/);
    // The revision commit: the test and the lock move together.
    put("test/add.test.mjs", TEST_V2);
    put("build.lock.json", JSON.stringify(lockFor(TEST_V2), null, 2) + "\n");
    const second = run();
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /^Done\./);
    assert.match(readFileSync(join(at, "records", "workspace.json"), "utf8"), new RegExp(sha(TEST_V2).replace("sha256:", "")));
    // The coding agent changes the test itself: still the fence.
    put("test/add.test.mjs", TEST_V2.replace("four", "4"));
    const third = run();
    assert.equal(third.status, 3, third.stdout + third.stderr);
    assert.match(third.stdout, /test\/add\.test\.mjs changed/);
  } finally { rmSync(at, { recursive: true, force: true }); }
});
