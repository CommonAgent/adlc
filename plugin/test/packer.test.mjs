// The packer step: a build folder keeps its scripts once under scripts/, and the
// package must carry each skill's scripts inside the skill (2026-11-12: a
// package the check passed carried no code, and the installed agent failed
// every message with ERR_MODULE_NOT_FOUND).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importsOf, layOut, leftOut, pack } from "../kit/packer.mjs";

/** A build folder with one skill whose script imports a helper, which imports another. */
function folder() {
  const dir = mkdtempSync(join(tmpdir(), "adlc-packer-"));
  const at = join(dir, "time-zone-converter");
  mkdirSync(join(at, "skills", "convert"), { recursive: true });
  mkdirSync(join(at, "scripts", "lib"), { recursive: true });
  mkdirSync(join(at, "test"), { recursive: true });
  mkdirSync(join(at, ".adlc"), { recursive: true });
  writeFileSync(join(at, "plugin.json"), JSON.stringify({ name: "time-zone-converter", version: "0.1.0", extensions: { "net.agentdoc.package": { build: { skills: { convert: { scripts: ["scripts/convert.mjs"] } } } } } }));
  writeFileSync(join(at, "agent-descriptor.json"), "{}");
  writeFileSync(join(at, "agent-runtime-requirements.json"), "{}");
  writeFileSync(join(at, "skills", "convert", "SKILL.md"), "---\nname: convert\ndescription: x\n---\nRun scripts/convert.mjs with the job.\n");
  writeFileSync(join(at, "scripts", "convert.mjs"), 'import { zone } from "./lib/zone.mjs";\n// import "./not-really.mjs";\nexport const run = () => zone();\n');
  writeFileSync(join(at, "scripts", "lib", "zone.mjs"), 'import { tz } from "./tz.mjs";\nexport const zone = () => tz;\n');
  writeFileSync(join(at, "scripts", "lib", "tz.mjs"), "export const tz = 1;\n");
  writeFileSync(join(at, "scripts", "unused.mjs"), "export {};\n");
  writeFileSync(join(at, "test", "convert.test.mjs"), "");
  writeFileSync(join(at, ".adlc", "check.mjs"), "");
  return { dir, at };
}

/** Stands in for @common-agent/package packing a folder: like it, it carries
 *  the authored files and what is under skills/, and nothing else. */
const packerRule = (calls = []) => (cmd, args) => {
  const all = typeof cmd === "string" && !args?.length ? cmd.split(" ").map((a) => a.replace(/^"|"$/g, "")) : [cmd, ...args];
  calls.push(all);
  const src = all[all.indexOf("--out") - 1];
  const out = all[all.indexOf("--out") + 1];
  const name = JSON.parse(readFileSync(join(src, "plugin.json"), "utf8")).name;
  const pkg = join(out, name);
  mkdirSync(pkg, { recursive: true });
  for (const f of ["plugin.json", "agent-descriptor.json", "agent-runtime-requirements.json"]) cpSync(join(src, f), join(pkg, f));
  if (existsSync(join(src, "skills"))) cpSync(join(src, "skills"), join(pkg, "skills"), { recursive: true });
  return { status: 0, stdout: JSON.stringify({ ok: true, name, package_dir: pkg, tarball: join(out, `${name}-0.1.0.tar.gz`), sha256: "ab" }), stderr: "" };
};

test("a script's imports are followed inside scripts/, and a commented import is not one", () => {
  const { dir, at } = folder();
  try {
    assert.deepEqual(importsOf(at, "scripts/convert.mjs").sort(), ["scripts/lib/tz.mjs", "scripts/lib/zone.mjs"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the folder is laid out with each skill's scripts and their imports inside the skill, and nothing of the build", () => {
  const { dir, at } = folder();
  try {
    const into = layOut(at, join(dir, "laid"));
    assert.ok(existsSync(join(into, "skills", "convert", "scripts", "convert.mjs")));
    assert.ok(existsSync(join(into, "skills", "convert", "scripts", "lib", "zone.mjs")));
    assert.ok(existsSync(join(into, "skills", "convert", "scripts", "lib", "tz.mjs")));
    assert.ok(!existsSync(join(into, "skills", "convert", "scripts", "unused.mjs")), "a script no skill names or imports is not carried");
    for (const gone of ["test", ".adlc"]) assert.ok(!readdirSync(into).includes(gone), `${gone}/ is the build's, not the package's`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the package the check passes carries the skill's scripts, and stays where --out says", () => {
  const { dir, at } = folder();
  try {
    const out = join(dir, "dist");
    const r = pack(at, { spawn: packerRule(), env: {}, out });
    assert.equal(r.ok, true, r.refused);
    assert.equal(r.package_dir, join(out, "time-zone-converter"));
    assert.ok(existsSync(join(out, "time-zone-converter", "skills", "convert", "scripts", "convert.mjs")));
    assert.ok(existsSync(join(out, "time-zone-converter", "skills", "convert", "scripts", "lib", "tz.mjs")));
    assert.ok(existsSync(join(at, "scripts", "convert.mjs")), "the build folder itself is not changed");
    assert.ok(!existsSync(join(at, "skills", "convert", "scripts")), "the build folder itself is not changed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a package that leaves out a skill's script is refused, naming the file", () => {
  const { dir, at } = folder();
  try {
    // A packer that drops the skill's scripts, as packing the raw folder did.
    const drops = (cmd, args) => {
      const r = packerRule()(cmd, args);
      const pkg = JSON.parse(r.stdout).package_dir;
      rmSync(join(pkg, "skills", "convert", "scripts"), { recursive: true, force: true });
      return r;
    };
    const r = pack(at, { spawn: drops, env: {} });
    assert.equal(r.ok, false);
    assert.match(r.refused, /leaves out skills\/convert\/scripts\/convert\.mjs, which plugin\.json names for the skill/);
    assert.deepEqual(leftOut(at, join(dir, "nowhere")), ["skills/convert/scripts/convert.mjs"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("without --out the package is packed in a temporary folder and nothing is left behind", () => {
  const { dir, at } = folder();
  try {
    const calls = [];
    const r = pack(at, { spawn: packerRule(calls), env: {} });
    assert.equal(r.ok, true, r.refused);
    assert.equal(r.package_dir, undefined);
    const all = calls[0];
    assert.ok(!existsSync(all[all.indexOf("--out") + 1]), "the temporary package is removed");
    assert.ok(!existsSync(all[all.indexOf("--out") - 1]), "the laid-out copy is removed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
