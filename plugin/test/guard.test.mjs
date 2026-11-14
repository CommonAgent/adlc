// The hooks: the person's approval is never the assistant's; the approved
// spec, the fixed tests, the lock file and the check are not edited; and the
// build does not stop with such a file changed, or while the tests are fixed
// and the build still fails.
//
//   node --test plugin/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveIfSaid, buildFolderOf, commandRefusal, keepSaid, pre, stop, writeRefusal } from "../hooks/guard.mjs";

test("what the person says is kept in said.md of each build folder still being built, and the builder never writes it", () => {
  const root = mkdtempSync(join(tmpdir(), "adlc-said-"));
  try {
    const open = join(root, "agents", "a");
    const done = join(root, "agents", "b");
    for (const d of [open, done]) { mkdirSync(join(d, ".adlc"), { recursive: true }); writeFileSync(join(d, ".adlc", "check.mjs"), ""); }
    writeFileSync(join(open, "build.lock.json"), JSON.stringify({ build_lock: "v1", digests: {}, gates: { spec: { passed: true } } }));
    writeFileSync(join(done, "build.lock.json"), JSON.stringify({ build_lock: "v1", digests: {}, gates: { spec: { passed: true }, build: { passed: true } } }));
    assert.deepEqual(keepSaid({ cwd: root, prompt: "0 USD per job." }, { now: () => "2026-11-12T19:00:00Z" }), [open]);
    assert.match(readFileSync(join(open, "said.md"), "utf8"), /## 2026-11-12T19:00:00Z\n\n0 USD per job\.\n/);
    assert.equal(existsSync(join(done, "said.md")), false, "a build that has passed is not being talked to");
    mkdirSync(join(open, "scripts"));
    keepSaid({ cwd: join(open, "scripts"), prompt: "Yes." });
    assert.match(readFileSync(join(open, "said.md"), "utf8"), /0 USD per job\.[\s\S]*Yes\./);
    assert.deepEqual(keepSaid({ cwd: root, prompt: "Follow AGENTS.md in this folder." }, { env: { ADLC_NOT_THE_PERSON: "1" } }), [], "a program's prompts are not the person's");
    assert.doesNotMatch(readFileSync(join(open, "said.md"), "utf8"), /Follow AGENTS\.md/);
    assert.match(writeRefusal(join(open, "said.md"), root), /^said\.md is the person's own words/);
    assert.match(commandRefusal("echo yes >> said.md", open), /^said\.md is the person's own words/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the person's typed approval runs the waiting folder's own approve.mjs; other words, a program, or no waiting spec do not", () => {
  const root = mkdtempSync(join(tmpdir(), "adlc-approve-"));
  try {
    const waiting = join(root, "agents", "a");
    const approved = join(root, "agents", "b");
    for (const d of [waiting, approved]) { mkdirSync(join(d, ".adlc"), { recursive: true }); writeFileSync(join(d, ".adlc", "check.mjs"), ""); }
    writeFileSync(join(approved, "build.lock.json"), JSON.stringify({ build_lock: "v1", digests: {}, gates: { spec: { passed: true } } }));
    const runs = [];
    const run = (cmd, args, opts) => { runs.push({ cmd, args, cwd: opts.cwd }); return { stdout: "Approved. The spec can no longer change, and the build starts.\n" }; };
    for (const words of ["approve", "Approve.", "I approve", "approve the spec", "yes, approve it", "Approved!"]) {
      const a = approveIfSaid({ cwd: root, prompt: words }, { env: {}, run });
      assert.equal(a?.dir, waiting, words);
      assert.match(a.said, /Approved\. The spec can no longer change/);
    }
    assert.deepEqual(runs[0], { cmd: "node", args: [join(waiting, ".adlc", "approve.mjs")], cwd: waiting });
    runs.length = 0;
    for (const words of ["don't approve yet", "what does approve do?", "approve it once the price is 5 USD", "looks good"]) {
      assert.equal(approveIfSaid({ cwd: root, prompt: words }, { env: {}, run }), null, words);
    }
    assert.equal(approveIfSaid({ cwd: root, prompt: "approve" }, { env: { ADLC_NOT_THE_PERSON: "1" }, run }), null, "a program's prompts are not the person's");
    assert.equal(approveIfSaid({ cwd: approved, prompt: "approve" }, { env: {}, run }), null, "an approved spec is not approved again");
    assert.equal(runs.length, 0);
    const other = join(root, "agents", "c");
    mkdirSync(join(other, ".adlc"), { recursive: true }); writeFileSync(join(other, ".adlc", "check.mjs"), "");
    const two = approveIfSaid({ cwd: root, prompt: "approve" }, { env: {}, run });
    assert.equal(two.dir, undefined);
    assert.match(two.said, /2 build folders .* nothing was approved/);
    assert.equal(runs.length, 0, "with two specs waiting, neither is approved");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function folder() {
  const dir = mkdtempSync(join(tmpdir(), "adlc-guard-"));
  mkdirSync(join(dir, ".adlc"), { recursive: true });
  writeFileSync(join(dir, ".adlc", "check.mjs"), "");
  writeFileSync(join(dir, "build.lock.json"), JSON.stringify({ build_lock: "v1", digests: { "spec.json": "sha256:x", "test/a.test.mjs": "sha256:y" }, gates: { spec: { passed: true } }, tests_fixed: { at: "2026-11-12" } }));
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
    for (const c of ["node .adlc/approve.mjs", "node .adlc\\approve.mjs --send-back build", "cd x && node ./.adlc/approve.mjs"]) {
      assert.match(commandRefusal(c, dir), /is the person's approval/, c);
    }
    assert.equal(commandRefusal("node .adlc/check.mjs", dir), null);
    assert.equal(commandRefusal("node .adlc/generate.mjs files", dir), null);
    assert.equal(commandRefusal("node --test test/", dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the approved spec, a fixed test, the lock file and the check are not edited; scripts are", () => {
  const dir = folder();
  try {
    assert.match(pre({ cwd: dir, tool_name: "Edit", tool_input: { file_path: join(dir, "spec.json") } }).deny, /^spec\.json can no longer change\. .*--send-back spec/);
    assert.match(pre({ cwd: dir, tool_name: "Edit", tool_input: { file_path: join(dir, "test", "a.test.mjs") } }).deny, /^test\/a\.test\.mjs can no longer change\. .*--send-back build/);
    assert.match(pre({ cwd: dir, tool_name: "Write", tool_input: { file_path: join(dir, "build.lock.json") } }).deny, /lock file/);
    assert.match(pre({ cwd: dir, tool_name: "Edit", tool_input: { file_path: join(dir, ".adlc", "stages.mjs") } }).deny, /the ADLC check/);
    assert.deepEqual(pre({ cwd: dir, tool_name: "Write", tool_input: { file_path: join(dir, "scripts", "a.mjs") } }), {});
    assert.match(pre({ cwd: dir, tool_name: "Bash", tool_input: { command: "echo {} > build.lock.json" } }).deny, /lock file/);
    assert.match(pre({ cwd: dir, tool_name: "PowerShell", tool_input: { command: "Set-Content .adlc/check.mjs ''" } }).deny, /the ADLC check/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the build does not stop with a fixed file changed, or while the tests are fixed and it still fails; asked only once", () => {
  const dir = folder();
  try {
    const answer = (doc) => () => ({ stdout: JSON.stringify(doc) });
    assert.match(stop({ cwd: dir }, { run: answer({ code: 3, phase: "build", problems: ["spec.json can no longer change, and it changed"] }) }).block, /A file that can no longer change was changed/);
    assert.match(stop({ cwd: dir }, { run: answer({ code: 1, phase: "build", tests_fixed: true, problems: ["Code: the suite fails"] }) }).block, /The tests are fixed and the build still fails its check/);
    assert.deepEqual(stop({ cwd: dir }, { run: answer({ code: 1, phase: "build", tests_fixed: false, problems: ["Architecture: the person has not answered egress-1"] }) }), {}, "the builder may stop to ask the person while it builds");
    assert.deepEqual(stop({ cwd: dir }, { run: answer({ code: 1, phase: "spec", problems: ["the empty case is not stated"] }) }), {});
    assert.deepEqual(stop({ cwd: dir }, { run: answer({ code: 4, phase: "spec", problems: [] }) }), {});
    assert.deepEqual(stop({ cwd: dir, stop_hook_active: true }, { run: answer({ code: 3, phase: "build", problems: ["x"] }) }), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
