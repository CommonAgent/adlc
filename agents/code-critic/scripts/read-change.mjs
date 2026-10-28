// Read the change: lay out what was given as the package it belongs to, say
// what each file is, and judge none of it.
//
// What a review is given is the programs, the tests and the Code stage's
// account (agenticdevelopment.ai, stage 07), and the role adds that a
// package's declarations are part of the change (agentroles.ai, code critic).
// They arrive one of two ways. As an archive of the package folder (a tar,
// gzipped or not), which keeps every path, so a finding can name
// scripts/choose-roles.mjs and not a bare file name. Or as loose files, which
// lose their folders on the way: the agent's own files are then found by
// content, the way the builder finds them; a script or a reference is put
// back where the package's plugin.json build entry says it lives; a file that
// imports node:test goes under test/; and anything else keeps its name.
//
// Three more things may come with it, each found by content: a unified diff,
// which makes the change that diff and not the whole package; the Code
// stage's account (the code writer's account.md, or any Markdown that says it
// is an account of the code); and an earlier review from this agent, whose
// findings this review answers for.
//
//   needs: node >= 22
//   RECORDS=<this job's records folder> FILES=<path[::media type]>[,...] [ASKED_TEXT=<the message, as a file>] node read-change.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { gunzipSync } from "node:zlib";
import { agentFilesAmongTexts } from "./agent-folder.mjs";

const trim = (s) => String(s ?? "").trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** The prefix the process runner puts on a piece's file name, per hop. */
export function plainName(path) {
  let n = basename(String(path ?? ""));
  while (/^\d+-[A-Za-z0-9_-]{8}-/.test(n)) n = n.replace(/^\d+-[A-Za-z0-9_-]{8}-/, "");
  return n;
}

const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const isTar = (b) => b.length > 262 && b.subarray(257, 262).toString("latin1") === "ustar";
const isZip = (b) => b.length > 4 && b.subarray(0, 4).toString("latin1") === "PK\u0003\u0004";

/** The regular files of a tar archive, gzipped or not: [{path, bytes}].
 *  Long names (ustar prefix and GNU ././@LongLink) are read; links, folders
 *  and anything that would climb out of the archive are left out. */
export function tarEntries(bytes) {
  let b = Buffer.from(bytes);
  if (isGzip(b)) b = gunzipSync(b);
  if (!isTar(b)) return null;
  const out = [];
  let i = 0, longName = null;
  const str = (s, e) => b.subarray(s, e).toString("utf8").replace(/\0.*$/s, "");
  while (i + 512 <= b.length) {
    const h = b.subarray(i, i + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(str(i + 124, i + 136).trim() || "0", 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(i + 345, i + 500);
    let name = longName ?? (prefix ? `${prefix}/${str(i, i + 100)}` : str(i, i + 100));
    longName = null;
    const body = b.subarray(i + 512, i + 512 + size);
    i += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = body.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (type === "x") { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8")); if (m) longName = m[1]; continue; }
    if (type !== "0" && type !== "\0") continue;
    name = name.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!name || name.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(name) || /^[a-zA-Z]:/.test(name)) continue;
    out.push({ path: name, bytes: Buffer.from(body) });
  }
  // One folder around everything (brand-reader/...) is the package's own
  // folder, not part of any path in it.
  const tops = new Set(out.map((e) => e.path.split("/")[0]));
  if (tops.size === 1 && out.every((e) => e.path.includes("/"))) {
    const top = [...tops][0] + "/";
    for (const e of out) e.path = e.path.slice(top.length);
  }
  return out;
}

/** Whether a text is a unified diff. */
export const looksLikeDiff = (text) => /^(diff --git |--- (a\/|\S)[^\n]*\n\+\+\+ )/m.test(String(text ?? "")) && /^@@ -\d/m.test(String(text ?? ""));

/** Whether a text is a review this agent wrote. */
export const looksLikeReview = (text) => /^\s*-?\s*reviewed_by:\s*code-critic\b/im.test(String(text ?? ""));

/** Whether a Markdown text is the Code stage's account. */
export const looksLikeAccount = (text, name = "") =>
  /account/i.test(name) || /^#{1,3} .*\baccount\b/im.test(String(text ?? "").split("\n").slice(0, 5).join("\n"));

/** The files a diff touches, by the path on its new side, each with the line
 *  numbers it adds or changes there. A deleted file has no lines. */
export function parseDiff(text) {
  const files = [];
  let cur = null, line = 0;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (raw.startsWith("diff --git ")) { cur = null; continue; }
    if (raw.startsWith("--- ")) { cur = { from: raw.slice(4).replace(/^a\//, "").replace(/\t.*$/, ""), path: null, lines: [], removed: 0 }; continue; }
    if (raw.startsWith("+++ ") && cur) {
      const p = raw.slice(4).replace(/^b\//, "").replace(/\t.*$/, "");
      cur.path = p === "/dev/null" ? cur.from : p;
      cur.deleted = p === "/dev/null";
      files.push(cur);
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h && cur) { line = Number(h[1]); continue; }
    if (!cur || !line) continue;
    if (raw.startsWith("+")) { cur.lines.push(line); line++; }
    else if (raw.startsWith("-")) cur.removed++;
    else if (raw.startsWith(" ") || raw === "") line++;
  }
  return files;
}

// What a credential value looks like on disk: the shapes the publisher
// refuses to publish. A value is left out of everything this job writes or
// sends, and where it was is said, because a credential in a package is
// itself something wrong with the change.
const CREDENTIAL_VALUES = [
  /AIza[0-9A-Za-z_-]{35}/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
const CREDENTIAL_FILE = /(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)[^/]*|credentials[^/]*\.json|service-account[^/]*\.json)$/i;
export const LEFT_OUT = "[a credential value, left out]";

/** The text with every credential value left out, and the lines they were on. */
export function redact(text) {
  let out = String(text ?? "");
  const lines = new Set();
  for (const re of CREDENTIAL_VALUES) {
    out = out.replace(re, (m, ...rest) => {
      const at = rest[rest.length - 2];
      lines.add(out.slice(0, at).split("\n").length);
      return LEFT_OUT;
    });
  }
  return { text: out, lines: [...lines].sort((a, b) => a - b) };
}

const DECLARATIONS = new Set(["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json", "descriptor.json", "install.json", "rules.md"]);
const SCRIPT_EXT = /\.(mjs|cjs|js|ts|mts|py|sh)$/;

/** What a file in the package is: declaration, script, test, reference or other. */
export function roleOf(path) {
  const p = String(path);
  if (DECLARATIONS.has(p) || /^skills\/[^/]+\/SKILL\.md$/.test(p)) return "declaration";
  if (/(^|\/)node_modules\//.test(p) || /(^|\/)package-lock\.json$/.test(p)) return "other";
  if (p.startsWith("test/") || /\.test\.m?[jt]s$/.test(p) || /(^|\/)test_[^/]+\.py$/.test(p)) return p.startsWith("references/") ? "reference" : "test";
  if (p.startsWith("references/") || p.startsWith("assets/")) return "reference";
  if (SCRIPT_EXT.test(p) && !p.startsWith("records/") && !p.startsWith("host/")) return "script";
  return "other";
}

/** The package's build entry: script and reference paths by base name. */
function buildPaths(manifestText) {
  const at = new Map();
  try {
    const skills = JSON.parse(manifestText)?.extensions?.["net.agentdoc.package"]?.build?.skills ?? {};
    for (const s of Object.values(skills)) for (const k of ["scripts", "references", "assets"]) for (const p of s?.[k] ?? []) at.set(basename(p), p);
  } catch { /* not a manifest */ }
  return at;
}

/** Everything given, laid out. `given` is [{path, media_type}]; `read`
 *  returns a file's bytes. Returns the record read.json holds, and the
 *  laid-out files' texts under `texts` (not written to the record). */
export function readChange(given = [], { read = (p) => readFileSync(p), asked = "" } = {}) {
  const loose = [];
  const notes = [];
  let archive = null;
  for (const g of given) {
    if (!g?.path || /job-manifest\.json$/.test(g.path)) continue;
    let bytes;
    try { bytes = read(g.path); } catch { notes.push(`${plainName(g.path)} could not be read`); continue; }
    if (isZip(bytes)) { notes.push(`${plainName(g.path)} is a zip archive, which is not read here; send the package as a tar.gz or as its files`); continue; }
    const entries = (isGzip(bytes) || isTar(bytes)) ? tarEntries(bytes) : null;
    if (entries) { archive = plainName(g.path); for (const e of entries) loose.push({ path: e.path, bytes: e.bytes, fromArchive: true }); continue; }
    loose.push({ path: plainName(g.path), bytes, media_type: g.media_type || "" });
  }

  let diff = null, earlier = null, account = null;
  const pkg = [];
  const withheld = [];
  for (const f of loose) {
    if (CREDENTIAL_FILE.test(f.path)) { withheld.push(f.path); notes.push(`${f.path} looks like a credential file and was not read`); continue; }
    let text = f.bytes.includes(0) ? null : f.bytes.toString("utf8");
    if (text !== null) { const r = redact(text); text = r.text; if (r.lines.length) f.credential_lines = r.lines; }
    if (text !== null && !f.fromArchive && looksLikeDiff(text)) { diff = { name: f.path, text }; continue; }
    if (text !== null && /\.md$/i.test(f.path) && looksLikeReview(text)) { earlier = { name: f.path, text }; continue; }
    if (text !== null && /\.md$/i.test(f.path) && !DECLARATIONS.has(f.path) && !/SKILL\.md$/i.test(f.path)
      && roleOf(f.path) === "other" && !/^readme\.md$/i.test(basename(f.path)) && looksLikeAccount(text, f.path)) { account = { name: f.path, text }; continue; }
    pkg.push({ ...f, text });
  }

  // Loose files are put back where they live. Archived ones already are.
  const laid = new Map();
  const archived = pkg.filter((f) => f.fromArchive);
  for (const f of archived) laid.set(f.path, f);
  const rest = pkg.filter((f) => !f.fromArchive);
  if (rest.length) {
    const found = agentFilesAmongTexts(rest.filter((f) => f.text !== null).map((f, i) => ({ key: String(pkg.indexOf(f)), text: f.text })));
    const used = new Set();
    if (found) {
      const put = (key, rel) => { const f = pkg[Number(key)]; laid.set(rel, { ...f, path: rel }); used.add(f); };
      put(found.descriptor, "agent-descriptor.json");
      put(found.runtime, "agent-runtime-requirements.json");
      put(found.manifest, "plugin.json");
      for (const [slug, key] of Object.entries(found.skills ?? {})) put(key, `skills/${slug}/SKILL.md`);
    }
    const manifest = laid.get("plugin.json")?.text ?? "";
    const paths = buildPaths(manifest);
    for (const f of rest) {
      if (used.has(f)) continue;
      let rel = f.path;
      if (paths.has(rel)) rel = paths.get(rel);
      else if (f.text !== null && /from\s+["']node:test["']/.test(f.text)) rel = `test/${rel}`;
      else if (rel === "rules.md" || /^[\w.-]+\.md$/.test(rel)) rel = rel;
      while (laid.has(rel)) rel = rel.replace(/(\.[^./]+)?$/, (ext) => `-again${ext}`);
      laid.set(rel, { ...f, path: rel });
    }
  }

  const files = [...laid.values()].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({
    path: f.path, role: roleOf(f.path), bytes: f.bytes.length, sha256: sha(f.bytes),
    lines: f.text === null ? null : f.text.split("\n").length, text: f.text,
    ...(f.credential_lines ? { credential_lines: f.credential_lines } : {}),
  }));

  // The diff's paths are the repository's; the package's are the folder's.
  // A diff path is matched to the laid-out file it ends with.
  let change = { scope: "package", files: [] };
  if (diff) {
    const byPath = files.map((f) => f.path);
    const mapped = parseDiff(diff.text).map((d) => {
      const rel = byPath.find((p) => d.path === p || d.path.endsWith(`/${p}`)) ?? d.path;
      return { path: rel, in_package: byPath.includes(rel), lines: d.lines, removed: d.removed, deleted: Boolean(d.deleted) };
    });
    change = { scope: "diff", diff: diff.name, files: mapped };
  }

  let name = null, version = null;
  try { const m = JSON.parse(files.find((f) => f.path === "plugin.json")?.text ?? "null"); name = m?.name ?? null; version = m?.version ?? null; } catch { /* none */ }
  return {
    read: "v1",
    package: { name, version },
    archive,
    files: files.map(({ text, ...f }) => f),
    change,
    account: account ? { name: account.name } : null,
    earlier: earlier ? { name: earlier.name } : null,
    asked: redact(trim(asked).slice(0, 4000)).text,
    notes,
    withheld,
    texts: Object.fromEntries(files.filter((f) => f.text !== null).map((f) => [f.path, f.text])),
    account_text: redact(account?.text ?? "").text,
    earlier_text: redact(earlier?.text ?? "").text,
    diff_text: redact(diff?.text ?? "").text,
  };
}

/** Lay the package out under dir by its texts, and write read.json beside it.
 *  The texts are not repeated in the record. */
export function writeRead(records, r) {
  const dir = join(records, "package");
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(r.texts)) {
    const at = normalize(join(dir, rel));
    if (!at.startsWith(normalize(dir))) continue;
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  const { texts, account_text, earlier_text, diff_text, ...record } = r;
  mkdirSync(records, { recursive: true });
  writeFileSync(join(records, "read.json"), JSON.stringify({ ...record, laid_out: dir }, null, 2) + "\n");
  for (const [n, t] of [["account.md", account_text], ["earlier-review.md", earlier_text], ["change.diff", diff_text]]) {
    if (t) writeFileSync(join(records, n), t);
  }
  return dir;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS, FILES, ASKED_TEXT } = process.env;
  if (!RECORDS || !FILES) { console.error("RECORDS and FILES are required"); process.exit(2); }
  const given = FILES.split(",").filter(Boolean).map((v) => { const [path, media_type] = v.split("::"); return { path, media_type }; });
  const asked = ASKED_TEXT && existsSync(ASKED_TEXT) ? readFileSync(ASKED_TEXT, "utf8") : "";
  const r = readChange(given, { asked });
  writeRead(RECORDS, r);
  console.log(JSON.stringify({ ok: true, code: 0, files: r.files.length, scope: r.change.scope }));
}
