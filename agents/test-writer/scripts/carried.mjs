// The original's own tests, carried into the suite unchanged (test-writer
// 0.10.0). No model.
//
// WHY THIS EXISTS. On a round trip a real agent's original had 21 tests. The
// rebuild passed its own 90-test gate while passing only 6 of the 21, because
// the original's tests never reached the gate: the reverse engineer's write-up
// listed them by name and nothing carried them. The strongest check on a
// rebuild is the original's own tests, so they are carried forward unchanged,
// and code, not a model, places them and checks that nothing in them changed.
//
// What comes. The reverse engineer's write-up holds each original test file
// at tests/<its path in the codebase>, each file a test imports from outside
// the codebase folder (and every file those import, the whole closure) at
// support/<its path from the repository's top>, and a carried list in
// tests-and-gaps.json: [{file, at, imports: [{from, support}]}]. Product
// Factory attaches the tests, the support files and a carried manifest made
// from that list, a JSON file of this shape, found by content:
//
//   { "carried_tests": "v1",
//     "tests":   [{ "file": "test/x.test.mjs", "at": "tests/test/x.test.mjs", "sha256": "<hex>",
//                   "imports": [{ "from": "../../lib/a.mjs", "support": "support/lib/a.mjs" }] }],
//     "support": [{ "path": "support/lib/a.mjs", "sha256": "<hex>" }] }
//
// Attached files arrive under names the hops gave them, so each is matched to
// its entry by the SHA-256 of its bytes, and by its file name only where no
// digest is given and one file has that name.
//
// Where they go. Each test at test/<its file name> (with .test.mjs, so the
// suite's runner runs it), unchanged but for the import specifiers the
// manifest lists, each rewritten to the support copy: ./support/<path from
// the repository's top>. Every support file at test/support/<the same path>,
// byte for byte, so the imports between support files work as they did. And
// a record of what was carried, test/carried-tests.json, which travels with
// the suite and locks it: a revision finds the carried tests by it, never
// changes one, and drops one only when the person names it.
//
//   needs: node >= 22
//   import { carriedAmong, placeCarried, loadProblems } from "./carried.mjs"
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import { spawnSync } from "node:child_process";

const trim = (s) => String(s ?? "").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The format both the manifest and the record carry. */
export const CARRIED_FORMAT = "v1";
/** Where the record of what was carried goes in the suite. */
export const CARRIED_RECORD = "test/carried-tests.json";
/** Where the support files go in the suite. */
export const SUPPORT_DIR = "test/support";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bare = (d) => trim(d).replace(/^sha256:/i, "").toLowerCase();

/** Whether a JSON value is the carried manifest a request brings. */
export const isCarriedManifest = (doc) => Boolean(doc && typeof doc === "object" && !Array.isArray(doc)
  && doc.carried_tests === CARRIED_FORMAT && Array.isArray(doc.tests));
/** Whether a JSON value is the record of what a suite carries. */
export const isCarriedRecord = (doc) => Boolean(doc && typeof doc === "object" && !Array.isArray(doc)
  && doc.carried_tests === CARRIED_FORMAT && Array.isArray(doc.placed));

/** A path as written in the manifest, with / and no leading ./ or /. */
const norm = (p) => trim(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
/** A path inside the folder it is placed in. */
export const staysInside = (p) => {
  const n = posix.normalize(norm(p));
  return Boolean(n) && n !== "." && !n.startsWith("../") && n !== ".." && !/^[a-zA-Z]:/.test(n);
};

/** An attached file's name with the process runner's prefixes taken off. */
export function attachedName(path) {
  let n = basename(String(path ?? ""));
  while (/^\d+-[A-Za-z0-9_-]{8}-/.test(n)) n = n.replace(/^\d+-[A-Za-z0-9_-]{8}-/, "");
  return n;
}

/** The manifest, or the record, among the attachments, found by content:
 *  { path, doc, kind: "manifest" | "record" }, or null. */
export function carriedAmong(files = [], readBytes) {
  let manifest = null;
  for (const f of files) {
    if (!f?.path) continue;
    // Read whatever its name, since a hop may drop the extension.
    let doc = null;
    try { doc = JSON.parse(Buffer.from(readBytes(f.path)).toString("utf8")); } catch { continue; }
    // The record a suite carries governs: those tests are placed already.
    if (isCarriedRecord(doc)) return { path: f.path, doc, kind: "record" };
    if (isCarriedManifest(doc) && !manifest) manifest = { path: f.path, doc, kind: "manifest" };
  }
  return manifest;
}

/** The attached file an entry names: the one with its digest, else the only
 *  one with its file name. Paths already taken are not matched twice. */
function matchOne(entry, files, bytesOf, used, { digest, names }) {
  const want = bare(digest);
  if (want) {
    const hit = files.find((f) => !used.has(f.path) && sha256(bytesOf(f.path)) === want);
    return hit ?? null;
  }
  const byName = files.filter((f) => !used.has(f.path) && names.includes(attachedName(f.path)));
  return byName.length === 1 ? byName[0] : null;
}

/** The name a carried test goes under in test/: its file name, ending
 *  .test.mjs, so the suite's runner runs it; a name another file already
 *  holds takes the folders it sat in, joined by "-". */
export function placedName(file, taken = new Set()) {
  const parts = norm(file).split("/");
  const name = parts.pop();
  const stem = name.replace(/(\.test)?\.(m|c)?js$/i, "");
  const plain = `test/${stem}.test.mjs`;
  if (!taken.has(plain)) return plain;
  const dirs = parts.filter((d) => d && d !== "test");
  for (let i = 1; i <= dirs.length; i += 1) {
    const p = `test/${[...dirs.slice(-i), stem].join("-")}.test.mjs`;
    if (!taken.has(p)) return p;
  }
  for (let k = 2; ; k += 1) if (!taken.has(`test/${stem}-${k}.test.mjs`)) return `test/${stem}-${k}.test.mjs`;
}

/** The specifier a carried test imports a support file by, from test/:
 *  ./support/<its path from the repository's top>. */
export const supportSpecifier = (support) => `./${posix.relative("test", posix.join(SUPPORT_DIR, norm(support).replace(/^support\//, "")))}`;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Where a specifier stands in an import: from "x", import "x", import("x"),
 *  and the quote it is written in. */
const specifierRe = (spec) => new RegExp(`(\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+)(["'])${escapeRe(spec)}\\2`, "g");

/** The test with each import specifier the manifest lists rewritten to its
 *  support copy, and nothing else: { text, rewrites: [{from, to, times}] }. */
export function rewriteImports(text, imports = []) {
  let out = String(text ?? "");
  const rewrites = [];
  for (const imp of imports) {
    const from = String(imp?.from ?? "");
    if (!from || !trim(imp?.support)) continue;
    const to = supportSpecifier(imp.support);
    let times = 0;
    out = out.replace(specifierRe(from), (_, lead, q) => { times += 1; return `${lead}${q}${to}${q}`; });
    rewrites.push({ from, to, times });
  }
  return { text: out, rewrites };
}

/** What changed in a carried test besides its listed import specifiers, as
 *  sentences; [] when nothing did. Checked the other way round from the
 *  rewrite: each rewritten specifier is put back, and the result must be the
 *  original byte for byte. */
export function changedBeyondImports(original, placed, rewrites = []) {
  const orig = String(original ?? "");
  let back = String(placed ?? "");
  const out = [];
  for (const r of rewrites) {
    if (r.from !== r.to && specifierRe(r.to).test(orig)) out.push(`the original already imports ${r.to}, so its rewrite could not be told apart`);
    back = back.replace(specifierRe(r.to), (_, lead, q) => `${lead}${q}${r.from}${q}`);
  }
  if (back !== orig) {
    const a = orig.split("\n"); const b = back.split("\n");
    const at = a.findIndex((l, i) => l !== b[i]);
    out.push(`it differs from the original at line ${(at < 0 ? Math.min(a.length, b.length) : at) + 1} by more than its import specifiers`);
  }
  return out;
}

/** The relative imports of a test that the manifest does not list: what it
 *  reaches inside the codebase folder. */
const relativeImports = (text) => [...String(text ?? "").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?\/[^"']+)\1/g)].map((m) => m[2]);

/** The words in a message that drop a carried test, which only the person
 *  says: "drop the original test x.test.mjs" (or "drop the carried test"),
 *  one per line. The file names, as written. */
export function dropsAsked(text = "") {
  const out = [];
  for (const m of String(text ?? "").matchAll(/\bdrop\s+the\s+(?:original|carried)\s+test\s+[`"']?([\w./@+-]+?\.(?:m|c)?js)[`"']?(?=[\s.,;:)]|$)/gim)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Whether a name the person wrote is this carried test: its placed name,
 *  its path in the codebase, or the file name of either. */
const namesCarried = (said, t) => {
  const s = norm(said);
  return [t.test, t.file, basename(t.test), basename(t.file)].some((n) => n && (n === s || n === `test/${s}`));
};

/**
 * The carried tests placed, from a manifest and the files that came with it,
 * or from the record a suite carries (a revision): { tests: [{path, text,
 * file, at, original}], support: [{path, bytes}], record, gaps, dropped }.
 * tests[].path is test/<name>; support[].path is test/support/<path>. gaps
 * are sentences: what was listed and did not come, what could not be placed.
 * used is every attached path taken, so nothing else reads it as a test, a
 * dependency or a spec. taken: paths the suite already holds. drops: names
 * the person asked to drop (dropsAsked). now: the time a drop is recorded at.
 */
export function placeCarried({ found, files = [], readBytes, taken = [], drops = [], now = () => new Date().toISOString() } = {}) {
  const empty = { tests: [], support: [], record: null, gaps: [], dropped: [], used: [] };
  if (!found) return empty;
  const bytesOf = (p) => Buffer.from(readBytes(p));
  const pool = files.filter((f) => f?.path && f.path !== found.path);
  const used = new Set();
  const gaps = [];
  const doc = found.doc;
  const support = [];
  const tests = [];
  const dropped = [...(Array.isArray(doc.dropped) ? doc.dropped : [])];
  if (found.kind === "manifest") {
    for (const s of Array.isArray(doc.support) ? doc.support : []) {
      const p = norm(typeof s === "string" ? s : s?.path);
      if (!p || !staysInside(p) || !p.startsWith("support/")) { gaps.push(`the support file ${p || "(no path)"} is not under support/, so it was not placed`); continue; }
      const hit = matchOne(s, pool, bytesOf, used, { digest: typeof s === "string" ? "" : s?.sha256, names: [basename(p)] });
      if (!hit) { gaps.push(`the support file ${p} did not come with the message, so a carried test that imports it will not load`); continue; }
      used.add(hit.path);
      support.push({ path: `${SUPPORT_DIR}/${p.slice("support/".length)}`, from: p, bytes: bytesOf(hit.path), sha256: sha256(bytesOf(hit.path)) });
    }
    const names = new Set(taken);
    for (const t of doc.tests) {
      const file = norm(t?.file);
      if (!file) { gaps.push("a carried test with no file was not placed"); continue; }
      const hit = matchOne(t, pool, bytesOf, used, { digest: t?.sha256, names: [basename(file), basename(norm(t?.at))] });
      if (!hit) { gaps.push(`the original test ${file} did not come with the message, so it is not in the suite`); continue; }
      used.add(hit.path);
      const path = placedName(file, names);
      if (drops.some((d) => namesCarried(d, { test: path, file }))) {
        dropped.push({ file, test: path, at: now(), by: "the person, by naming it" });
        continue;
      }
      names.add(path);
      const original = bytesOf(hit.path).toString("utf8");
      const imports = (Array.isArray(t.imports) ? t.imports : []).filter((i) => i && trim(i.from) && trim(i.support));
      for (const i of imports) {
        if (!support.some((s) => s.from === norm(i.support))) gaps.push(`${file} imports ${i.from}, listed as ${norm(i.support)}, which did not come, so ${path} will not load`);
      }
      const { text, rewrites } = rewriteImports(original, imports);
      for (const r of rewrites) if (!r.times) gaps.push(`${file} does not import ${r.from} as the manifest lists it, so that specifier was left as it is`);
      const changed = changedBeyondImports(original, text, rewrites);
      if (changed.length) { gaps.push(`${file} was not carried: ${changed.join("; ")}`); continue; }
      const listed = new Set(imports.map((i) => i.from));
      const inside = relativeImports(original).filter((s) => !listed.has(s));
      const dir = posix.dirname(file);
      if (inside.length && dir !== "test") gaps.push(`${file} sat in ${dir}/ in the codebase and now runs from test/, so its own relative imports (${inside.join(", ")}) are read from test/`);
      tests.push({ path, text, file, at: norm(t.at), original: sha256(Buffer.from(original, "utf8")), imports: rewrites.map((r) => ({ from: r.from, to: r.to })) });
    }
  } else {
    // A record: the suite as it stands carries these, placed already.
    for (const s of Array.isArray(doc.support) ? doc.support : []) {
      const p = norm(s?.path);
      if (!p || !staysInside(p) || !p.startsWith(`${SUPPORT_DIR}/`)) continue;
      const hit = matchOne(s, pool, bytesOf, used, { digest: s?.sha256, names: [basename(p)] });
      if (!hit) { gaps.push(`the support file ${p} did not come with the suite`); continue; }
      used.add(hit.path);
      support.push({ path: p, from: s.from ?? null, bytes: bytesOf(hit.path), sha256: sha256(bytesOf(hit.path)) });
    }
    for (const t of doc.placed) {
      const path = norm(t?.test);
      if (!path || !/^test\/[^/]+\.test\.mjs$/.test(path)) continue;
      const hit = matchOne(t, pool, bytesOf, used, { digest: t?.sha256, names: [basename(path)] });
      if (!hit) { gaps.push(`the original test ${path} did not come with the suite`); continue; }
      used.add(hit.path);
      if (drops.some((d) => namesCarried(d, { test: path, file: t.file }))) {
        dropped.push({ file: t.file ?? path, test: path, at: now(), by: "the person, by naming it" });
        continue;
      }
      tests.push({ path, text: bytesOf(hit.path).toString("utf8"), file: t.file ?? path, at: t.at ?? null, original: t.original ?? null, imports: t.imports ?? [] });
    }
    // An original as it came, or a manifest, sent again beside the suite is
    // the same test already placed: taken, so nothing reads it as another.
    const originals = new Set(doc.placed.map((t) => bare(t?.original)).filter(Boolean));
    for (const f of pool) {
      if (used.has(f.path)) continue;
      let b; try { b = bytesOf(f.path); } catch { continue; }
      if (originals.has(sha256(b))) { used.add(f.path); continue; }
      try { if (isCarriedManifest(JSON.parse(b.toString("utf8")))) used.add(f.path); } catch { /* not JSON */ }
    }
  }
  const newlyDropped = dropped.slice(Array.isArray(doc.dropped) ? doc.dropped.length : 0);
  for (const d of drops) {
    if (!newlyDropped.some((x) => namesCarried(d, { test: x.test, file: x.file }))) gaps.push(`${d} was asked to be dropped, and no original test carried here has that name`);
  }
  const record = {
    carried_tests: CARRIED_FORMAT,
    about: "The original's own tests, carried into the suite unchanged but for the import specifiers listed, and the files they import, under test/support/. Locked: a revision never changes them, and only the person drops one, by naming it.",
    placed: tests.map((t) => ({ test: t.path, file: t.file, at: t.at, sha256: sha256(Buffer.from(t.text, "utf8")), original: t.original, imports: t.imports })),
    support: support.map((s) => ({ path: s.path, from: s.from, sha256: s.sha256 })),
    dropped,
  };
  return { tests, support, record: tests.length || support.length || dropped.length ? record : null, gaps, dropped: newlyDropped, used: [...used, found.path] };
}

/** What a reply says of what was carried, in one sentence, or "". */
export function carriedWords({ tests = [], support = [], dropped = [] } = {}) {
  const parts = [];
  if (tests.length) parts.push(`Carried ${plural(tests.length, "of the original's own tests", "of the original's own tests")} unchanged but for their import specifiers (${tests.map((t) => t.path.replace(/^test\//, "")).join(", ")})${support.length ? `, with the ${plural(support.length, "file")} they import, under test/support/` : ""}; they are locked, and no revision changes them.`);
  for (const d of dropped) parts.push(`Dropped the original test ${d.file}, as you named it; the drop is recorded in ${CARRIED_RECORD}.`);
  return parts.join(" ");
}

// ── every test loads ─────────────────────────────────────────────────────────

/** Code with its comments and quoted strings blanked, so a word inside one is
 *  not read as code. Template literals are blanked outside ${...}. */
export function codeOf(text) {
  const s = String(text ?? "");
  let out = ""; let i = 0;
  while (i < s.length) {
    const c = s[i]; const n = s[i + 1];
    if (c === "/" && n === "/") { while (i < s.length && s[i] !== "\n") i += 1; continue; }
    if (c === "/" && n === "*") { const e = s.indexOf("*/", i + 2); const end = e < 0 ? s.length : e + 2; out += s.slice(i, end).replace(/[^\n]/g, " "); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c && s[j] !== "\n") j += s[j] === "\\" ? 2 : 1;
      out += `${c}${c}`; i = j + 1; continue;
    }
    if (c === "`") {
      let j = i + 1; out += "`";
      while (j < s.length && s[j] !== "`") {
        if (s[j] === "\\") { j += 2; continue; }
        if (s[j] === "$" && s[j + 1] === "{") {
          let depth = 1; let k = j + 2;
          while (k < s.length && depth) { if (s[k] === "{") depth += 1; else if (s[k] === "}") depth -= 1; k += 1; }
          out += ` ${codeOf(s.slice(j + 2, k - 1))} `; j = k; continue;
        }
        if (s[j] === "\n") out += "\n";
        j += 1;
      }
      out += "`"; i = j + 1; continue;
    }
    out += c; i += 1;
  }
  return out;
}

/** The names an ES module has no binding for unless it makes one. */
export const COMMONJS_NAMES = ["__dirname", "__filename", "require"];

/** Whether a file is an ES module: named .mjs, or carrying import or export. */
export const isEsm = (path, text) => /\.mjs$/i.test(String(path ?? "")) || /^\s*(?:import|export)\b/m.test(codeOf(text));

/** Each CommonJS name an ES module uses without declaring it, which throws a
 *  ReferenceError before any test runs: [{name, line}]. A name read as a
 *  member (x.require), a key (require:) or one the file declares (const
 *  __dirname = ..., createRequire's const require) is not one. */
export function commonJsNamesUsed(text) {
  const code = codeOf(text);
  const out = [];
  for (const name of COMMONJS_NAMES) {
    const declared = new RegExp(`\\b(?:const|let|var|function|class)\\s+${name}\\b`).test(code)
      || new RegExp(`\\b(?:const|let|var)\\s*[{[][^=;]*\\b${name}\\b[^=;]*=`).test(code)
      || new RegExp(`\\bimport\\s*\\{[^}]*\\b(?:as\\s+)?${name}\\b[^}]*\\}`).test(code)
      || new RegExp(`\\bimport\\s+${name}\\b`).test(code);
    if (declared) continue;
    const re = new RegExp(`(?<![\\w$.])${name}(?![\\w$])(?!\\s*:(?!:))`, "g");
    for (const m of code.matchAll(re)) {
      const line = code.slice(0, m.index).split("\n").length;
      out.push({ name, line });
      break;
    }
  }
  return out;
}

/** Whether node can parse a file: `node --check` over it, in a folder of its
 *  own with its name. The words node gave, or "" when it parses. */
export function syntaxProblem(path, text, { spawn = spawnSync } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "test-writer-load-"));
  try {
    const at = join(scratch, basename(String(path)) || "x.test.mjs");
    writeFileSync(at, String(text ?? ""));
    const r = spawn(process.execPath, ["--check", at], { encoding: "utf8", timeout: 30_000 });
    if (r.status === 0) return "";
    const said = trim(`${r.stderr ?? ""}`).split(/\r?\n/).map(trim).filter(Boolean);
    const err = said.find((l) => /Error/.test(l)) ?? said.at(-1) ?? `node --check ended with ${r.status}`;
    const line = /:(\d+)\s*$/m.exec(said[0] ?? "")?.[1];
    return `${err}${line ? ` (line ${line})` : ""}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Every way a test file will not load, as sentences naming it: node cannot
 *  parse it, or an ES module test uses __dirname, __filename or require
 *  without declaring it (round trip 3 had two tests that threw ReferenceError
 *  before reaching any script). [] when it loads. */
export function loadProblems(file, opts = {}) {
  const out = [];
  const why = syntaxProblem(file.path, file.text, opts);
  if (why) out.push(`${file.path} does not parse (node --check): ${why}`);
  if (isEsm(file.path, file.text)) {
    for (const u of commonJsNamesUsed(file.text)) {
      out.push(`${file.path}:${u.line} uses ${u.name}, which an ES module does not have, so the file throws a ReferenceError before any test runs; ${u.name === "require" ? "import what it needs instead" : `make it from import.meta.url (${u.name === "__dirname" ? "dirname(fileURLToPath(import.meta.url))" : "fileURLToPath(import.meta.url)"})`}`);
    }
  }
  return out;
}

/** loadProblems over every test file given. */
export const loadFindings = (files = [], opts = {}) => files.filter((f) => /\.test\.mjs$/.test(String(f?.path ?? ""))).flatMap((f) => loadProblems(f, opts));
