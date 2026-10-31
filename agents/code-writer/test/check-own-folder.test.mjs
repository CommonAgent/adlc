// The local check when a hand-off sits in a folder of its own (technical
// debts 653 and 632, 2026-10-31).
//   node --test test/check-own-folder.test.mjs
//
// Every hand-off used to land at the root of the repository it went to, so a
// second hand-off to the same repository wrote the same paths as the first:
// once one was merged, the other's pull request could never be merged
// (acronym-maker over word-reverser on AgentMesh-Dev-Test/handoff-proof), and
// this check read the earlier agent's files and tests as the new one's (debt
// 632, palindrome-judge over tally-words). Now each hand-off goes to its own
// folder, agents/<name>/, and the gate refuses any change outside it.
//
// So this check, run from agents/<name>/.adlc/, judges that folder alone: an
// earlier hand-off at the root is neither in its fence nor in its suite. And
// it agrees with the gate about everything outside the folder: a file there
// that was changed, removed or added since the hand-off breaks the fence by
// name. A build folder at the top of its repository has nothing outside it,
// as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { outsideChanges } from "../scripts/check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(here, "..", "scripts");
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const git = (cwd, ...args) => spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
const hasGit = git(process.cwd(), "--version").status === 0;
const ADLC = ["check.mjs", "workspace.mjs", "agent-folder.mjs", "archive.mjs"];

// The earlier agent, merged at the root: its test fails against anything but its own script.
const EARLIER_TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { count } from "../scripts/count.mjs";\ntest("three words", () => { assert.equal(count("a b c"), 3); });\n';
const ADD_TEST = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("two and two are four", () => { assert.equal(add(2, 2), 4); });\n';

/** A repository whose main holds an earlier hand-off at the root, and a new
 *  hand-off committed under agents/adder/ on top of it, with the coding
 *  agent's script written. Returns the repository and the folder. */
function repoWithTwoHandoffs(at) {
  const put = (rel, text) => { mkdirSync(dirname(join(at, rel)), { recursive: true }); writeFileSync(join(at, rel), text); };
  assert.equal(git(at, "init", "-q").status, 0);
  put("README.md", "a repository\n");
  put("AGENTS.md", "the earlier agent's rules\n");
  put("skills/count-words/SKILL.md", "count words\n");
  put("test/count.test.mjs", EARLIER_TEST);
  put("scripts/count.mjs", "export function count(s) { return s.split(' ').length; }\n");
  put("build.lock.json", JSON.stringify({ build_lock: "v1", digests: { "test/count.test.mjs": sha(EARLIER_TEST), "AGENTS.md": sha("the earlier agent's rules\n") }, scripts: [{ path: "scripts/count.mjs", from: "stub" }] }, null, 2) + "\n");
  git(at, "add", "-A"); git(at, "commit", "-q", "-m", "the earlier hand-off, merged");
  const f = "agents/adder";
  put(`${f}/AGENTS.md`, "rules\n");
  put(`${f}/test/add.test.mjs`, ADD_TEST);
  put(`${f}/scripts/add.mjs`, "export function add() { throw new Error('not written yet'); }\n");
  for (const n of ADLC) { mkdirSync(join(at, f, ".adlc"), { recursive: true }); copyFileSync(join(scriptsDir, n), join(at, f, ".adlc", n)); }
  const digests = { "test/add.test.mjs": sha(ADD_TEST), "AGENTS.md": sha("rules\n"), ...Object.fromEntries(ADLC.map((n) => [`.adlc/${n}`, sha(readFileSync(join(scriptsDir, n)))])) };
  put(`${f}/build.lock.json`, JSON.stringify({ build_lock: "v1", digests, scripts: [{ path: "scripts/add.mjs", from: "stub" }] }, null, 2) + "\n");
  git(at, "add", "-A"); git(at, "commit", "-q", "-m", "Hand off adder 0.1.0: the build folder");
  put(`${f}/scripts/add.mjs`, "export function add(a, b) { return a + b; }\n");
  return { put, folder: join(at, f) };
}

const runCheck = (folder) => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_") || k === "WORKSPACE" || k === "RECORDS") delete env[k];
  return spawnSync("node", [join(folder, ".adlc", "check.mjs")], { cwd: folder, encoding: "utf8", env });
};

test("as a process: a hand-off in its own folder beside an earlier one at the root is done when its suite passes (debt 632)", { skip: !hasGit && "git is not on this host" }, () => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-own-folder-"));
  try {
    const { folder } = repoWithTwoHandoffs(at);
    const r = runCheck(folder);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^Done\./);
    assert.match(r.stdout, /the suite passes, 1 of 1/, "only the new agent's suite ran, not the earlier agent's test at the root");
  } finally { rmSync(at, { recursive: true, force: true }); }
});

test("as a process: a file outside the folder changed, removed or added breaks the fence by name, as the gate refuses it", { skip: !hasGit && "git is not on this host" }, () => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-own-folder-"));
  try {
    const { put, folder } = repoWithTwoHandoffs(at);
    put("scripts/count.mjs", "export function count() { return 0; }\n");
    unlinkSync(join(at, "README.md"));
    put("notes.txt", "a stray file\n");
    const r = runCheck(folder);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /scripts\/count\.mjs changed outside the build folder/);
    assert.match(r.stdout, /README\.md removed outside the build folder/);
    assert.match(r.stdout, /notes\.txt added outside the build folder/);
    assert.doesNotMatch(r.stdout, /spec and test steps/, "a file outside the folder is not one of this agent's pinned files");
  } finally { rmSync(at, { recursive: true, force: true }); }
});

test("a change committed outside the folder is found too, and inside the folder nothing is called outside", { skip: !hasGit && "git is not on this host" }, () => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-own-folder-"));
  try {
    const { put, folder } = repoWithTwoHandoffs(at);
    assert.deepEqual(outsideChanges(folder), [], "the coding agent's own script is inside the folder");
    put("skills/count-words/SKILL.md", "count words, changed\n");
    git(at, "add", "-A"); git(at, "commit", "-q", "-m", "a commit that reaches outside");
    assert.deepEqual(outsideChanges(folder), [{ path: "skills/count-words/SKILL.md", what: "changed outside the build folder" }]);
  } finally { rmSync(at, { recursive: true, force: true }); }
});

test("a build folder at the top of its repository, or with no git, has nothing outside it", { skip: !hasGit && "git is not on this host" }, () => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-own-folder-"));
  try {
    repoWithTwoHandoffs(at);
    writeFileSync(join(at, "notes.txt"), "x\n");
    assert.deepEqual(outsideChanges(at), [], "the root is the whole repository: the old layout is judged as before");
    assert.deepEqual(outsideChanges(at, { run: () => ({ status: 128, stdout: "" }) }), []);
  } finally { rmSync(at, { recursive: true, force: true }); }
});

test("AGENTS.md says the folder is the hand-off's own and nothing outside it is to be changed", () => {
  const text = readFileSync(join(here, "..", "references", "agents-md-template.md"), "utf8");
  assert.match(text, /folder of its own/i);
  assert.match(text, /nothing outside this folder/i);
  assert.match(text, /do not merge the default branch/i);
});
