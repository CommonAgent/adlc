// The local check in a fresh clone of the branch a hand-off pushed.
//   node --test test/check-clone.test.mjs
//
// A build folder lands in somebody's repository and the coding agent runs
// `node .adlc/check.mjs` in its own clone. Three things there are not the
// coding agent's doing and must not break the fence: git's own folder, the
// line endings git chose on checkout (core.autocrlf turns LF into CRLF on
// Windows), and the repository's own files that were on the branch before the
// hand-off. A file added outside scripts/ and test/, a changed pinned file
// and a changed repository file still break it. The last test clones a real
// repository with core.autocrlf=true, so it fails the same way on Linux and
// Windows when the check gets this wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fenceOf, gitBlobSha, repoFilesAt } from "../scripts/check.mjs";
import { buildLock } from "../scripts/handoff.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(here, "..", "scripts");
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-clone-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};
const putIn = (at) => (rel, bytes) => { mkdirSync(dirname(join(at, rel)), { recursive: true }); writeFileSync(join(at, rel), bytes); };
const git = (cwd, ...args) => spawnSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
const hasGit = git(process.cwd(), "--version").status === 0;

test("the fence never walks .git, whatever is in it", () => {
  folder((at) => {
    const put = putIn(at);
    put("test/a.test.mjs", "test");
    put(".git/HEAD", "ref: refs/heads/main\n");
    put(".git/objects/ab/cdef", "x");
    const rec = { digests: { "test/a.test.mjs": sha("test") }, listing: { "test/a.test.mjs": sha("test") } };
    assert.deepEqual(fenceOf(rec, at), { ok: true, broken: [] });
    put(".gitx/a", "x");
    assert.deepEqual(fenceOf(rec, at).broken, [{ path: ".gitx/a", what: "added" }], "only .git itself is skipped");
  });
});

test("a pinned text file checked out with CRLF is the same file; a binary file and a real change are not", () => {
  folder((at) => {
    const put = putIn(at);
    const text = "line one\nline two\n";
    const bin = Buffer.from([0x00, 0x01, 0x0a, 0x02]);
    put("test/a.test.mjs", text.replace(/\n/g, "\r\n"));
    put("test/fixture.bin", bin);
    const rec = { digests: { "test/a.test.mjs": sha(text), "test/fixture.bin": sha(bin) }, listing: { "test/a.test.mjs": sha(text), "test/fixture.bin": sha(bin) } };
    assert.deepEqual(fenceOf(rec, at), { ok: true, broken: [] }, "CRLF against an LF digest holds");
    put("test/fixture.bin", Buffer.from([0x00, 0x01, 0x0d, 0x0a, 0x02]));
    assert.deepEqual(fenceOf(rec, at).broken, [{ path: "test/fixture.bin", what: "changed" }], "a binary file is compared byte for byte");
    put("test/fixture.bin", bin);
    put("test/a.test.mjs", "line one\r\nline 2\r\n");
    assert.deepEqual(fenceOf(rec, at).broken, [{ path: "test/a.test.mjs", what: "changed" }], "a real change under CRLF is still a change");
  });
});

test("the repository's own files may stay as they were and nothing else", () => {
  folder((at) => {
    const put = putIn(at);
    const readme = "# a repo\n";
    put("test/a.test.mjs", "test");
    put("README.md", readme.replace(/\n/g, "\r\n"));
    put("docs/guide.md", "guide\n");
    const rec = { digests: { "test/a.test.mjs": sha("test") }, listing: { "test/a.test.mjs": sha("test") } };
    const repoFiles = { "README.md": gitBlobSha(Buffer.from(readme)), "docs/guide.md": gitBlobSha(Buffer.from("guide\n")) };
    assert.deepEqual(fenceOf(rec, at).broken.map((b) => b.path).sort(), ["README.md", "docs/guide.md"], "without the repository's record they are added");
    assert.deepEqual(fenceOf(rec, at, { repoFiles }), { ok: true, broken: [] }, "unchanged, and under CRLF, they are not judged");
    put("README.md", "# a repo, edited\n");
    assert.deepEqual(fenceOf(rec, at, { repoFiles }).broken, [{ path: "README.md", what: "changed" }]);
    put("README.md", readme);
    rmSync(join(at, "docs/guide.md"));
    assert.deepEqual(fenceOf(rec, at, { repoFiles }).broken, [{ path: "docs/guide.md", what: "removed" }]);
    put("docs/guide.md", "guide\n");
    put("notes.txt", "mine");
    assert.deepEqual(fenceOf(rec, at, { repoFiles }).broken, [{ path: "notes.txt", what: "added" }], "a new file outside scripts/ is still refused");
  });
});

test("the repository's own files are what git held at the parent of the commit that added build.lock.json", { skip: !hasGit && "git is not on this host" }, () => {
  folder((at) => {
    const put = putIn(at);
    assert.deepEqual(repoFilesAt(at), {}, "not a repository: nothing is the repository's own");
    assert.equal(git(at, "init", "-q").status, 0);
    put("build.lock.json", "{}\n");
    put("test/a.test.mjs", "test");
    git(at, "add", "-A"); git(at, "commit", "-q", "-m", "hand-off in the first commit");
    assert.deepEqual(repoFilesAt(at), {}, "a hand-off in the root commit has no parent and nothing before it");
  });
  folder((at) => {
    const put = putIn(at);
    git(at, "init", "-q");
    put("README.md", "# a repo\n");
    put("docs/guide.md", "guide\n");
    git(at, "add", "-A"); git(at, "commit", "-q", "-m", "initial");
    put("build.lock.json", "{}\n");
    put("test/a.test.mjs", "test");
    git(at, "add", "-A"); git(at, "commit", "-q", "-m", "hand-off");
    put("scripts/a.mjs", "x");
    git(at, "add", "-A"); git(at, "commit", "-q", "-m", "the coding agent's work");
    assert.deepEqual(repoFilesAt(at), { "README.md": gitBlobSha(Buffer.from("# a repo\n")), "docs/guide.md": gitBlobSha(Buffer.from("guide\n")) });
  });
});

test("as a process: a fresh clone with core.autocrlf=true passes when only scripts/ changed, and still refuses what it must", { skip: !hasGit && "git is not on this host" }, () => {
  folder((root) => {
    const src = join(root, "src");
    const put = putIn(src);
    mkdirSync(src, { recursive: true });
    git(src, "init", "-q");
    put("README.md", "# the customer's repository\n\nIt was here first.\n");
    git(src, "add", "-A"); git(src, "commit", "-q", "-m", "initial");
    // The hand-off: a build folder with a suite, a stub script, the check and the lock.
    put("test/add.test.mjs", 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("two and two are four", () => { assert.equal(add(2, 2), 4); });\n');
    put("test/fixture.bin", Buffer.from([0x00, 0x0a, 0xff, 0x0a]));
    put("scripts/add.mjs", 'export function add() { throw new Error("add is not written yet"); }\n');
    put("AGENTS.md", "The rules.\nWrite scripts/ only.\n");
    for (const f of ["check.mjs", "workspace.mjs", "agent-folder.mjs", "archive.mjs"]) { mkdirSync(join(src, ".adlc"), { recursive: true }); copyFileSync(join(scriptsDir, f), join(src, ".adlc", f)); }
    const lock = buildLock(src, { scripts: [{ path: "scripts/add.mjs", from: "stub" }] });
    delete lock.digests["README.md"]; // the hand-off pins only what it laid out
    for (const p of Object.keys(lock.digests)) if (p.startsWith(".git/")) delete lock.digests[p];
    put("build.lock.json", JSON.stringify(lock, null, 2) + "\n");
    git(src, "add", "-A"); git(src, "commit", "-q", "-m", "hand-off");

    const clone = join(root, "clone");
    assert.equal(spawnSync("git", ["-c", "core.autocrlf=true", "clone", "-q", "--config", "core.autocrlf=true", src, clone], { encoding: "utf8" }).status, 0);
    const inClone = putIn(clone);
    inClone("scripts/add.mjs", "export function add(a, b) { return a + b; }\r\n");
    const run = () => {
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_") || k === "WORKSPACE" || k === "RECORDS") delete env[k];
      return spawnSync("node", [join(clone, ".adlc", "check.mjs")], { cwd: clone, encoding: "utf8", env });
    };
    const done = run();
    assert.equal(done.status, 0, done.stdout + done.stderr);
    assert.match(done.stdout, /^Done\./);

    inClone("notes.txt", "mine");
    const added = run();
    assert.equal(added.status, 3, added.stdout + added.stderr);
    assert.match(added.stdout, /notes\.txt added/);
    assert.doesNotMatch(added.stdout, /README\.md|\.git\/|AGENTS\.md|test\//, "only what the coding agent did is named");
    rmSync(join(clone, "notes.txt"));

    inClone("README.md", "# rewritten\n");
    const repoChanged = run();
    assert.equal(repoChanged.status, 3);
    assert.match(repoChanged.stdout, /README\.md changed/);
  });
});
