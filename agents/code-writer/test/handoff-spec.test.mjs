// The hand-off carries the spec (code-writer 0.4.0).
//   node --test test/handoff-spec.test.mjs
//
// What is worth pinning. stages.json 1.6.0 gives the Code stage the spec
// (spec-v1), the agent's own files and the suite. Before 0.4.0 a spec that came
// with a hand-off was a loose file like any other, laid under prototype/, and
// AGENTS.md never said to read it: the exact words, patterns and kept
// interfaces it carried reached whoever wrote the scripts only by luck. So:
// - the spec comes as a --file like everything else and is found by content:
//   spec.json is the JSON whose format is spec-v1, spec.md its rendering,
//   named spec.md or carrying the product's name and every scenario's id;
// - both go at the build folder's top, byte for byte, read-only, and
//   build.lock.json pins them, so the fence keeps them unchanged: the local
//   check stops naming a changed spec, and an archive whose spec differs from
//   its lock is refused;
// - AGENTS.md says to read the spec first, for the requirements, the exact
//   words and patterns, the kept interfaces and the scenarios, then the
//   agent's files and the suite; with only spec.json it names spec.json;
// - a hand-off with no spec is laid out as before, its AGENTS.md the same.
// Nothing here touches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SPEC_END, SPEC_START, handoff, isSpecV1Text, looksLikeSpecMd, specAmong, withSpecPart } from "../scripts/handoff.mjs";
import { entriesIn, pack, unpack } from "../scripts/archive.mjs";
import { lockProblems } from "../scripts/workspace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "handoff.mjs");
const TEMPLATE = readFileSync(join(here, "..", "references", "agents-md-template.md"), "utf8");
const SPEC_JSON = readFileSync(join(here, "fixtures", "spec-v1", "points-reader.spec.json"));
const SPEC_MD = readFileSync(join(here, "fixtures", "spec-v1", "points-reader.spec.md"));

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-handoff-spec-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const AGENT_FILES = {
  "agent-descriptor.json": JSON.stringify({ format: "agent-descriptor-v1", agent_version: "1.0.0", offerings: [{ id: "read-points", name: "Read points", steps: [] }] }),
  "agent-runtime-requirements.json": JSON.stringify({ format: "agent-runtime-requirements-v1", runtimes: [{ name: "node", version: ">=22" }] }),
  "plugin.json": JSON.stringify({ name: "points-reader", version: "1.0.0", extensions: { "net.agentdoc.package": { build: { skills: { "read-points": { scripts: ["scripts/read.mjs"] } } } } } }),
  "skills/read-points/SKILL.md": "---\nname: read-points\n---\n## When to use this\nAlways.\n## What a good result looks like\nGood.\n## When it comes back empty\nEmpty.\n## How to do it\nRun node scripts/read.mjs\n",
};
const SUITE = {
  "test/read.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readPoints } from "../scripts/read.mjs";\ntest("[F1.A1] two titles are read", async () => { assert.equal((await readPoints("a\\n1 point")).total, 1); });\n',
};

/** One hand-off: the agent's files and the suite as they come, and any other
 *  loose files, under the names the process runner gives pieces. */
function handOff(at, extra = {}) {
  const dirs = { jobDir: join(at, "job"), recordsDir: join(at, "records"), workDir: join(at, "work") };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const inDir = join(at, "in");
  mkdirSync(inDir, { recursive: true });
  const files = [];
  const put = (name, bytes, declared) => { const p = join(inDir, `${files.length}-Ab12cdEF-${name}`); writeFileSync(p, bytes); files.push({ path: p, declared }); };
  for (const [k, v] of Object.entries(AGENT_FILES)) put(k.replace(/\//g, "-"), v, "application/json");
  const src = join(at, "suite-src");
  for (const [rel, text] of Object.entries(SUITE)) { mkdirSync(dirname(join(src, rel)), { recursive: true }); writeFileSync(join(src, rel), text); }
  pack(src, join(inDir, "suite.tar.gz"));
  files.push({ path: join(inDir, "suite.tar.gz"), declared: "application/gzip" });
  for (const [name, bytes] of Object.entries(extra)) put(name, bytes, name.endsWith("md") ? "text/markdown" : "application/json");
  const result = handoff({ ...dirs, files });
  const unpacked = join(at, "unpacked");
  if (result.ok) { mkdirSync(unpacked, { recursive: true }); unpack(join(dirs.jobDir, "out", "build-folder.tar.gz"), unpacked); }
  return { result, unpacked, ...dirs };
}

test("the spec is found by content: spec.json by its format, spec.md by its name or by carrying the product and every scenario id", () => {
  assert.equal(isSpecV1Text(SPEC_JSON.toString("utf8")), true);
  assert.equal(isSpecV1Text(JSON.stringify({ name: "x", jobs: [{ slug: "y" }] })), false, "the older spec.json is not it");
  assert.equal(isSpecV1Text(AGENT_FILES["agent-descriptor.json"]), false);
  const doc = JSON.parse(SPEC_JSON);
  assert.equal(looksLikeSpecMd(SPEC_MD.toString("utf8"), "1-Ab12cdEF-readable", doc), true, "by content");
  assert.equal(looksLikeSpecMd("# notes", "0-Ab12cdEF-spec.md", null), true, "by name");
  assert.equal(looksLikeSpecMd("# README\nF1.A1 only", "README.md", doc), false, "a README naming one scenario is not the spec");
  assert.equal(looksLikeSpecMd(AGENT_FILES["skills/read-points/SKILL.md"], "spec.md", doc), false, "a skill is never the spec");
  const found = specAmong([{ path: "a", bytes: Buffer.from("x") }, { path: "spec", bytes: SPEC_JSON }, { path: "b", bytes: SPEC_MD }]);
  assert.equal(found.json.path, "spec");
  assert.equal(found.md.path, "b");
  assert.deepEqual(specAmong([{ path: "a", bytes: Buffer.from("{}") }]), { json: null, md: null });
});

test("the spec goes at the build folder's top byte for byte, pinned by the lock, and never under prototype/", () => {
  folder((at) => {
    const { result, unpacked, recordsDir } = handOff(at, { spec: SPEC_JSON, "spec-readable": SPEC_MD });
    assert.equal(result.ok, true, result.reply);
    assert.deepEqual(readFileSync(join(unpacked, "spec.json")), SPEC_JSON);
    assert.deepEqual(readFileSync(join(unpacked, "spec.md")), SPEC_MD);
    assert.equal(existsSync(join(unpacked, "prototype")), false, "the spec is not a prototype file");
    const lock = JSON.parse(readFileSync(join(unpacked, "build.lock.json"), "utf8"));
    assert.ok(lock.digests["spec.json"] && lock.digests["spec.md"], "both pinned");
    assert.match(result.reply, /the spec \(spec\.json and spec\.md\), which AGENTS\.md says to read first/);
    assert.deepEqual(JSON.parse(readFileSync(join(recordsDir, "workspace.json"), "utf8")).spec, ["spec.json", "spec.md"]);
    const pieces = JSON.parse(readFileSync(join(at, "job", "pieces.json"), "utf8"));
    assert.match(pieces[0].about, /^One gzip tar archive holding the build folder: the spec \(`spec\.json` and `spec\.md`\), the agent's files/);
    assert.deepEqual(pieces[0].produced_from, ["the spec", "the agent's files", "the suite"]);
  });
});

test("AGENTS.md says to read the spec first: the requirements, the exact words and patterns, the kept interfaces and the scenarios, then the agent's files and the suite", () => {
  folder((at) => {
    const { unpacked } = handOff(at, { spec: SPEC_JSON, "spec-readable": SPEC_MD });
    const text = readFileSync(join(unpacked, "AGENTS.md"), "utf8");
    assert.ok(text.indexOf("## Read the spec first") > 0 && text.indexOf("## Read the spec first") < text.indexOf("## Where this folder is"));
    assert.match(text, /^spec\.md in this folder is the spec: what the agent must do, and how anyone can tell that it does\. spec\.json holds the same, as data\. Read it before anything else\./m);
    for (const w of ["requirements (F1.R1", "exact words, patterns and numbers", "byte for byte", "interfaces that must be kept (keep: true)", "acceptance scenarios (F1.A1", "Then read the agent's files and the suite", "never change it"]) assert.ok(text.includes(w), w);
    assert.doesNotMatch(text, /<!--|\{\{spec/);
  });
  folder((at) => {
    const { unpacked } = handOff(at, { spec: SPEC_JSON });
    const text = readFileSync(join(unpacked, "AGENTS.md"), "utf8");
    assert.match(text, /^spec\.json in this folder is the spec: what the agent must do, and how anyone can tell that it does\. Read it before anything else\./m);
    assert.equal(existsSync(join(unpacked, "spec.md")), false);
  });
});

test("a hand-off with no spec is laid out as before, its AGENTS.md without a word of the spec", () => {
  folder((at) => {
    const { result, unpacked, recordsDir } = handOff(at);
    assert.equal(result.ok, true, result.reply);
    assert.equal(existsSync(join(unpacked, "spec.json")), false);
    const text = readFileSync(join(unpacked, "AGENTS.md"), "utf8");
    assert.doesNotMatch(text, /Read the spec first|<!--|\{\{spec/);
    assert.match(text, /take your work back through the same checks you can run here\.\n\n## Where this folder is/);
    assert.doesNotMatch(result.reply, /the spec/);
    assert.deepEqual(JSON.parse(readFileSync(join(recordsDir, "workspace.json"), "utf8")).spec, []);
  });
  // The part comes out whole, and the template without it reads as it did.
  const without = withSpecPart(TEMPLATE, []);
  const at = TEMPLATE.indexOf(SPEC_START);
  const after = TEMPLATE.indexOf(SPEC_END) + SPEC_END.length;
  assert.equal(without, TEMPLATE.slice(0, at) + TEMPLATE.slice(after + 2));
});

test("the fence keeps the spec: a changed spec.json stops the local check by name, and an archive whose spec differs from its lock is refused", () => {
  folder((at) => {
    const { unpacked, jobDir } = handOff(at, { spec: SPEC_JSON, "spec-readable": SPEC_MD });
    const entries = entriesIn(readFileSync(join(jobDir, "out", "build-folder.tar.gz")));
    assert.deepEqual(lockProblems(entries), []);
    const tampered = entries.map((e) => (e.path === "spec.json" ? { ...e, bytes: Buffer.from(String(e.bytes).replace("at most 30", "at most 40")) } : e));
    assert.deepEqual(lockProblems(tampered), [{ path: "spec.json", what: "differs from its digest" }]);
    // The local check, run from the folder's .adlc/ as a coding agent runs it.
    writeFileSync(join(unpacked, "scripts", "read.mjs"), "export async function readPoints() { return { total: 1 }; }\n");
    rmSync(join(unpacked, "spec.json"), { force: true });
    writeFileSync(join(unpacked, "spec.json"), SPEC_JSON.toString("utf8").replace("at most 30", "at most 40"));
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_") || k === "WORKSPACE" || k === "RECORDS") delete env[k];
    const r = spawnSync(process.execPath, [join(unpacked, ".adlc", "check.mjs")], { cwd: unpacked, encoding: "utf8", env });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /spec\.json/);
    assert.doesNotMatch(r.stdout, /spec\.md/, "only what changed is named");
  });
});

test("as a process: the spec passed with --file like any other file reaches the build folder", () => {
  folder((at) => {
    const dirs = ["job", "records", "work", "in"].map((d) => join(at, d));
    for (const d of dirs) mkdirSync(d, { recursive: true });
    const [job, records, work, inDir] = dirs;
    const args = ["--job", job, "--records", records, "--work", work];
    const put = (name, bytes, media) => { writeFileSync(join(inDir, name), bytes); args.push("--file", `${join(inDir, name)}::${media}`); };
    for (const [k, v] of Object.entries(AGENT_FILES)) put(k.replace(/\//g, "-"), v, "application/json");
    put("read.test.mjs", SUITE["test/read.test.mjs"], "text/javascript");
    put("0-Ab12cdEF-spec", SPEC_JSON, "application/json");
    put("1-Ab12cdEF-spec.md", SPEC_MD, "text/markdown");
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const names = entriesIn(readFileSync(join(job, "out", "build-folder.tar.gz"))).map((e) => e.path);
    assert.ok(names.includes("spec.json") && names.includes("spec.md"), names.join(", "));
  });
});
