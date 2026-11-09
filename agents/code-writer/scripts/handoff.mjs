// Hand the code step out: lay out a build folder for whoever writes the
// scripts, write the house rules into it, and pack it as one gzip tar archive.
//
// The person or coding agent who takes the folder needs everything in one
// place and needs to know what they may not touch. So the folder holds the
// spec (spec.json, and spec.md when it came: what Requirements hands back
// since stages.json 1.6.0) and the agent's files as they came, the suite under test/ byte for byte (binary
// fixtures too), every script the spec names under scripts/ (the released
// script where the released package carries one at that path, otherwise a stub
// exporting what the suite imports), every other file the released package
// carries at its own path, AGENTS.md with the rules, CLAUDE.md pointing to it,
// .adlc/ with the check so `node .adlc/check.mjs` runs the same check
// locally, and build.lock.json with the digest of every pinned file, which is
// what the hand-back is checked against. A prototype that is not a package
// (loose files, any language) goes under prototype/ only and every script is
// stubbed. Nothing here calls a model or reaches a network, and the archive is
// written by archive.mjs in node alone, deterministically, so the same inputs
// give the same bytes.
//
// The spec comes the way everything else does, as a --file, and is found by
// what is in it (code-writer 0.4.0): spec.json is the JSON whose format is
// spec-v1; spec.md is its rendering for a person, a Markdown file named
// spec.md (once the process runner's prefixes are off) or one that carries the
// product's name and every acceptance scenario's id. Both go at the folder's
// top, read-only, pinned in build.lock.json like the agent's files, and
// AGENTS.md tells whoever writes the scripts to read the spec first. Before
// this a spec that came went under prototype/ as a loose file, and nothing
// said to read it: the stop pattern, the refusal's words and the output's
// schema it carried reached no one. A hand-off with no spec is laid out as
// before, and AGENTS.md is the same as before.
//
//   needs: node >= 22
//   node handoff.mjs --job <job folder> --records <records folder> --work <work folder> --file <path>::<media type> ...
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESCRIPTOR_FILE, MANIFEST_FILE, RUNTIME_FILE, specOfFolder } from "./agent-folder.mjs";
import { LOCK_FILE, agentFilesByPath, digestOf, extrasOf, importsOf, listing, plainName, scriptsOf, sortAttachments, staysInside, stubFor } from "./workspace.mjs";
import { entriesIn, pack } from "./archive.mjs";

const trim = (s) => String(s ?? "").trim();
const here = dirname(fileURLToPath(import.meta.url));
const bytesOf = (v) => (Buffer.isBuffer(v) ? v : v instanceof Uint8Array ? Buffer.from(v) : Buffer.from(String(v ?? ""), "utf8"));
const norm = (p) => trim(p).replace(/\\/g, "/").replace(/^(\.\/)+/, "");
const readOnly = (p) => { try { chmodSync(p, 0o444); } catch { /* a hint; the lock is the fence */ } };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where the spec goes in the build folder: the data, and its rendering for
 *  a person. */
export const SPEC_FILE = "spec.json";
export const SPEC_MD_FILE = "spec.md";

/** Whether a text is the spec (spec-v1): JSON whose format says so, with
 *  features. */
export function isSpecV1Text(text) {
  try {
    const d = JSON.parse(String(text ?? ""));
    return Boolean(d && typeof d === "object" && !Array.isArray(d) && d.format === "spec-v1" && Array.isArray(d.features) && d.features.length);
  } catch { return false; }
}

/** The acceptance scenario ids a spec carries. */
const scenarioIds = (doc) => (doc?.features ?? []).flatMap((f) => (f?.acceptance ?? []).map((a) => trim(a?.id))).filter(Boolean);

/** Whether a text is the spec's rendering for a person: Markdown, not JSON and
 *  not a skill, named spec.md, or carrying the product's name and every
 *  acceptance scenario id the spec gives (a rendering lists them all). */
export function looksLikeSpecMd(text, name = "", doc = null) {
  const t = String(text ?? "");
  if (!trim(t) || /^\s*[{[]/.test(t) || /^---\r?\n/.test(t)) return false;
  if (/(^|[-_.])spec\.md$/i.test(plainName(name))) return true;
  const ids = scenarioIds(doc);
  const product = trim(doc?.product?.name);
  const has = (id) => new RegExp(`(?<![\\w.])${id.replace(/\./g, "\\.")}(?![\\w])`).test(t);
  return ids.length > 0 && ids.every(has) && (!product || t.includes(product));
}

/** The spec among files that arrived loose, as {path, bytes}: spec.json, the
 *  last JSON whose format is spec-v1, and spec.md, its rendering, each null
 *  when it did not come. Found by content, the way the agent's files and the
 *  suite are. */
export function specAmong(files = []) {
  const text = (f) => Buffer.from(f.bytes).toString("utf8");
  const json = [...files].reverse().find((f) => isSpecV1Text(text(f))) ?? null;
  const doc = json ? JSON.parse(text(json)) : null;
  const md = files.find((f) => f !== json && looksLikeSpecMd(text(f), f.path, doc)) ?? null;
  return { json, md };
}

/** What `check.mjs` needs beside it in .adlc/, so the folder checks itself. */
export const ADLC_FILES = ["check.mjs", "workspace.mjs", "agent-folder.mjs", "archive.mjs"];
export const TEMPLATE_FILE = "agents-md-template.md";
export const ARCHIVE_NAME = "build-folder.tar.gz";

/** The command line: --job, --records, --work, --message (the file the host
 *  wrote the sender's text to) and any number of --file <path>::<media type>. */
export function fromArgv(argv = []) {
  const out = { job: "", records: "", work: "", message: "", files: [] };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let value;
    const eq = /^(--[a-z]+)=(.*)$/.exec(flag);
    if (eq) { flag = eq[1]; value = eq[2]; } else value = argv[i + 1];
    if (!["--job", "--records", "--work", "--message", "--file"].includes(flag)) continue;
    if (!eq) i += 1;
    if (value === undefined) continue;
    if (flag === "--file") {
      const at = String(value).lastIndexOf("::");
      out.files.push(at < 0 ? { path: String(value), declared: "" } : { path: String(value).slice(0, at), declared: String(value).slice(at + 2) });
    } else out[flag.slice(2)] = String(value);
  }
  return out;
}

/** Whether a released package's files are laid in its own layout: it carries
 *  the agent's files or something under scripts/. Loose files are not. */
const isPackage = (paths) => paths.some((p) => p.startsWith("scripts/") || p === DESCRIPTOR_FILE);

/** The paths a released package may not put at their own place in the build
 *  folder: the agent's files and skills, the suite, and what this step writes. */
const taken = (p) => p.startsWith("scripts/") || p.startsWith("test/") || p.startsWith("skills/") || p.startsWith("records/") || p.startsWith("prototype/")
  || p.startsWith(".adlc/") || [DESCRIPTOR_FILE, RUNTIME_FILE, MANIFEST_FILE, SPEC_FILE, SPEC_MD_FILE, "AGENTS.md", "CLAUDE.md", LOCK_FILE].includes(p);

/** Lay out the build folder in `dir`. `agent`, `suite` and `prototype` are
 *  maps from a path to its bytes (or text); `spec` holds spec.json and
 *  spec.md, either or both, when the spec came. Returns what was laid out. */
export function layOutBuildFolder({ dir, agent = {}, suite = {}, prototype = {}, spec: specFiles = {}, scriptsDir = here } = {}) {
  if (!dir) throw new Error("no build folder to lay out");
  mkdirSync(dir, { recursive: true });
  const put = (rel, bytes, ro = true) => {
    const at = join(dir, rel);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, bytes);
    if (ro) readOnly(at);
  };

  for (const [rel, v] of Object.entries(agent)) {
    const p = norm(rel);
    if (!staysInside(p)) throw new Error(`an agent file must stay inside the folder, not ${rel}`);
    put(p, bytesOf(v));
  }
  // The spec, at the folder's top beside the agent's files, read-only and
  // pinned by the lock like them.
  const specLaid = [];
  for (const [rel, v] of Object.entries(specFiles ?? {})) {
    if (![SPEC_FILE, SPEC_MD_FILE].includes(rel) || v == null) continue;
    put(rel, bytesOf(v));
    specLaid.push(rel);
  }
  const tests = {};
  for (const [rel, v] of Object.entries(suite)) {
    const p = norm(rel);
    if (!p.startsWith("test/") || !staysInside(p)) throw new Error(`a suite file must live under test/, not ${rel}`);
    tests[p] = bytesOf(v);
    put(p, tests[p]);
  }
  const testFiles = Object.keys(tests).filter((p) => /^test\/[^/]+\.test\.mjs$/.test(p));
  if (!testFiles.length) throw new Error("the suite has no test/<name>.test.mjs; nothing would run");

  const proto = new Map(Object.entries(prototype).map(([p, v]) => [norm(p), bytesOf(v)]).filter(([p]) => staysInside(p)));
  const asPackage = isPackage([...proto.keys()]);
  const spec = specOfFolder(dir);
  const wanted = new Map();
  for (const p of testFiles) for (const { script, names } of importsOf(tests[p].toString("utf8"))) {
    if (!wanted.has(script)) wanted.set(script, new Set());
    for (const n of names) wanted.get(script).add(n);
  }

  // Every script the spec names: released where the package carries it.
  const scripts = [];
  const used = new Set();
  for (const s of scriptsOf(spec)) {
    if (!staysInside(s) || !s.startsWith("scripts/")) throw new Error(`the spec names a script outside scripts/: ${s}`);
    if (asPackage && proto.has(s)) { put(s, proto.get(s), false); used.add(s); scripts.push({ path: s, from: "prototype" }); continue; }
    if (!s.endsWith(".mjs")) { put(s, Buffer.alloc(0), false); scripts.push({ path: s, from: "empty", names: [] }); continue; }
    const names = [...(wanted.get(s) ?? [])];
    put(s, Buffer.from(stubFor(s, names)), false);
    scripts.push({ path: s, from: names.length ? "stub" : "empty", names });
  }

  // The rest of the released package, at its own path and read-only; loose
  // files, and the paths this folder already holds, go under prototype/.
  const prototypeFiles = [];
  const laid = [];
  for (const [p, bytes] of proto) {
    if (used.has(p)) continue;
    const own = asPackage && !taken(p) && !existsSync(join(dir, p));
    put(own ? p : `prototype/${p}`, bytes);
    (own ? laid : prototypeFiles).push(p);
  }

  // References and assets the spec names that nothing carried are stood in as
  // empty, the way the workspace does, and said.
  const stoodIn = [];
  for (const rel of extrasOf(spec)) {
    const p = norm(rel);
    if (!staysInside(p) || p.startsWith("scripts/") || existsSync(join(dir, p))) continue;
    const flat = [...proto.keys()].find((k) => !k.includes("/") && k === basename(p));
    if (/\.[a-z0-9]+$/i.test(basename(p))) put(p, flat ? proto.get(flat) : Buffer.alloc(0));
    else mkdirSync(join(dir, p), { recursive: true });
    if (!flat) stoodIn.push(p);
  }

  // The check, beside the scripts it needs, so the folder checks itself.
  mkdirSync(join(dir, ".adlc"), { recursive: true });
  for (const f of ADLC_FILES) {
    const from = join(scriptsDir, f);
    if (!existsSync(from)) throw new Error(`the check needs ${f} beside handoff.mjs and it is not there`);
    put(join(".adlc", f), readFileSync(from));
  }
  return { scripts, prototype: prototypeFiles, laid, stood_in: stoodIn, spec: specLaid, unnamed: [...wanted.keys()].filter((s) => !scriptsOf(spec).includes(s)) };
}

/** The lock: the digest of every pinned file, which is every file outside
 *  scripts/ except the lock itself and records/, and the scripts the folder
 *  started with. */
export function buildLock(dir, { scripts = [] } = {}) {
  const found = listing(dir, { skip: ["scripts", "records", ".git", LOCK_FILE] });
  const digests = Object.fromEntries(Object.entries(found).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { build_lock: "v1", digests, scripts };
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** The template's part on reading the spec first, between these two lines:
 *  kept, with its markers taken out, when the folder holds the spec, and
 *  taken out whole when it does not, so a hand-off with no spec gets the
 *  AGENTS.md it got before. */
export const SPEC_START = "<!-- when the spec came -->";
export const SPEC_END = "<!-- end when the spec came -->";

/** The template with its spec part kept or taken out, for the spec files the
 *  folder holds: {{spec_file}} is the one to read (spec.md when it came, for
 *  a person, else spec.json) and {{spec_also}} says spec.json holds the same
 *  as data when both came. */
export function withSpecPart(templateText, spec = []) {
  const text = String(templateText ?? "");
  const at = text.indexOf(SPEC_START);
  const end = text.indexOf(SPEC_END);
  if (at < 0 || end < at) return text;
  const after = end + SPEC_END.length;
  if (!spec.length) return text.slice(0, at) + text.slice(after).replace(/^\r?\n(\r?\n)?/, "");
  const read = spec.includes(SPEC_MD_FILE) ? SPEC_MD_FILE : SPEC_FILE;
  const also = spec.includes(SPEC_MD_FILE) && spec.includes(SPEC_FILE) ? ` ${SPEC_FILE} holds the same, as data.` : "";
  const part = text.slice(at + SPEC_START.length, end).replace(/^\r?\n/, "").replace(/\{\{spec_file\}\}/g, read).replace(/\{\{spec_also\}\}/g, also);
  return text.slice(0, at) + part + text.slice(after).replace(/^\r?\n/, "");
}

/** AGENTS.md from the template, CLAUDE.md pointing to it, and build.lock.json.
 *  {{name}}, {{version}} and {{scripts}} in the template are filled in when
 *  the folder holds an agent to say them about, and the part on reading the
 *  spec is kept when `spec` names the spec files the folder holds. */
export function writeHouseRules(dir, { templateText = "", scripts = [], spec = [] } = {}) {
  if (!trim(templateText)) throw new Error("the house rules template is missing, so no rules can be written");
  const plugin = readJson(join(dir, MANIFEST_FILE));
  const descriptor = readJson(join(dir, DESCRIPTOR_FILE));
  const name = trim(plugin?.name ?? descriptor?.name);
  const version = trim(plugin?.version ?? descriptor?.agent_version);
  const named = scripts.length ? scripts.map((s) => s.path) : Object.keys(listing(join(dir, "scripts"))).map((r) => `scripts/${r}`);
  const list = scripts.length
    ? scripts.map((s) => `- ${s.path} (${s.from === "prototype" ? "the released script" : "a stub"})`).join("\n")
    : named.map((p) => `- ${p}`).join("\n");
  let text = withSpecPart(templateText, spec);
  if (name) text = text.replace(/\{\{name\}\}/g, name);
  if (version) text = text.replace(/\{\{version\}\}/g, version);
  if (named.length) text = text.replace(/\{\{scripts\}\}/g, list);
  const at = (f) => join(dir, f);
  for (const f of ["AGENTS.md", "CLAUDE.md", LOCK_FILE]) rmSync(at(f), { force: true });
  writeFileSync(at("AGENTS.md"), text);
  writeFileSync(at("CLAUDE.md"), "Read AGENTS.md in this folder first: it holds the rules for writing the scripts.\n");
  const lock = buildLock(dir, { scripts });
  writeFileSync(at(LOCK_FILE), JSON.stringify(lock, null, 2) + "\n");
  return lock;
}

const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const refuse = (reply) => ({ ok: false, code: 3, reply });

/** Sort what arrived: loose files by what is in them, and gzip tar archives
 *  by what they hold. An archive with the agent's files or a scripts/ folder
 *  is a released package, taken as the prototype as it is; one holding test/
 *  is the suite with its folders. */
function sortArrivals(files, read) {
  const loose = []; const suite = {}; const prototype = {};
  const bytes = new Map();
  for (const f of files) {
    let b;
    try { b = read(f.path); } catch { continue; }
    if (!b) continue;
    b = Buffer.from(b);
    if (b[0] === 0x1f && b[1] === 0x8b) {
      const entries = entriesIn(b).filter((e) => e.type === "file").map((e) => ({ path: norm(e.path), bytes: e.bytes })).filter((e) => e.path && staysInside(e.path));
      const paths = entries.map((e) => e.path);
      const released = paths.includes(DESCRIPTOR_FILE) || paths.some((p) => p.startsWith("scripts/"));
      if (!released && paths.some((p) => p.startsWith("test/"))) for (const e of entries) { if (e.path.startsWith("test/")) suite[e.path] = e.bytes; }
      else for (const e of entries) prototype[e.path] = e.bytes;
    } else { bytes.set(f.path, b); loose.push(f.path); }
  }
  const sorted = sortAttachments(loose, (p) => bytes.get(p));
  for (const f of sorted.suite) suite[f.path] = Buffer.from(f.text, "utf8");
  // The spec is among what would otherwise be loose prototype files: taken
  // out of them and kept for the folder's top (code-writer 0.4.0).
  const found = specAmong(sorted.code);
  const spec = {};
  if (found.json) spec[SPEC_FILE] = found.json.bytes;
  if (found.md) spec[SPEC_MD_FILE] = found.md.bytes;
  for (const f of sorted.code) if (f !== found.json && f !== found.md && !(f.path in prototype)) prototype[f.path] = f.bytes;
  return { agent: sorted.agent, suite, prototype, spec };
}

/** Whether a message asks for the hand-off: its first line begins with
 *  "Hand off the code", in any case. */
export const asksForHandoff = (text) => /^\s*hand off the code\b/i.test(String(text ?? "").split(/\r?\n/)[0]);

/** The whole job: sort, lay out, write the rules, pack, file the piece.
 *  `read` and the template are handed in by tests.
 *
 *  The host keeps one command for this agent and runs it for every ordinary
 *  message, so when the host passes the message (`message`, a file path) and
 *  it does not ask for the hand-off, nothing is laid out or filed and the
 *  answer is {escalate: true}: the host then wakes the coding session for
 *  write-the-scripts. A missing or unreadable message file is no request for
 *  the hand-off. Called with no message at all, it hands off as before. */
export function handoff({ jobDir, recordsDir, workDir, files = [], message = null, messageFile = null, templateText = null, templatePath = null, scriptsDir = here, read = (p) => readFileSync(p) } = {}) {
  if (!jobDir || !recordsDir || !workDir) throw new Error("--job, --records and --work are required");
  const said = message ?? messageFile;
  if (said) {
    let text = "";
    try { text = readFileSync(said, "utf8"); } catch { text = ""; }
    if (!asksForHandoff(text)) return { ok: true, code: 0, escalate: true, reply: "" };
  }
  if (!files.length) return refuse("Nothing is laid out: no file arrived, so there are no agent's files and no suite. The spec writer's files and the test writer's suite are what the build folder is made of.");
  const got = sortArrivals(files, read);
  if (!got.agent) return refuse("Nothing is laid out: none of the files that arrived is the agent's files (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and each skill's SKILL.md). The spec writer writes them first.");
  if (!Object.keys(got.suite).some((p) => /^test\/[^/]+\.test\.mjs$/.test(p))) return refuse("Nothing is laid out: no suite arrived, nothing named test/<name>.test.mjs. The test writer writes it from the agent's files, and there is nothing to hand out without it.");
  const template = templateText ?? (() => {
    const at = templatePath ?? join(scriptsDir, "..", "references", TEMPLATE_FILE);
    return existsSync(at) ? readFileSync(at, "utf8") : "";
  })();
  if (!trim(template)) return refuse(`Nothing is laid out: the house rules template (references/${TEMPLATE_FILE}) is missing or empty, so no rules can be written into the folder.`);

  const dir = join(workDir, "build");
  rmSync(dir, { recursive: true, force: true });
  const laid = layOutBuildFolder({
    dir,
    agent: Object.fromEntries(Object.entries(agentFilesByPath(got.agent))),
    suite: got.suite,
    prototype: got.prototype,
    spec: got.spec,
    scriptsDir,
  });
  const lock = writeHouseRules(dir, { templateText: template, scripts: laid.scripts, spec: laid.spec });

  const archive = join(jobDir, "out", ARCHIVE_NAME);
  const packed = pack(dir, archive);
  // The archive has to unpack to what was laid out, byte for byte.
  const back = new Map(entriesIn(readFileSync(archive)).filter((e) => e.type === "file").map((e) => [e.path, sha(e.bytes)]));
  const there = listing(dir, { skip: ["records"] });
  const wrong = Object.entries(there).filter(([p, d]) => back.get(p) !== d).map(([p]) => p);
  if (wrong.length || back.size !== Object.keys(there).length) throw new Error(`the archive does not unpack to the folder: ${wrong.slice(0, 5).join(", ") || "file counts differ"}`);
  const archiveDigest = sha(readFileSync(archive));
  const specSaid = laid.spec.length ? `the spec (${laid.spec.map((f) => `\`${f}\``).join(" and ")}), ` : "";

  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify([{
    name: "the build folder", step: "pack-the-build-folder", path: `out/${ARCHIVE_NAME}`, media_type: "application/gzip",
    about: `One gzip tar archive holding the build folder: ${specSaid}the agent's files, \`test/\`, \`scripts/\`, the released package files, \`AGENTS.md\`, \`CLAUDE.md\`, \`.adlc/\` and \`build.lock.json\`.`,
    produced_from: [...(laid.spec.length ? ["the spec"] : []), "the agent's files", "the suite"],
  }], null, 2) + "\n");

  mkdirSync(recordsDir, { recursive: true });
  writeFileSync(join(recordsDir, "workspace.json"), JSON.stringify({
    workspace: "v1", at: new Date().toISOString(), folder: dir, from_attachments: true, build_folder: true,
    prototype_given: Object.keys(got.prototype).length > 0, prototype_found: Object.keys(got.prototype).length > 0,
    scripts: laid.scripts, prototype: laid.prototype, extras: laid.laid, stood_in: laid.stood_in, unnamed: laid.unnamed, spec: laid.spec,
    digests: lock.digests, listing: there, archive: { path: `out/${ARCHIVE_NAME}`, digest: archiveDigest, files: packed.files, bytes: packed.bytes },
  }, null, 2) + "\n");

  const stubbed = laid.scripts.filter((s) => s.from !== "prototype").length;
  const bits = [
    `Laid out the build folder and packed it as one gzip tar archive, ${plural(packed.files, "file")}, ${packed.bytes} bytes, ${archiveDigest}.`,
    `It holds ${plural(laid.scripts.length, "script")} to write (${laid.scripts.length - stubbed} released, ${stubbed} stubbed), ${plural(Object.keys(got.suite).filter((p) => p.endsWith(".test.mjs")).length, "test file")}, ${laid.spec.length ? `the spec (${laid.spec.join(" and ")}), which AGENTS.md says to read first, ` : ""}AGENTS.md, CLAUDE.md, .adlc/ and build.lock.json pinning ${plural(Object.keys(lock.digests).length, "file")}.`,
  ];
  if (laid.prototype.length) bits.push(`${plural(laid.prototype.length, "prototype file")} went under prototype/ to be read.`);
  if (!Object.keys(got.prototype).length) bits.push("No released package came, so every script is a stub.");
  if (laid.stood_in.length) bits.push(`${plural(laid.stood_in.length, "file")} the spec names came with nothing and stand in as empty: ${laid.stood_in.join(", ")}.`);
  if (laid.unnamed.length) bits.push(`The suite imports ${laid.unnamed.join(", ")}, which the spec never names.`);
  return { ok: true, code: 0, reply: bits.join(" "), archive: `out/${ARCHIVE_NAME}`, digest: archiveDigest, files: packed.files, scripts: laid.scripts.map((s) => s.path) };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const a = fromArgv(process.argv.slice(2));
  if (!a.job || !a.records || !a.work) { console.error("--job, --records and --work are required, with each --file <path>::<media type>"); process.exit(2); }
  if (!existsSync(a.job) || !statSync(a.job).isDirectory()) { console.error(`the job folder does not exist: ${a.job}`); process.exit(2); }
  try {
    const r = handoff({ jobDir: a.job, recordsDir: a.records, workDir: a.work, message: a.message || null, files: a.files.map((f) => ({ ...f, path: f.path })) });
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : r.code ?? 1);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
