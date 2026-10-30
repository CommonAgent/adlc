// Hand the code step out: lay out a build folder for whoever writes the
// scripts, write the house rules into it, and pack it as one gzip tar archive.
//
// The person or coding agent who takes the folder needs everything in one
// place and needs to know what they may not touch. So the folder holds the
// agent's files as they came, the suite under test/ byte for byte (binary
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

/** What `check.mjs` needs beside it in .adlc/, so the folder checks itself. */
export const ADLC_FILES = ["check.mjs", "workspace.mjs", "agent-folder.mjs", "archive.mjs"];
export const TEMPLATE_FILE = "agents-md-template.md";
export const ARCHIVE_NAME = "build-folder.tar.gz";

/** The command line: --job, --records, --work and any number of --file
 *  <path>::<media type>. */
export function fromArgv(argv = []) {
  const out = { job: "", records: "", work: "", files: [] };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let value;
    const eq = /^(--[a-z]+)=(.*)$/.exec(flag);
    if (eq) { flag = eq[1]; value = eq[2]; } else value = argv[i + 1];
    if (!["--job", "--records", "--work", "--file"].includes(flag)) continue;
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
  || p.startsWith(".adlc/") || [DESCRIPTOR_FILE, RUNTIME_FILE, MANIFEST_FILE, "spec.json", "AGENTS.md", "CLAUDE.md", LOCK_FILE].includes(p);

/** Lay out the build folder in `dir`. `agent`, `suite` and `prototype` are
 *  maps from a path to its bytes (or text). Returns what was laid out. */
export function layOutBuildFolder({ dir, agent = {}, suite = {}, prototype = {}, scriptsDir = here } = {}) {
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
    put(join(".adlc", f), readFileSync(from), false);
  }
  return { scripts, prototype: prototypeFiles, laid, stood_in: stoodIn, unnamed: [...wanted.keys()].filter((s) => !scriptsOf(spec).includes(s)) };
}

/** The lock: the digest of every pinned file, which is every file outside
 *  scripts/ except the lock itself and records/, and the scripts the folder
 *  started with. */
export function buildLock(dir, { scripts = [] } = {}) {
  const found = listing(dir, { skip: ["scripts", "records", LOCK_FILE] });
  const digests = Object.fromEntries(Object.entries(found).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { build_lock: "v1", digests, scripts };
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** AGENTS.md from the template, CLAUDE.md pointing to it, and build.lock.json.
 *  {{name}}, {{version}} and {{scripts}} in the template are filled in when
 *  the folder holds an agent to say them about. */
export function writeHouseRules(dir, { templateText = "", scripts = [] } = {}) {
  if (!trim(templateText)) throw new Error("the house rules template is missing, so no rules can be written");
  const plugin = readJson(join(dir, MANIFEST_FILE));
  const descriptor = readJson(join(dir, DESCRIPTOR_FILE));
  const name = trim(plugin?.name ?? descriptor?.name);
  const version = trim(plugin?.version ?? descriptor?.agent_version);
  const named = scripts.length ? scripts.map((s) => s.path) : Object.keys(listing(join(dir, "scripts"))).map((r) => `scripts/${r}`);
  const list = scripts.length
    ? scripts.map((s) => `- ${s.path} (${s.from === "prototype" ? "the released script" : "a stub"})`).join("\n")
    : named.map((p) => `- ${p}`).join("\n");
  let text = String(templateText);
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
  for (const f of sorted.code) if (!(f.path in prototype)) prototype[f.path] = f.bytes;
  return { agent: sorted.agent, suite, prototype };
}

/** The whole job: sort, lay out, write the rules, pack, file the piece.
 *  `read` and the template are handed in by tests. */
export function handoff({ jobDir, recordsDir, workDir, files = [], templateText = null, templatePath = null, scriptsDir = here, read = (p) => readFileSync(p) } = {}) {
  if (!jobDir || !recordsDir || !workDir) throw new Error("--job, --records and --work are required");
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
    scriptsDir,
  });
  const lock = writeHouseRules(dir, { templateText: template, scripts: laid.scripts });

  const archive = join(jobDir, "out", ARCHIVE_NAME);
  const packed = pack(dir, archive);
  // The archive has to unpack to what was laid out, byte for byte.
  const back = new Map(entriesIn(readFileSync(archive)).filter((e) => e.type === "file").map((e) => [e.path, sha(e.bytes)]));
  const there = listing(dir, { skip: ["records"] });
  const wrong = Object.entries(there).filter(([p, d]) => back.get(p) !== d).map(([p]) => p);
  if (wrong.length || back.size !== Object.keys(there).length) throw new Error(`the archive does not unpack to the folder: ${wrong.slice(0, 5).join(", ") || "file counts differ"}`);
  const archiveDigest = sha(readFileSync(archive));

  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify([{
    name: "the build folder", step: "pack-the-build-folder", path: `out/${ARCHIVE_NAME}`, media_type: "application/gzip",
    about: "One gzip tar archive holding the build folder: the agent's files, `test/`, `scripts/`, the released package files, `AGENTS.md`, `CLAUDE.md`, `.adlc/` and `build.lock.json`.",
    produced_from: ["the agent's files", "the suite"],
  }], null, 2) + "\n");

  mkdirSync(recordsDir, { recursive: true });
  writeFileSync(join(recordsDir, "workspace.json"), JSON.stringify({
    workspace: "v1", at: new Date().toISOString(), folder: dir, from_attachments: true, build_folder: true,
    prototype_given: Object.keys(got.prototype).length > 0, prototype_found: Object.keys(got.prototype).length > 0,
    scripts: laid.scripts, prototype: laid.prototype, extras: laid.laid, stood_in: laid.stood_in, unnamed: laid.unnamed,
    digests: lock.digests, listing: there, archive: { path: `out/${ARCHIVE_NAME}`, digest: archiveDigest, files: packed.files, bytes: packed.bytes },
  }, null, 2) + "\n");

  const stubbed = laid.scripts.filter((s) => s.from !== "prototype").length;
  const bits = [
    `Laid out the build folder and packed it as one gzip tar archive, ${plural(packed.files, "file")}, ${packed.bytes} bytes, ${archiveDigest}.`,
    `It holds ${plural(laid.scripts.length, "script")} to write (${laid.scripts.length - stubbed} released, ${stubbed} stubbed), ${plural(Object.keys(got.suite).filter((p) => p.endsWith(".test.mjs")).length, "test file")}, AGENTS.md, CLAUDE.md, .adlc/ and build.lock.json pinning ${plural(Object.keys(lock.digests).length, "file")}.`,
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
    const r = handoff({ jobDir: a.job, recordsDir: a.records, workDir: a.work, files: a.files.map((f) => ({ ...f, path: f.path })) });
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : r.code ?? 1);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
