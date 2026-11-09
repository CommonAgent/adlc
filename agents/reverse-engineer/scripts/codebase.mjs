// The codebase as it stands at the named commit: its files, their lines, and
// what git says about it. Nothing here calls a model, and nothing here changes
// the codebase: every git command is one that only reads.
//
// Where the folder is a git checkout, the files read are the ones git tracks
// (git ls-files), so an untracked file left beside the code is never described
// as part of the commit, and a tracked file changed since the commit stops the
// job: a line cited from a changed file would not be the line at the commit.
// Where it is not a checkout (a folder handed over as an archive with no
// history), every file under it is read, leaving out the folders that hold
// installed or built things, and the record says the commit was taken as
// given and not checked.
//
//   needs: node >= 22; git, for a checkout and for drift
//   import { openCodebase, linesOf, changedSince } from "./codebase.mjs"
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const trim = (s) => String(s ?? "").trim();

/** Folders never read: installed packages, build output, caches, history. */
export const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt", "target", "__pycache__", ".venv", "venv", ".tox", ".cache", "bower_components", "vendor"]);

/** Lockfiles: read for the bill of materials, never sent to the model. */
export const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "go.sum", "composer.lock", "Gemfile.lock"]);

/** A path written the same on every machine: forward slashes, no leading ./ */
export const slash = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^(\.\/)+/, "");

/** git, run in `cwd`, answering its output; a failure throws with git's words.
 *  File modes are not compared: an archive unpacked here gives every file
 *  the same mode, and a mode is not a line of code. */
export function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", ["-c", "safe.directory=*", "-c", "core.quotepath=off", "-c", "core.fileMode=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    if (allowFail) return null;
    const said = trim(e.stderr) || trim(e.message);
    throw new Error(`git ${args[0]} failed: ${said}`);
  }
}

/** Whether git can be run at all on this host. */
export function hasGit() {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

/** Whether the folder is inside a git checkout. */
export function isCheckout(dir) {
  if (!hasGit()) return false;
  return trim(git(dir, ["rev-parse", "--is-inside-work-tree"], { allowFail: true })) === "true";
}

/** The full digest a commit name stands for in this checkout, or null. */
export function resolveCommit(dir, name) {
  const n = trim(name);
  if (!/^[0-9a-fA-F]{4,64}$/.test(n) && !/^[A-Za-z0-9._/-]+$/.test(n)) return null;
  const out = git(dir, ["rev-parse", "--verify", "--quiet", `${n}^{commit}`], { allowFail: true });
  return out ? trim(out).toLowerCase() : null;
}

/** True for a file this agent treats as text: no NUL byte in its first 8 KB. */
export function isText(bytes) {
  const head = bytes.subarray(0, 8192);
  return !head.includes(0);
}

/** Every file under `dir`, relative and sorted, skipping SKIP_DIRS and links. */
export function walk(dir) {
  const out = [];
  const visit = (at) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) visit(full); continue; }
      if (st.isFile()) out.push(slash(relative(dir, full)));
    }
  };
  visit(dir);
  return out.sort();
}

/** The codebase, opened: {dir, checkout, head, prefix, files, problem}.
 *  `problem` is set, in words, when the folder cannot stand for the commit. */
export function openCodebase(dir, { commit = "" } = {}) {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) return { dir: root, problem: "the codebase folder is not there" };
  if (!isCheckout(root)) {
    return { dir: root, checkout: false, head: null, prefix: "", files: walk(root), commit_checked: false, commit: trim(commit).toLowerCase() };
  }
  const head = trim(git(root, ["rev-parse", "HEAD"], { allowFail: true })).toLowerCase() || null;
  const prefix = slash(trim(git(root, ["rev-parse", "--show-prefix"], { allowFail: true }))).replace(/\/$/, "");
  const named = resolveCommit(root, commit);
  if (!named) return { dir: root, checkout: true, head, prefix, problem: `the folder is a git checkout and the commit ${trim(commit) || "(none given)"} is not in its history` };
  if (named !== head) return { dir: root, checkout: true, head, prefix, problem: `the folder is checked out at ${head}, not at the named commit ${named}` };
  // Each porcelain line is two status letters, a space and the path; the
  // first letter may be a space, so the lines are not trimmed.
  const changed = String(git(root, ["status", "--porcelain", "--untracked-files=no", "--", "."]) ?? "").split(/\r?\n/).filter((l) => l.length > 3);
  if (changed.length) {
    const first = changed.slice(0, 5).map((l) => slash(l.slice(3))).join(", ");
    return { dir: root, checkout: true, head, prefix, problem: `the folder has tracked files changed since the commit (${first}), so its lines are not the commit's lines` };
  }
  const files = git(root, ["ls-files", "-z", "--", "."]).split("\0").filter(Boolean).map(slash)
    .filter((f) => !f.split("/").some((part) => SKIP_DIRS.has(part)))
    .filter((f) => { try { return lstatSync(join(root, f)).isFile(); } catch { return false; } })
    .sort();
  return { dir: root, checkout: true, head, prefix, files, commit_checked: true, commit: named };
}

/** A file's lines as the record counts them: split on newlines, a final
 *  newline ending the last line rather than starting another. */
export function linesOf(text) {
  const t = String(text ?? "");
  if (!t) return [];
  const lines = t.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A file inside the codebase, read as text, or null when it is not there,
 *  leaves the folder, is a link, or is not text. */
export function readInside(dir, rel) {
  const r = slash(rel);
  if (!r || r.startsWith("/") || /^[a-zA-Z]:/.test(r) || r.split("/").includes("..")) return null;
  const full = resolve(dir, r);
  if (full !== resolve(dir) && !full.startsWith(resolve(dir) + sep)) return null;
  try {
    const st = lstatSync(full);
    if (!st.isFile()) return null;
    const bytes = readFileSync(full);
    return isText(bytes) ? bytes.toString("utf8") : null;
  } catch { return null; }
}

/** A file's text at another commit (for drift), or null. */
export function readAt(dir, commit, rel) {
  const r = slash(rel);
  if (!r || r.split("/").includes("..")) return null;
  const out = git(dir, ["show", `${commit}:./${r}`], { allowFail: true });
  return out === null ? null : out;
}

/** The files git tracked under the folder at another commit (for drift). */
export function filesAt(dir, commit) {
  return git(dir, ["ls-tree", "-r", "--name-only", "-z", commit, "--", "."]).split("\0").filter(Boolean).map(slash)
    .filter((f) => !f.split("/").some((part) => SKIP_DIRS.has(part))).sort();
}

/** What changed between two commits under the folder, by git: each file with
 *  its status (added, modified, deleted, renamed), and for each the line
 *  ranges that changed on the new side and on the old side. */
export function changedSince(dir, from, to) {
  const out = [];
  const raw = git(dir, ["diff", "--relative", "--name-status", "-M", "-z", from, to]);
  const parts = raw.split("\0").filter((x) => x !== "");
  const WORD = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "modified" };
  for (let i = 0; i < parts.length;) {
    const code = parts[i++];
    const letter = code[0];
    if (letter === "R" || letter === "C") {
      const was = slash(parts[i++]); const now = slash(parts[i++]);
      out.push({ file: now, was, status: WORD[letter] });
    } else {
      out.push({ file: slash(parts[i++]), status: WORD[letter] ?? "modified" });
    }
  }
  for (const c of out) {
    const files = c.was ? [c.was, c.file] : [c.file];
    const diff = git(dir, ["diff", "--relative", "-U0", "-M", from, to, "--", ...files], { allowFail: true }) ?? "";
    const { added, removed } = hunksOf(diff);
    c.new_lines = added;
    c.old_lines = removed;
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The changed ranges in a -U0 diff: new side and old side, as [first, last].
 *  A hunk that only removes lines touches the lines either side of the cut. */
export function hunksOf(diff) {
  const added = []; const removed = [];
  for (const m of String(diff ?? "").matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const oldStart = Number(m[1]); const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]); const newCount = m[4] === undefined ? 1 : Number(m[4]);
    added.push(newCount === 0 ? [Math.max(1, newStart), newStart + 1] : [newStart, newStart + newCount - 1]);
    removed.push(oldCount === 0 ? [Math.max(1, oldStart), oldStart + 1] : [oldStart, oldStart + oldCount - 1]);
  }
  return { added, removed };
}

/** The most of a diff the model is shown. */
export const DIFF_CHARS = 200_000;

/** The unified diff between two commits under the folder, for the model,
 *  without the lockfiles (the bill of materials reads those), and cut at
 *  DIFF_CHARS with a line that says so. */
export function diffText(dir, from, to) {
  const excludes = [...LOCKFILES].map((n) => `:(exclude,glob)**/${n}`);
  const text = git(dir, ["diff", "--relative", "-U3", "-M", from, to, "--", ".", ...excludes]) ?? "";
  // cut-ok: the model is shown the first DIFF_CHARS characters, and the cut is said in the text it reads; every changed file is still listed whole.
  if (text.length <= DIFF_CHARS) return text;
  return `${text.slice(0, DIFF_CHARS)}\n... the diff goes on for ${(text.length - DIFF_CHARS).toLocaleString("en-US")} more characters, not shown\n`;
}
