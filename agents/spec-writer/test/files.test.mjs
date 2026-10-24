// The agent's own files, written here without the builder.
//   node --test test/files.test.mjs
//
// This agent runs where the builder is not (its container is node and
// nothing else), so files.mjs writes the files the builder would. What is
// pinned is that they are the builder's, byte for byte: for every fixture,
// the files equal what the package maker's convert.py takes from the
// builder's own build of the same draft; every agent folder in this
// repository comes back as itself when read and written again; and a host
// with no builder still gets the files, said to be unchecked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { NOT_NAMED, agentFilesOf } from "../scripts/files.mjs";
import { checkBuilds, namedFiles, verdict } from "../scripts/builds.mjs";
import { specOfFolder } from "../../package-maker/agent-folder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONVERT = join(HERE, "..", "..", "package-maker", "convert.py");
const AGENTS = join(HERE, "..", "..");
const FIXTURES = readdirSync(join(HERE, "fixtures")).filter((f) => f.endsWith(".spec.json"));

/** What convert.py writes from the builder's build of a draft, with empty
 *  stand-ins for every file the draft names. */
function builderFiles(spec, dir) {
  const src = join(dir, "src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "draft.json"), JSON.stringify(spec, null, 2));
  for (const rel of namedFiles(spec)) { mkdirSync(dirname(join(src, rel)), { recursive: true }); writeFileSync(join(src, rel), ""); }
  const r = spawnSync("python3", [CONVERT, join(src, "draft.json"), join(dir, "agent")], { encoding: "utf8" });
  const said = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  assert.equal(said.ok, true, said.error);
  return said.wrote;
}

for (const f of FIXTURES) {
  test(`${f}: the files are the builder's own, byte for byte`, () => {
    const dir = mkdtempSync(join(tmpdir(), "spec-writer-files-"));
    try {
      const spec = JSON.parse(readFileSync(join(HERE, "fixtures", f), "utf8"));
      const wrote = builderFiles(spec, dir);
      const mine = agentFilesOf(spec);
      assert.deepEqual(Object.keys(mine).sort(), [...wrote].sort());
      for (const rel of wrote) assert.equal(mine[rel], readFileSync(join(dir, "agent", rel), "utf8"), rel);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("every agent folder here comes back as itself, read and written again", () => {
  const folders = readdirSync(AGENTS).map((n) => join(AGENTS, n))
    .filter((d) => existsSync(join(d, "agent-descriptor.json")) && existsSync(join(d, "plugin.json")));
  assert.ok(folders.length >= 5, "the agent folders are not where this test looks");
  for (const d of folders) {
    const mine = agentFilesOf(specOfFolder(d));
    for (const [rel, text] of Object.entries(mine)) {
      if (rel === "plugin.json") continue; // its keywords and author are the folder's own, not derived
      assert.equal(text, readFileSync(join(d, rel), "utf8").replace(/\r\n/g, "\n"), `${d}: ${rel}`);
    }
  }
});

test("a draft with no name gets files with no name, and each skill says it is part of an agent not named yet", () => {
  const spec = JSON.parse(readFileSync(join(HERE, "fixtures", "publisher.spec.json"), "utf8"));
  delete spec.name;
  const files = agentFilesOf(spec);
  assert.equal("name" in JSON.parse(files["plugin.json"]), false);
  for (const j of spec.jobs) assert.match(files[`skills/${j.slug}/SKILL.md`], new RegExp(`Part of ${NOT_NAMED}\\.`));
});

test("with no builder on the host the files are still kept, and said to be unchecked", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-nobuilder-"));
  try {
    const spec = JSON.parse(readFileSync(join(HERE, "fixtures", "publisher.spec.json"), "utf8"));
    const r = checkBuilds({ spec, env: { BUILD_PY: join(dir, "no-builder-here.py") }, keep: join(dir, "agent") });
    assert.equal(r.checked, false);
    assert.equal(r.ok, null);
    assert.deepEqual(r.files.list.map((f) => f.path), Object.keys(agentFilesOf(spec)));
    assert.equal(readFileSync(join(dir, "agent", "agent-descriptor.json"), "utf8"), agentFilesOf(spec)["agent-descriptor.json"]);
    assert.match(verdict(r), /nothing checked whether this draft builds/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
