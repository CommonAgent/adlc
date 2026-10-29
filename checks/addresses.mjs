// No network address written into an agent's scripts.
//
// Common Agent 12.6 rule 2: a package carries no address of its own. Where a
// system is, a model included, is the install's to place, and a script reads
// it from a setting (12.4.1 for the model, MODEL_ENDPOINT). Section 12.10's
// address check is how a checker finds one, by reading text the same way in
// every language, and a depot refuses a package that carries one. This is that
// check, run here before anything is published.
//
// The files it reads:
//   - in each package source (each agents/<role> with a plugin.json), every
//     file under scripts/ and under any skill's scripts/ folder, which is what
//     a built package carries as skills/<slug>/scripts/, and any other file a
//     run command in agent-runtime-requirements.json names; lockfiles aside;
//   - in the image tools (agents/image) and the package maker
//     (agents/package-maker), which are not packages, every file of code and
//     every JSON file, leaving out tests (a test/ or fixtures/ folder,
//     *.test.*, test_*.py), lockfiles and documents.
//
// An address literal, comments included, is what 12.10 says: a scheme of
// http, https, ws or wss in any case, then ://, then a letter, a digit or [;
// or an IPv4 address in 169.254.0.0/16, with or without a scheme. One thing is
// added here: the metadata server's host name, metadata.google.internal, on
// its own. A literal that begins with one of the seven identifier prefixes
// 12.10 excepts (a format's name spelled as an address) is not a fault.
//
// The agents written before the rule still carry addresses, so the check
// starts from a list of them, known-addresses.json: each entry is a file, an
// address in it, and what it is. A listed address passes. Anything not on the
// list fails, and so does an entry whose address is gone from its file, so
// the list is shortened as each agent is rebuilt. With --base <git ref>, an
// entry that ref's list does not have fails too: the list only shrinks.
//
//   node checks/addresses.mjs [--base <git ref>]   exits 1 on any finding
//   node checks/addresses.mjs --list               prints every address found, as list entries
//
//   needs: node >= 22 (git for --base)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const KNOWN_FILE = "checks/known-addresses.json";

/** The folders read whole, besides the scripts of every package source. */
export const ALSO_READ = ["agents/image", "agents/package-maker"];

/** The identifiers 12.10 excepts: a literal beginning with one is a format's name. */
export const IDENTIFIERS = [
  "http://www.w3.org/", "https://www.w3.org/", "http://json-schema.org/", "https://json-schema.org/",
  "http://purl.org/", "http://schemas.openxmlformats.org/", "http://schemas.microsoft.com/",
];

const SKIP_DIRS = new Set(["node_modules", ".git", "out", "__pycache__", "test", "tests", "__tests__", "fixtures"]);
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "uv.lock", "Pipfile.lock"]);
const CODE = new Set([".mjs", ".js", ".cjs", ".ts", ".mts", ".cts", ".py", ".sh", ".bash", ".tmpl", ".yaml", ".yml", ".toml", ".json"]);

const URL_RE = /\b(?:https?|wss?):\/\/[A-Za-z0-9[][^\s"'`<>\\]*/gi;
const METADATA_RE = /\bmetadata\.google\.internal\b/gi;
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const LINK_LOCAL_RE = new RegExp(`(?<![\\w.])169\\.254\\.${OCTET}\\.${OCTET}(?![\\w.])`, "g");

const posix = (p) => p.split(sep).join("/");
const isIdentifier = (a) => IDENTIFIERS.some((p) => a.toLowerCase().startsWith(p));

/** Every address literal in a piece of text, in order. An address inside a URL
 *  is counted once, as the URL; an excepted identifier is not counted. */
export function addressesIn(text) {
  const out = [];
  let rest = String(text ?? "");
  for (const m of rest.matchAll(URL_RE)) {
    const a = m[0].replace(/[.,;:)]+$/, "");
    if (!isIdentifier(a)) out.push(a);
  }
  rest = rest.replace(URL_RE, " ");
  for (const re of [METADATA_RE, LINK_LOCAL_RE]) for (const m of rest.matchAll(re)) out.push(m[0]);
  return out;
}

/** The package sources: each agents/<role> with a plugin.json. */
export function packages(root = ROOT) {
  const agents = join(root, "agents");
  return existsSync(agents) ? readdirSync(agents).filter((d) => existsSync(join(agents, d, "plugin.json"))).map((d) => `agents/${d}`).sort() : [];
}

function* walk(dir, skip) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!skip.has(name)) yield* walk(p, skip); }
    else if (st.isFile()) yield p;
  }
}

const isTest = (name) => /\.(test|spec)\.[cm]?[jt]s$/.test(name) || /^test_.*\.py$/.test(name) || /_test\.py$/.test(name);
const isLock = (name) => LOCKFILES.has(name) || name.endsWith(".lock");

/** The files a package source's run commands name, in the source, outside the
 *  scripts folders already read: each argument {home}/{package}/<path>. */
function runFiles(root, pkg) {
  const p = join(root, pkg, "agent-runtime-requirements.json");
  if (!existsSync(p)) return [];
  let run;
  try { run = JSON.parse(readFileSync(p, "utf8")).run ?? {}; } catch { return []; }
  const out = [];
  for (const job of Object.values(run)) {
    for (const arg of Array.isArray(job?.command) ? job.command : []) {
      const m = /\{package\}\/(.+)$/.exec(String(arg));
      if (!m || /^skills\/[^/]+\/scripts\//.test(m[1])) continue;
      const f = normalize(join(root, pkg, m[1]));
      if (f.startsWith(normalize(join(root, pkg))) && existsSync(f) && statSync(f).isFile()) out.push(f);
    }
  }
  return out;
}

/** Every file this check reads, as paths relative to the root. */
export function filesRead(root = ROOT) {
  const out = [];
  const noDeps = new Set(["node_modules", ".git", "__pycache__"]);
  for (const pkg of packages(root)) {
    const dirs = [join(root, pkg, "scripts")];
    const skills = join(root, pkg, "skills");
    if (existsSync(skills)) for (const s of readdirSync(skills).sort()) dirs.push(join(skills, s, "scripts"));
    for (const d of dirs) for (const p of walk(d, noDeps)) if (!isLock(basename(p))) out.push(p);
    out.push(...runFiles(root, pkg));
  }
  for (const folder of ALSO_READ) {
    for (const p of walk(join(root, folder), SKIP_DIRS)) {
      const name = basename(p);
      if (isTest(name) || isLock(name)) continue;
      const ext = extname(name);
      if (CODE.has(ext) || name === "Dockerfile") out.push(p);
      else if (!ext) { try { if (readFileSync(p, "utf8").startsWith("#!")) out.push(p); } catch { /* unreadable: not code */ } }
    }
  }
  return [...new Set(out.map((p) => posix(relative(root, p))))].sort();
}

/** Every address in the files read: [{file, at, address}], `at` the line. */
export function scan(root = ROOT) {
  const hits = [];
  for (const file of filesRead(root)) {
    const buf = readFileSync(join(root, file));
    if (buf.includes(0)) continue;
    buf.toString("utf8").split(/\r?\n/).forEach((line, i) => {
      for (const a of addressesIn(line)) hits.push({ file, at: i + 1, address: a });
    });
  }
  return hits;
}

const keyOf = (e) => `${e.file}\n${e.address}`;

/** The known list: [{file, address, what}]. */
export function readKnown(root = ROOT) {
  const p = join(root, KNOWN_FILE);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")).known ?? [];
}

/** What fails: an address not on the list (`found`), a listed address no longer
 *  in its file (`gone`), and, given the base's list, an entry it did not have
 *  (`added`). */
export function judge(hits, known, base = null) {
  const listed = new Set(known.map(keyOf));
  const present = new Set(hits.map(keyOf));
  const found = hits.filter((h) => !listed.has(keyOf(h)));
  const gone = known.filter((k) => !present.has(keyOf(k)));
  const before = base ? new Set(base.map(keyOf)) : null;
  const added = before ? known.filter((k) => !before.has(keyOf(k))) : [];
  return { found, gone, added };
}

/** The base's list, read from git, or null when that ref has none. */
export function knownAt(ref, root = ROOT) {
  try {
    const text = execFileSync("git", ["show", `${ref}:${KNOWN_FILE}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(text).known ?? [];
  } catch {
    return null;
  }
}

/** The findings in words, one line each. */
export function report({ found, gone, added }) {
  const lines = [];
  for (const h of found) {
    lines.push(`${h.file}:${h.at} writes the address ${h.address}. A package carries no address of its own (Common Agent 12.6 rule 2, the address check of 12.10): read it from a setting the install places, MODEL_ENDPOINT for a model. Comments count; tests, lockfiles and documents are not read.`);
  }
  for (const k of gone) lines.push(`${k.file} no longer writes ${k.address}: take its entry off ${KNOWN_FILE}.`);
  for (const k of added) lines.push(`${KNOWN_FILE} gained an entry for ${k.address} in ${k.file}: the list only shrinks. Read the address from a setting instead.`);
  return lines;
}

const thisFile = process.argv[1] ? basename(process.argv[1]) : "";
if (thisFile && import.meta.url.endsWith(`/${thisFile}`)) {
  const args = process.argv.slice(2);
  const hits = scan();
  if (args.includes("--list")) {
    const seen = new Set();
    const entries = hits.filter((h) => !seen.has(keyOf(h)) && seen.add(keyOf(h))).map((h) => ({ file: h.file, address: h.address, what: "" }));
    console.log(JSON.stringify(entries, null, 2));
  } else {
    const i = args.indexOf("--base");
    const base = i >= 0 ? knownAt(args[i + 1]) : null;
    const lines = report(judge(hits, readKnown(), base));
    if (lines.length) {
      for (const l of lines) console.error(l);
      process.exitCode = 1;
    } else {
      console.log(`no address outside ${KNOWN_FILE} in ${filesRead().length} files (${readKnown().length} known, each read from a setting once its agent is rebuilt)`);
    }
  }
}
