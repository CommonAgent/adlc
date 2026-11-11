// The start of a build: the folder is laid out with the check, the
// instructions and the kit pinned; and every command the instructions name is
// one the kit answers.
//
//   node --test plugin/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { instructionsOf, start, update } from "../kit/start.mjs";
import { checkFolder } from "../kit/check.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = readFileSync(join(PLUGIN, "skills", "adlc", "SKILL.md"), "utf8");

test("a new build folder has the check, the instructions, and the kit pinned", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "adlc-start-")), "agent");
  try {
    assert.equal(start(dir).ok, true);
    assert.ok(existsSync(join(dir, ".adlc", "check.mjs")));
    assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8"), instructionsOf(SKILL));
    assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "@AGENTS.md\n");
    const lock = JSON.parse(readFileSync(join(dir, "build.lock.json"), "utf8"));
    assert.ok(Object.keys(lock.digests).every((p) => p.startsWith(".adlc/")));
    assert.ok(".adlc/stages.mjs" in lock.digests);
    assert.deepEqual(lock.gates, {});
    const r = await checkFolder(dir);
    assert.equal(r.stage, "requirements");
    assert.match(r.problems[0], /^spec\.json is not in the folder/);
    assert.equal(start(dir).ok, false);
    appendFileSync(join(dir, ".adlc", "packer.mjs"), "\n");
    assert.equal((await checkFolder(dir)).code, 3);
  } finally { rmSync(dirname(dir), { recursive: true, force: true }); }
});

test("updating a folder's kit replaces and re-pins it, and keeps every other pin and every stage passed", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "adlc-update-")), "agent");
  try {
    start(dir);
    const before = JSON.parse(readFileSync(join(dir, "build.lock.json"), "utf8"));
    before.digests["spec.json"] = "sha256:abc";
    before.gates = { requirements: { passed: true, by: "the person" } };
    writeFileSync(join(dir, "build.lock.json"), JSON.stringify(before));
    appendFileSync(join(dir, ".adlc", "packer.mjs"), "\n// an old kit\n");
    assert.equal(update(dir).ok, true);
    const after = JSON.parse(readFileSync(join(dir, "build.lock.json"), "utf8"));
    assert.equal(after.digests["spec.json"], "sha256:abc");
    assert.deepEqual(after.gates, before.gates);
    assert.doesNotMatch(readFileSync(join(dir, ".adlc", "packer.mjs"), "utf8"), /an old kit/);
    assert.notEqual(after.digests[".adlc/packer.mjs"], undefined);
    assert.equal(update(join(dir, "..", "nowhere")).ok, false);
  } finally { rmSync(dirname(dir), { recursive: true, force: true }); }
});

test("AGENTS.md is the skill's own text, without its front matter", () => {
  assert.ok(SKILL.startsWith("---\nname: adlc\n"));
  assert.ok(instructionsOf(SKILL).startsWith("# Building an agent through the ADLC\n"));
});

test("every command the instructions name is one the kit answers", () => {
  const generate = readFileSync(join(PLUGIN, "kit", "generate.mjs"), "utf8");
  for (const m of SKILL.matchAll(/node \.adlc\/generate\.mjs (\w+)/g)) assert.ok(generate.includes(`cmd === "${m[1]}"`), `generate.mjs ${m[1]}`);
  for (const m of SKILL.matchAll(/node \.adlc\/(\w+)\.mjs/g)) assert.ok(existsSync(join(PLUGIN, "kit", `${m[1]}.mjs`)), `${m[1]}.mjs`);
  const approve = readFileSync(join(PLUGIN, "kit", "approve.mjs"), "utf8");
  for (const m of SKILL.matchAll(/approve\.mjs (--[\w-]+)/g)) assert.ok(approve.includes(`"${m[1]}"`), m[1]);
  const startSkill = readFileSync(join(PLUGIN, "skills", "start", "SKILL.md"), "utf8");
  assert.match(startSkill, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/kit\/start\.mjs"/);
});
