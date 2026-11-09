// What can be read off the code by rule, before any model sees it: the
// settings and credentials it reads from its environment (by name, never by
// value), its declared entry points and how it starts, its test files and its
// own test command, and the OpenAPI and JSON Schema documents it already
// carries. Each fact names the file and line it was read from.
//
// These go into the record as they are, and the model is shown them so it
// does not have to find them again. They are the floor of the record: a model
// that misses one does not take it out.
//
//   needs: node >= 22. Nothing here writes a file.
//   import { readFacts } from "./facts.mjs"
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { LOCKFILES, linesOf } from "./codebase.mjs";

const trim = (s) => String(s ?? "").trim();

/** Source files read for settings: code, not data or documents. */
export const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".cs", ".sh", ".bash"]);

/** The ways a program reads one variable from its environment. Each pattern
 *  captures the variable's name and nothing after it, so a default written
 *  beside it is never taken. */
const ENV_READS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /Deno\.env\.get\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g,
  /os\.environ\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
  /os\.environ\.get\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /os\.getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /os\.(?:Getenv|LookupEnv)\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /env::var(?:_os)?\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /System\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /ENV(?:\.fetch\(\s*|\[\s*)["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
  /getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g,
];
/** `const { A, B: b } = process.env` names A and B. */
const ENV_DESTRUCTURE = /\{([^{}]*)\}\s*=\s*process\.env\b/g;

/** Names that say a value is a credential. */
export const CREDENTIAL_WORDS = /(^|_)(KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH|PRIVATE|CERT)(_|$)/i;

/** Every environment variable a file reads: [{name, line}], by rule. */
export function envReadsIn(text) {
  const out = [];
  linesOf(text).forEach((line, i) => {
    const seen = new Set();
    for (const re of ENV_READS) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) if (!seen.has(m[1])) { seen.add(m[1]); out.push({ name: m[1], line: i + 1 }); }
    }
    ENV_DESTRUCTURE.lastIndex = 0;
    for (const m of line.matchAll(ENV_DESTRUCTURE)) {
      for (const part of m[1].split(",")) {
        const n = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(part)?.[1];
        if (n && !seen.has(n)) { seen.add(n); out.push({ name: n, line: i + 1 }); }
      }
    }
  });
  return out;
}

/** The settings and credentials the code reads, by name, each with every
 *  place it is read. Only lines `keep(file, line)` allows are counted (on
 *  drift, the changed lines). */
export function settingsRead(files, read, keep = () => true) {
  const byName = new Map();
  for (const f of files) {
    if (!CODE_EXT.has(extname(f).toLowerCase())) continue;
    const text = read(f);
    if (text === null) continue;
    for (const r of envReadsIn(text)) {
      if (!keep(f, r.line)) continue;
      if (!byName.has(r.name)) byName.set(r.name, { name: r.name, credential: CREDENTIAL_WORDS.test(r.name), evidence: [] });
      byName.get(r.name).evidence.push({ file: f, line: r.line });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The line a JSON key is written on in a file's text, or 1. */
export function lineOfKey(text, key, after = 0) {
  const lines = linesOf(text);
  const re = new RegExp(`^\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`);
  for (let i = after; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 1;
}

/** Entry points and how the code starts, from package.json, a Dockerfile and
 *  a Procfile at the codebase's top: [{name, how, evidence}]. */
export function entryPoints(files, read) {
  const out = []; const starts = [];
  if (files.includes("package.json")) {
    const text = read("package.json");
    let pkg = null;
    try { pkg = JSON.parse(text); } catch { /* not JSON: said by the caller */ }
    if (pkg) {
      if (trim(pkg.main)) out.push({ name: trim(pkg.main), how: "the package's main module (package.json main)", evidence: [{ file: "package.json", line: lineOfKey(text, "main") }] });
      if (typeof pkg.bin === "string") out.push({ name: trim(pkg.bin), how: `a command, ${trim(pkg.name) || "the package's name"} (package.json bin)`, evidence: [{ file: "package.json", line: lineOfKey(text, "bin") }] });
      else if (pkg.bin && typeof pkg.bin === "object") {
        const at = lineOfKey(text, "bin");
        for (const [cmd, path] of Object.entries(pkg.bin)) out.push({ name: trim(path), how: `the command ${cmd} (package.json bin)`, evidence: [{ file: "package.json", line: lineOfKey(text, cmd, at - 1) }] });
      }
      if (pkg.exports && typeof pkg.exports === "object" && !Array.isArray(pkg.exports)) {
        const at = lineOfKey(text, "exports");
        for (const k of Object.keys(pkg.exports)) if (k.startsWith(".")) out.push({ name: k, how: "an export of the package (package.json exports)", evidence: [{ file: "package.json", line: lineOfKey(text, k, at - 1) }] });
      }
      const scriptsAt = lineOfKey(text, "scripts");
      for (const s of ["start", "serve", "dev"]) {
        if (trim(pkg.scripts?.[s])) starts.push({ step: `npm run ${s} runs: ${trim(pkg.scripts[s])}`, evidence: [{ file: "package.json", line: lineOfKey(text, s, scriptsAt - 1) }] });
      }
    }
  }
  for (const f of files.filter((x) => /^(Dockerfile|Containerfile)(\..+)?$/.test(basename(x)) && !x.includes("/"))) {
    linesOf(read(f) ?? "").forEach((line, i) => {
      const m = /^\s*(ENTRYPOINT|CMD)\s+(.+)$/i.exec(line);
      if (m) starts.push({ step: `the container runs (${m[1].toUpperCase()}): ${trim(m[2])}`, evidence: [{ file: f, line: i + 1 }] });
    });
  }
  if (files.includes("Procfile")) {
    linesOf(read("Procfile") ?? "").forEach((line, i) => {
      const m = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line);
      if (m) starts.push({ step: `the ${m[1]} process runs: ${trim(m[2])}`, evidence: [{ file: "Procfile", line: i + 1 }] });
    });
  }
  return { entry_points: out, starts_and_runs: starts };
}

/** True for a file that is a test by its name or its folder. */
export function isTestFile(f) {
  const name = basename(f);
  const parts = f.split("/");
  if (!CODE_EXT.has(extname(f).toLowerCase())) return false;
  if (/\.(test|spec)\.[a-z]+$/i.test(name) || /[-_]test\.[a-z]+$/i.test(name) || /^test[-_]/i.test(name) || /^test\.[a-z]+$/i.test(name) || /_test\.go$/.test(name) || /^test_.*\.py$/.test(name)) return true;
  return parts.slice(0, -1).some((p) => ["test", "tests", "__tests__", "spec"].includes(p));
}

/** The test files, each with the number of test cases its lines declare by
 *  rule (test(, it(, def test_, func Test), and the line of each. */
export function testFiles(files, read) {
  const out = [];
  for (const f of files.filter(isTestFile)) {
    const cases = [];
    linesOf(read(f) ?? "").forEach((line, i) => {
      const m = /^\s*(?:(?:test|it)(?:\.(?:only|skip|todo))?\s*\(\s*(["'`])(.+?)\1|def\s+(test_[A-Za-z0-9_]*)|func\s+(Test[A-Za-z0-9_]*)\s*\()/.exec(line);
      if (m) cases.push({ name: m[2] ?? m[3] ?? m[4], line: i + 1 });
    });
    out.push({ file: f, cases });
  }
  return out;
}

/** npm's placeholder test script, which runs nothing. */
export const NPM_PLACEHOLDER = /echo\s+\\?"Error: no test specified\\?"\s*&&\s*exit 1/;

/** The project's own test command, as package.json at its top names it:
 *  {command, evidence} or {none: why}. */
export function testCommand(files, read) {
  if (!files.includes("package.json")) return { none: "there is no package.json at the codebase's top, and this agent runs only the test script one names" };
  const text = read("package.json");
  let pkg;
  try { pkg = JSON.parse(text); } catch { return { none: "package.json is not JSON" }; }
  const script = trim(pkg?.scripts?.test);
  if (!script) return { none: "package.json names no test script" };
  if (NPM_PLACEHOLDER.test(script)) return { none: "package.json's test script is npm's placeholder, which runs no test", evidence: [{ file: "package.json", line: lineOfKey(text, "test", lineOfKey(text, "scripts") - 1) }] };
  return { command: script, evidence: [{ file: "package.json", line: lineOfKey(text, "test", lineOfKey(text, "scripts") - 1) }] };
}

/** OpenAPI and JSON Schema documents the code already carries (JSON only;
 *  a YAML one is listed by its path, as found, and not copied). */
export function foundSchemas(files, read) {
  const out = [];
  for (const f of files) {
    if (LOCKFILES.has(basename(f))) continue;
    const lower = f.toLowerCase();
    if (/\.(ya?ml)$/.test(lower) && /(openapi|swagger)/.test(basename(lower))) {
      const text = read(f);
      if (text !== null && /^\s*(openapi|swagger)\s*:/m.test(text)) out.push({ file: f, format: "openapi", encoding: "yaml", sha256: sha(text) });
      continue;
    }
    if (!lower.endsWith(".json")) continue;
    const text = read(f);
    if (text === null || text.length > 2_000_000) continue;
    let doc;
    try { doc = JSON.parse(text); } catch { continue; }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) continue;
    if (typeof doc.openapi === "string" || typeof doc.swagger === "string") out.push({ file: f, format: "openapi", encoding: "json", sha256: sha(text), doc });
    else if ((typeof doc.$schema === "string" && /json-schema/.test(doc.$schema)) || lower.endsWith(".schema.json")) out.push({ file: f, format: "json-schema", encoding: "json", sha256: sha(text), doc });
  }
  return out;
}

const sha = (t) => createHash("sha256").update(t).digest("hex");

/** Every fact at once. */
export function readFacts(files, read, { keep } = {}) {
  return {
    settings: settingsRead(files, read, keep),
    ...entryPoints(files, read),
    tests: testFiles(files, read),
    test_command: testCommand(files, read),
    schemas: foundSchemas(files, read),
  };
}
