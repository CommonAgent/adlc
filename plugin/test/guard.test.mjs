// The hooks: the person's approval is never the assistant's, a pinned file,
// the pin file and the check are not edited, and the build does not stop with
// a pin moved or with Code failing.
//
//   node --test plugin/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFolderOf, commandRefusal, pre, stop, writeRefusal } from "../hooks/guard.mjs";

function folder() {
  const dir = mkdtempSync(join(tmpdir(), "adlc-guard-"));
  mkdirSync(join(dir, ".adlc"), { recursive: true });
  writeFileSync(join(dir, ".adlc", "check.mjs"), "");
  writeFileSync(join(dir, "build.lock.json"), JSON.stringify({ build_lock: "v1", digests: { "spec.json": "sha256:x" }, gates: { requirements: { passed: true } } }));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  return dir;
}

test("the build folder is found from a file or a folder inside it, and nothing outside one is guarded", () => {
  const dir = folder();
  try {
    assert.equal(buildFolderOf(join(dir, "scripts")), dir);
    assert.equal(writeRefusal(join(tmpdir(), "elsewhere.json"), tmpdir()), null);
    assert.equal(commandRefusal("node approve.mjs", tmpdir()), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the assistant never runs the person's approval", () => {
  const dir = folder();
  try {
    for (const c of ["node .adlc/approve.mjs", "node .adlc\\approve.mjs --send-back test", "cd x && node ./.adlc/approve.mjs"]) {
      assert.match(commandRefusal(c, dir), /is the person's approval/, c);
    }
    assert.equal(commandRefusal("node .adlc/check.mjs", dir), null);
    assert.equal(commandRefusal("node .adlc/generate.mjs files", dir), null);
    assert.equal(commandRefusal("node --test test/", dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a pinned file, the pin file and the check are not edited; scripts are", () => {
  const dir = folder();
  try {
    assert.match(pre({ cwd: dir, tool_name: "Edit", tool_input: { file_path: join(dir, "spec.json") } }).deny, /^spec\.json is pinned/);
    assert.match(pre({ cwd: dir, tool_name: "Write", tool_input: { file_path: join(dir, "build.lock.json") } }).deny, /pin file/);
    assert.match(pre({ cwd: dir, tool_name: "Edit", tool_input: { file_path: join(dir, ".adlc", "stages.mjs") } }).deny, /the ADLC check/);
    assert.deepEqual(pre({ cwd: dir, tool_name: "Write", tool_input: { file_path: join(dir, "scripts", "a.mjs") } }), {});
    assert.match(pre({ cwd: dir, tool_name: "Bash", tool_input: { command: "echo {} > build.lock.json" } }).deny, /pin file/);
    assert.match(pre({ cwd: dir, tool_name: "PowerShell", tool_input: { command: "Set-Content .adlc/check.mjs ''" } }).deny, /the ADLC check/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the build does not stop with a pin moved or with Code failing, and is asked only once", () => {
  const dir = folder();
  try {
    const answer = (doc) => () => ({ stdout: JSON.stringify(doc) });
    assert.match(stop({ cwd: dir }, { run: answer({ code: 3, stage: "test", problems: ["spec.json is pinned and changed"] }) }).block, /A pinned file moved/);
    assert.match(stop({ cwd: dir }, { run: answer({ code: 1, stage: "code", problems: ["the suite fails"] }) }).block, /at Code and its check fails/);
    assert.deepEqual(stop({ cwd: dir }, { run: answer({ code: 1, stage: "requirements", problems: ["the empty case is not stated"] }) }), {});
    assert.deepEqual(stop({ cwd: dir }, { run: answer({ code: 4, stage: "requirements", problems: [] }) }), {});
    assert.deepEqual(stop({ cwd: dir, stop_hook_active: true }, { run: answer({ code: 3, stage: "code", problems: ["x"] }) }), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
