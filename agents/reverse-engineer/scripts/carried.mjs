// The original tests, carried (0.3.0): each test file of the codebase copied
// byte for byte into the record's folder at tests/<its path>, and each file a
// test imports from outside the codebase's folder copied byte for byte into
// support/<its path from the repository's top>, with every file those import
// in turn, as far as their relative imports go inside the repository. A later
// stage can then run the original tests against a rebuild. Nothing is
// edited: what is copied is the bytes at the commit.
//
// The repository's top is the folder named with --repository-root, else the
// top of the git checkout the codebase is in. Where it is a checkout, each
// support file is read at the record's commit (git show), so it is the file
// the tests ran with; where it is a folder with no history, the file is read
// as it is and a gap says the commit was not checked. A file that cannot be
// read, one outside the repository, and an import of a package (not node's
// own) from a support file are gaps.
//
//   needs: node >= 22; git, for a checkout
//   import { carryTests, isCarried } from "./carried.mjs"
import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { isCheckout, resolveCommit, slash } from "./codebase.mjs";
import { isTestFile } from "./facts.mjs";
import { JS_EXT, importsOf, resolveImport } from "./surface.mjs";
import { scan } from "./js-source.mjs";

const trim = (s) => String(s ?? "").trim();
const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec"]);
const RESOLVE_EXT = ["", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".json", "/index.js", "/index.mjs", "/index.cjs", "/index.ts"];
const BUILTIN = new Set(builtinModules);

/** A file the tests carry: a test file, or any file in a test folder (the
 *  fixtures and helpers the tests read). */
export const isCarried = (f) => isTestFile(f) || f.split("/").slice(0, -1).some((p) => TEST_DIRS.has(p));

const raw = (cwd, args) => {
  try { return execFileSync("git", ["-c", "safe.directory=*", ...args], { cwd, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }); } catch { return null; }
};

/** The repository the codebase sits in: {top, prefix, atCommit, why?}.
 *  `prefix` is the codebase's folder from the top. */
export function repositoryOf({ dir, prefix = "", checkout = false, commit = "", repositoryRoot = "" }) {
  if (trim(repositoryRoot)) {
    const top = resolve(repositoryRoot);
    if (!existsSync(top)) return { why: `the repository root ${repositoryRoot} is not there` };
    const inside = slash(relative(top, resolve(dir)));
    if (inside.startsWith("..") || /^[A-Za-z]:|^\//.test(inside)) return { why: `the codebase is not inside the repository root ${repositoryRoot}` };
    const at = isCheckout(top) && resolveCommit(top, commit);
    return { top, prefix: inside === "" ? "" : inside, atCommit: Boolean(at), commit: at || commit };
  }
  if (!checkout) return { why: "the codebase is not in a git checkout and no --repository-root was named, so the repository's top is not known" };
  const top = trim(raw(dir, ["rev-parse", "--show-toplevel"])?.toString("utf8"));
  if (!top) return { why: "the top of the codebase's git checkout could not be read" };
  return { top, prefix, atCommit: true, commit };
}

/** A file's bytes at a path from the repository's top: Buffer or null. */
function readFromRepository(repo, path) {
  if (repo.atCommit) return raw(repo.top, ["show", `${repo.commit}:${path}`]);
  const full = join(repo.top, path);
  try { return lstatSync(full).isFile() ? readFileSync(full) : null; } catch { return null; }
}

/** Where a relative import from `from` (a path from the repository's top)
 *  lands in the repository: {path} or {why}. */
function landing(repo, from, spec) {
  const joined = posix.normalize(posix.join(posix.dirname(from), spec));
  if (joined === ".." || joined.startsWith("../")) return { why: `it is outside the repository (${spec} from ${from})` };
  for (const ext of RESOLVE_EXT) {
    const p = joined + ext;
    const bytes = readFromRepository(repo, p);
    if (bytes) return { path: p, bytes };
  }
  return { why: `${joined} could not be read ${repo.atCommit ? `at ${String(repo.commit).slice(0, 12)}` : "in the repository root"}` };
}

/** The tests carried: {carried, support, pieces: [{at, bytes}], gaps}.
 *  `files` are the codebase's files at the commit and `bytesOf(f)` reads one.
 *  `inScope(f)` limits the test files carried (on drift, the changed ones). */
export function carryTests({ files, bytesOf, dir, prefix = "", checkout = false, commit = "", repositoryRoot = "", inScope = () => true }) {
  const fileSet = new Set(files);
  const carried = []; const support = []; const pieces = []; const gaps = [];
  let repo = null;
  const repoOf = () => (repo ??= repositoryOf({ dir, prefix, checkout, commit, repositoryRoot }));
  const supportAt = new Map(); // path from the top -> support entry
  const gap = (g) => gaps.push({ part: "existing tests and gaps", ...g });

  // Copy one support file and, in turn, what it imports: answers its support path or null.
  const copySupport = (path, bytes, by) => {
    if (supportAt.has(path)) { supportAt.get(path).imported_by.push(by); return supportAt.get(path).at; }
    const entry = { file: path, at: `support/${path}`, imported_by: [by], imports: [] };
    supportAt.set(path, entry);
    support.push(entry);
    pieces.push({ at: entry.at, bytes });
    if (!repoOf().atCommit) gap({ kind: "not-checked", about: `that ${entry.at} is ${path} at commit ${commit}`, why: "the repository root is not a git checkout at the record's commit, so the file was copied as it is in the folder and the commit was taken as given" });
    if (!JS_EXT.test(path)) return entry.at;
    let s;
    try { s = scan(bytes.toString("utf8")); } catch { return entry.at; }
    for (const im of importsOf(s)) {
      const spec = im.spec;
      if (/^\.\.?(\/|$)/.test(spec)) {
        const r = landing(repoOf(), path, spec);
        if (!r.path) { entry.imports.push({ from: spec, support: null, why: r.why }); gap({ kind: "outside-the-codebase", about: `${entry.at} imports ${spec}`, why: `the support file's import could not be copied: ${r.why}`, evidence: [{ file: entry.at, line: im.line }] }); continue; }
        const inCodebase = repoOf().prefix ? r.path.startsWith(`${repoOf().prefix}/`) : true;
        if (inCodebase && fileSet.has(repoOf().prefix ? r.path.slice(repoOf().prefix.length + 1) : r.path)) {
          entry.imports.push({ from: spec, codebase: repoOf().prefix ? r.path.slice(repoOf().prefix.length + 1) : r.path });
          continue;
        }
        entry.imports.push({ from: spec, support: copySupport(r.path, r.bytes, entry.at) });
      } else if (!spec.startsWith("node:") && !BUILTIN.has(spec.split("/")[0])) {
        entry.imports.push({ from: spec, package: spec });
        gap({ kind: "outside-the-codebase", about: `${entry.at} imports the package ${spec}`, why: "a support file imports a package, which is not copied; the tests need it installed to run", evidence: [{ file: entry.at, line: im.line }] });
      }
    }
    return entry.at;
  };

  for (const f of files.filter((x) => isCarried(x) && inScope(x))) {
    const bytes = bytesOf(f);
    if (!bytes) { gap({ kind: "not-read", about: `the test file ${f}`, why: "it could not be read, so it was not carried" }); continue; }
    const item = { file: f, at: `tests/${f}`, imports: [] };
    carried.push(item);
    pieces.push({ at: item.at, bytes });
    if (!JS_EXT.test(f)) continue;
    let s;
    try { s = scan(bytes.toString("utf8")); } catch { continue; }
    for (const im of importsOf(s)) {
      const r = resolveImport(f, im.spec, fileSet);
      if (!r.outside) continue;
      const rp = repoOf();
      if (!rp.top) { item.imports.push({ from: im.spec, support: null, why: rp.why }); gap({ kind: "outside-the-codebase", about: `${f} imports ${im.spec}`, why: `the file it imports was not carried: ${rp.why}`, evidence: [{ file: f, line: im.line }] }); continue; }
      const fromTop = rp.prefix ? posix.join(rp.prefix, f) : f;
      const l = landing(rp, fromTop, im.spec);
      if (!l.path) { item.imports.push({ from: im.spec, support: null, why: l.why }); gap({ kind: "outside-the-codebase", about: `${f} imports ${im.spec}`, why: `the file it imports was not carried: ${l.why}`, evidence: [{ file: f, line: im.line }] }); continue; }
      item.imports.push({ from: im.spec, support: copySupport(l.path, l.bytes, item.at) });
    }
  }
  return { carried, support, pieces, gaps };
}
