// The agent's own files, which is what the spec writer delivers since 0.3.0.
//   node --test test/agent-files.test.mjs
//
// What is pinned: among the files a message carried, the agent's own files
// (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and a
// SKILL.md per skill) are found by content under whatever names the hops gave
// them, laid out as the agent's folder under the job's records, preferred to
// a spec.json that came with them, and every step is handed the folder; the
// folder is read as the spec it states, the same spec a spec.json carried;
// and the stand-in package a suite runs in carries the agent's files, never
// a spec.json written from them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runJob } from "../scripts/job.mjs";
import { declaredOf } from "../scripts/declared.mjs";
import { standInPackage } from "../scripts/check-suite.mjs";
import { agentFilesAmong, loadSpec, specOfFolder } from "../scripts/agent-folder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLISHER = join(HERE, "..", "..", "publisher");

/** The publisher's own files, as attachments named the way pieces arrive. */
function attachments(dir) {
  const files = [];
  const put = (from, sent) => { const at = join(dir, `${files.length}-Ab12cdEF-${sent}`); cpSync(from, at); files.push({ path: at }); };
  put(join(PUBLISHER, "agent-descriptor.json"), "agent-descriptor.json");
  put(join(PUBLISHER, "agent-runtime-requirements.json"), "agent-runtime-requirements.json");
  put(join(PUBLISHER, "plugin.json"), "plugin.json");
  for (const slug of readdirSync(join(PUBLISHER, "skills"))) put(join(PUBLISHER, "skills", slug, "SKILL.md"), `${slug}.SKILL.md`);
  return files;
}

function fakeSpawn(ran) {
  return (bin, argv, opts) => {
    ran.push({ script: basename(argv[0]), env: opts.env });
    const a = basename(argv[0]) === "reply.mjs" ? { ok: true, code: 0, reply: "done" } : { ok: true, code: 0 };
    return { status: 0, stdout: `${JSON.stringify(a)}\n`, stderr: "" };
  };
}

test("the agent's files are found by content, laid out as its folder, preferred to a spec, and every step is handed the folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-writer-agent-files-"));
  try {
    const files = attachments(dir);
    const spec = join(dir, "9-Zz98yxWV-spec.json");
    writeFileSync(spec, JSON.stringify({ name: "other", version: "9.9.9", jobs: [{ slug: "x" }] }));
    const ran = [];
    const out = runJob({ job: join(dir, "job-1"), records: join(dir, "records"), work: join(dir, "work"), files: [{ path: spec }, ...files], spawn: fakeSpawn(ran) });
    assert.equal(out.ok, true, out.reply);
    const folder = join(dir, "records", "job-1", "agent");
    assert.equal(ran[0].env.SPEC, folder);
    for (const r of ran.slice(0, 3)) assert.equal(r.env.SPEC, folder, r.script);
    assert.equal(existsSync(join(folder, "agent-descriptor.json")), true);
    assert.equal(existsSync(join(folder, "skills", "publish", "SKILL.md")), true);
    assert.equal(loadSpec(folder).name, "publisher", "the spec that came with them was read instead");
    assert.equal(existsSync(join(folder, "spec.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the folder reads as the spec it states, with each job's four sentences out of its SKILL.md", () => {
  const spec = specOfFolder(PUBLISHER);
  assert.equal(spec.name, "publisher");
  const offered = spec.jobs.find((j) => j.offered);
  assert.deepEqual(offered.steps, ["read-what-was-given", "place-the-files", "check-what-is-served"]);
  for (const j of spec.jobs) {
    for (const k of ["when", "good", "empty"]) assert.ok(typeof j[k] === "string" && j[k].length > 10, `${j.slug}.${k}`);
  }
  assert.ok(spec.refuses.length >= 4);
  assert.ok(spec.records.length >= 1);
  const d = declaredOf(spec);
  assert.ok(d.scripts.length > 0);
  assert.ok(d.jobs.every((j) => j.when && j.good && j.empty), "a job lost its sentences on the way through the folder");
  // Found among attachments only when the three authored files are all there.
  const dir = mkdtempSync(join(tmpdir(), "test-writer-among-"));
  try {
    const files = attachments(dir);
    assert.ok(agentFilesAmong(files));
    assert.equal(agentFilesAmong(files.slice(1)), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the stand-in package carries the agent's files and no spec.json written from them", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-writer-standin-folder-"));
  try {
    const spec = loadSpec(PUBLISHER);
    const scripts = standInPackage(spec, dir, PUBLISHER);
    assert.ok(scripts.length > 0);
    assert.equal(existsSync(join(dir, "spec.json")), false);
    assert.equal(readFileSync(join(dir, "agent-descriptor.json"), "utf8"), readFileSync(join(PUBLISHER, "agent-descriptor.json"), "utf8"));
    assert.equal(existsSync(join(dir, "skills", "publish", "SKILL.md")), true);
    for (const s of scripts) assert.equal(readFileSync(join(dir, s), "utf8"), "", s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("as a process, declared.mjs reads the agent's folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-writer-declared-folder-"));
  try {
    const r = spawnSync(process.execPath, [join(HERE, "..", "scripts", "declared.mjs")], { env: { ...process.env, SPEC: PUBLISHER, RECORDS: dir }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const d = JSON.parse(readFileSync(join(dir, "declared.json"), "utf8"));
    assert.equal(d.name, "publisher");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("of two rounds, or a package that came as a prototype, the files that go together are chosen, and the rest stay attachments", async () => {
  const { agentFilesAmongTexts, skillSections } = await import("../scripts/agent-folder.mjs");
  const manifest = (version, skills) => JSON.stringify({ version, extensions: { "net.agentdoc.package": { build: { skills } } } });
  const desc = (v) => JSON.stringify({ format: "agent-descriptor-v1", agent_version: v, offerings: [{ id: "ab" }] });
  const rt = JSON.stringify({ format: "agent-runtime-requirements-v1" });
  const skill = (slug) => `---\nname: ${slug}\ndescription: x\n---\n`;
  const proto = JSON.stringify({ name: "theirs", version: "9.0.0", extensions: { "net.agentdoc.package": { descriptor: {} } } });
  const entries = [
    { key: "r1-desc", text: desc("0.1.0") }, { key: "r1-man", text: manifest("0.1.0", { ab: {}, old: {} }) }, { key: "r1-old", text: skill("old") },
    { key: "r2-desc", text: desc("0.2.0") }, { key: "r2-rt", text: rt }, { key: "r2-man", text: manifest("0.2.0", { ab: {} }) }, { key: "r2-ab", text: skill("ab") },
    { key: "proto-plugin", text: proto }, { key: "proto-skill", text: skill("theirs-skill") },
  ];
  const got = agentFilesAmongTexts(entries);
  assert.equal(got.manifest, "r2-man", "the prototype's plugin.json, with no build entry, was taken for the agent's");
  assert.equal(got.descriptor, "r2-desc");
  assert.deepEqual(got.skills, { ab: "r2-ab" }, "a skill the chosen manifest does not name rode along");
  assert.ok(!got.used.includes("proto-plugin") && !got.used.includes("proto-skill") && !got.used.includes("r1-old"));
  // A heading inside a job's own instructions is not taken for one of the builder's.
  const md = ["---", "name: ab", "description: w", "---", "", "# Ab", "", "Part of x. w", "", "## When to use this", "", "w", "",
    "## What a good result looks like", "", "g", "", "## When it comes back empty", "", "e", "", "## How to do it", "",
    "Step one.", "", "## When to use this", "", "not the when", "", "## Scripts", "", "Run these from this skill's folder; each one says what it needs at the top.", "", "- scripts/a.mjs", ""].join("\n");
  const s = skillSections(md);
  assert.equal(s["When to use this"], "w");
  assert.equal(s["How to do it"], "Step one.\n\n## When to use this\n\nnot the when");
});
