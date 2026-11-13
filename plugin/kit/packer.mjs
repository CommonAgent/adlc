// The packer: Common Agent's own program for whether a folder is a package
// (@common-agent/package, Common Agent Section 12). The check runs it on the
// agent's files and quotes its refusal in its own words.
//
// The version is the one pinned here, the version that implements the Common
// Agent version the lifecycle pins (common-agent-pin.json). ADLC_PACK names
// another command to run in its place, such as a packer built from source
// before that version is published; it is the whole command, and the folder
// and the flags are added after it.
//
// WHERE A SKILL'S SCRIPTS GO. The build folder keeps each script once, under
// scripts/, where the tests import it from. A package carries a skill's files
// inside the skill, under skills/<slug>/scripts/ (and references/, assets/),
// and the packer, packing a folder, carries only what is under skills/. So the
// folder is laid out first, the way adlc's reference builder does it
// (agents/package-maker/build.py, script_imports): every file plugin.json's
// build entry names for a skill, and every script those import, is copied into
// that skill, and the copy is packed. Then the package is read back, and a
// skill file it does not carry is a refusal: a package the check passes must
// run (2026-11-12: one the packer accepted carried no code at all, and every
// message to the installed agent failed).
//
//   node .adlc/packer.mjs --out <folder>   write the package into <folder>
//
//   needs: node >= 22
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKER = { package: "@common-agent/package", version: "0.2.0", bin: "common-agent-pack", common_agent: "0.41.0" };
export const PACK_SECONDS = 180;
const EXT = "net.agentdoc.package";
const KINDS = ["scripts", "references", "assets"];
/** What a build folder holds that is never part of a package. */
const NOT_PACKED = new Set([".adlc", ".git", "test", "records", "dist", "node_modules", "prototype"]);

/** The command, as [program, ...args], before the folder. */
export function packCommand(env = process.env) {
  const own = String(env.ADLC_PACK ?? "").trim();
  if (own) return { cmd: own, args: [], shell: true };
  return { cmd: "npx", args: ["-y", "-p", `${PACKER.package}@${PACKER.version}`, PACKER.bin], shell: process.platform === "win32" };
}

/** The files each skill carries, from plugin.json's build entry:
 *  { slug: [{ kind, from, to }] }, `from` in the build folder, `to` inside the skill. */
export function skillFiles(dir) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8")); } catch { return {}; }
  const skills = manifest?.extensions?.[EXT]?.build?.skills ?? {};
  const out = {};
  for (const [slug, files] of Object.entries(skills)) {
    out[slug] = [];
    for (const kind of KINDS) for (const rel of files?.[kind] ?? []) out[slug].push({ kind, from: String(rel), to: `${kind}/${basename(String(rel).replace(/[\\/]+$/, ""))}` });
  }
  return out;
}

// A relative import in a script: import ... from "./x.mjs", import "./x.mjs",
// import("./x.mjs"), require("./x.mjs"). Comments are not read as imports.
const IMPORTS = [/\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g, /\bimport\s*["'](\.{1,2}\/[^"']+)["']/g, /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g, /\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g];
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/** The scripts a script imports, followed transitively, as paths under the
 *  build folder's scripts/ (only imports that stay inside scripts/ are followed;
 *  anything else is the script's own business and the suite's to catch). */
export function importsOf(dir, rel) {
  const root = resolve(dir, "scripts");
  const seen = new Set();
  const queue = [rel];
  const found = [];
  while (queue.length) {
    const at = queue.shift();
    if (seen.has(at)) continue;
    seen.add(at);
    const file = resolve(dir, at);
    if (!existsSync(file) || !statSync(file).isFile() || !/\.(m?js|cjs)$/.test(file)) continue;
    const code = codeOnly(readFileSync(file, "utf8"));
    for (const rx of IMPORTS) for (const m of code.matchAll(rx)) {
      const within = relative(root, resolve(dirname(file), m[1].split(/[?#]/)[0]));
      if (!within || within.startsWith("..") || isAbsolute(within)) continue;
      const inside = posix.join("scripts", within.split(sep).join("/"));
      if (!seen.has(inside)) { queue.push(inside); if (inside !== rel) found.push(inside); }
    }
  }
  return [...new Set(found)];
}

/** Lay the build folder out as the packer reads a package's source: the
 *  folder's own files, with each skill's named files and the scripts they
 *  import copied into that skill. Returns the folder it wrote. */
export function layOut(dir, into) {
  mkdirSync(into, { recursive: true });
  for (const name of readdirSync(dir)) if (!NOT_PACKED.has(name)) cpSync(join(dir, name), join(into, name), { recursive: true });
  for (const [slug, files] of Object.entries(skillFiles(dir))) {
    const skill = join(into, "skills", slug);
    for (const f of files) {
      const src = join(dir, f.from);
      if (!existsSync(src)) continue; // the packer's own check names a missing skill file
      cpSync(src, join(skill, f.to), { recursive: true });
      if (f.kind !== "scripts") continue;
      for (const imp of importsOf(dir, f.from)) {
        const to = join(skill, "scripts", imp.slice("scripts/".length));
        if (!existsSync(to)) { mkdirSync(dirname(to), { recursive: true }); cpSync(join(dir, imp), to); }
      }
    }
  }
  return into;
}

/** The skill files plugin.json names that the package in `pkgDir` does not carry. */
export function leftOut(dir, pkgDir) {
  const missing = [];
  for (const [slug, files] of Object.entries(skillFiles(dir))) for (const f of files) {
    if (!existsSync(join(pkgDir, "skills", slug, f.to))) missing.push(`skills/${slug}/${f.to}`);
  }
  return missing;
}

/** Run the packer on a folder, laid out first: { ok, refused, warnings, ran,
 *  package_dir } where `ran` is false when the packer itself could not be run.
 *  With `out`, the package stays there; otherwise it is packed in a
 *  temporary folder and removed. */
export function pack(dir, { env = process.env, spawn = spawnSync, out = null } = {}) {
  const work = mkdtempSync(join(tmpdir(), "adlc-pack-"));
  const into = out ? resolve(out) : join(work, "out");
  try {
    const source = layOut(dir, join(work, basename(resolve(dir))));
    mkdirSync(into, { recursive: true });
    const { cmd, args, shell } = packCommand(env);
    const all = [...args, source, "--out", into, "--json"];
    // Through a shell the command is one line, each argument quoted.
    const r = shell
      ? spawn([cmd, ...all.map((a) => `"${a}"`)].join(" "), { encoding: "utf8", shell: true, timeout: PACK_SECONDS * 1000 })
      : spawn(cmd, all, { encoding: "utf8", timeout: PACK_SECONDS * 1000 });
    const text = String(r.stdout ?? "");
    const start = text.indexOf("{");
    let doc = null;
    try { doc = start >= 0 ? JSON.parse(text.slice(start)) : null; } catch { doc = null; }
    if (!doc) return { ok: false, ran: false, refused: `the packer could not be run (${cmd}${args.length ? ` ${args.join(" ")}` : ""}): ${String(r.stderr || r.error?.message || text).trim().split("\n").slice(-3).join(" ")}`, warnings: [] };
    if (doc.ok !== true) return { ok: false, ran: true, refused: String(doc.refused ?? "it refused the folder"), warnings: doc.warnings ?? [] };
    const pkgDir = doc.package_dir ? resolve(String(doc.package_dir)) : join(into, String(doc.name ?? ""));
    const missing = leftOut(dir, pkgDir);
    if (missing.length) return { ok: false, ran: true, refused: `the package it made leaves out ${missing.join(", ")}, which plugin.json names for the skill; an installed agent could not run it`, warnings: doc.warnings ?? [] };
    return { ok: true, ran: true, refused: null, warnings: doc.warnings ?? [], ...(out ? { package_dir: pkgDir, tarball: doc.tarball ?? null, sha256: doc.sha256 ?? null } : {}) };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--out");
  const out = at > 0 ? process.argv[at + 1] : null;
  if (!out) { console.error("Give --out <folder>: where the package is written."); process.exit(2); }
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const r = pack(dir, { out });
  if (!r.ok) { console.error(`Not packed: ${r.refused}`); process.exit(1); }
  console.log(`The package is in ${r.package_dir}${r.tarball ? `, and its archive is ${r.tarball}` : ""}${r.sha256 ? ` (sha256 ${r.sha256})` : ""}.`);
}
