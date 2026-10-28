// The job as the runtime requirements start it: node, the run command's own
// arguments with the host's placeholders filled in, a job folder holding
// message.txt, and the attached files passed the way per_file says. The
// package is laid out the way the builder lays it out (each skill's scripts
// and references from plugin.json under skills/<slug>/), so a script missing
// from plugin.json fails here and not on a host.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(AGENT, "test", "fixtures");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const RUN = json(join(AGENT, "agent-runtime-requirements.json")).run["document-a-package"];
const PLUGIN = json(join(AGENT, "plugin.json"));
const DESCRIPTOR = json(join(AGENT, "agent-descriptor.json"));

function host() {
  const root = mkdtempSync(join(tmpdir(), "doc-writer-"));
  const pkg = "doc-writer";
  const skills = PLUGIN.extensions["net.agentdoc.package"].build.skills;
  for (const [slug, { scripts = [], references = [] }] of Object.entries(skills)) {
    for (const s of [...scripts, ...references]) {
      const to = join(root, "home", pkg, "skills", slug, s);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(AGENT, s)));
    }
  }
  const records = join(root, "records");
  const work = join(root, "work");
  mkdirSync(records, { recursive: true });
  mkdirSync(work, { recursive: true });
  return { root, home: join(root, "home"), pkg, records, work };
}

function run(h, { id = "job-1", message = "", files = [] } = {}) {
  const jobDir = join(h.root, "jobs", id);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, "message.txt"), message);
  const fill = (s, more = {}) => s
    .replaceAll("{home}", h.home).replaceAll("{package}", h.pkg)
    .replaceAll("{job_dir}", jobDir).replaceAll("{records}", h.records).replaceAll("{work}", h.work)
    .replaceAll("{file_path}", more.path ?? "").replaceAll("{file_media_type}", more.type ?? "");
  const argv = RUN.command.map((s) => fill(s));
  for (const f of files) {
    const at = join(h.root, "attached", f.name);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, f.text ?? readFileSync(join(FIX, f.name)));
    for (const s of RUN.per_file) argv.push(fill(s, { path: at, type: f.type ?? "application/json" }));
  }
  const [cmd, ...args] = argv;
  assert.equal(cmd, "node");
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  let doc;
  assert.doesNotThrow(() => { doc = JSON.parse(r.stdout.trim()); }, `stdout is one JSON object, got: ${r.stdout}\n${r.stderr}`);
  return { status: r.status, doc, jobDir, recordsDir: join(h.records, id) };
}

test("the run command documents quiz-maker, files both pieces, and replies", () => {
  const h = host();
  const r = run(h, {
    message: "Please document quiz-maker.",
    files: [{ name: "quiz-maker.agent-descriptor.json" }, { name: "quiz-maker.agentdoc.json" }, { name: "quiz-maker.agent-runtime-requirements.json" }, { name: "quiz-maker.record.json" }],
  });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  assert.match(r.doc.reply, /^This job went ahead without a verdict/);
  assert.match(r.doc.reply, /quiz-maker\.platform@agentmesh\.ai 0\.6\.0 from 4 sources/);
  const pieces = json(join(r.jobDir, "pieces.json"));
  assert.deepEqual(pieces.map((p) => [p.name, p.step, p.media_type]), [
    ["documentation", "write-the-documentation", "text/markdown"],
    ["trace", "check-every-line", "application/vnd.agentmesh.doc-trace+json"],
  ]);
  for (const p of pieces) assert.ok(existsSync(join(r.jobDir, p.path)), p.path);
  const doc = readFileSync(join(r.jobDir, "out", "documentation.md"), "utf8");
  assert.match(doc, /^# quiz-maker\n/);
  const trace = json(join(r.jobDir, "out", "trace.json"));
  assert.equal(trace.ok, true);
  assert.equal(trace.lines.length, r.doc.lines);
  for (const f of ["given.json", "documentation.md", "check.json", "went-without.json"]) assert.ok(existsSync(join(r.recordsDir, f)), f);
});

test("with neither a descriptor nor an AgentDoc it writes nothing and asks for one", () => {
  const h = host();
  const r = run(h, { files: [{ name: "quiz-maker.record.json" }] });
  assert.equal(r.status, 3);
  assert.match(r.doc.reply, /I need its agent descriptor or its AgentDoc\. I was given 1 file and none of them is either\./);
  assert.equal(existsSync(join(r.jobDir, "pieces.json")), false);
});

test("the pieces it files are the outputs the descriptor declares, with the declared kinds", () => {
  const h = host();
  const r = run(h, { files: [{ name: "quiz-maker.agent-descriptor.json" }] });
  assert.equal(r.status, 0);
  const declared = DESCRIPTOR.offerings[0].outputs.map((o) => [o.name, o.kind]);
  const filed = json(join(r.jobDir, "pieces.json")).map((p) => [p.name, p.media_type]);
  assert.deepEqual(filed, declared);
});

test("a job folder used again keeps nothing from an earlier run that delivered", () => {
  const h = host();
  const first = run(h, { id: "again", files: [{ name: "quiz-maker.agent-descriptor.json" }] });
  assert.equal(first.status, 0);
  assert.ok(existsSync(join(first.jobDir, "pieces.json")));
  const second = run(h, { id: "again", files: [{ name: "quiz-maker.record.json" }] });
  assert.equal(second.status, 3);
  assert.equal(existsSync(join(second.jobDir, "pieces.json")), false);
  assert.equal(existsSync(join(second.jobDir, "out", "documentation.md")), false);
});

test("files staged by the host are named and matched by the name they were sent under", () => {
  const h = host();
  const quiz = JSON.stringify({ quiz: "v1", title: "t" });
  const r = run(h, { files: [{ name: "1-AbC_d-9x-quiz-maker.agent-descriptor.json", text: readFileSync(join(FIX, "quiz-maker.agent-descriptor.json")) }, { name: "2-3_FDPteg-quiz.json", text: quiz }] });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  const doc = readFileSync(join(r.jobDir, "out", "documentation.md"), "utf8");
  assert.match(doc, /^From `quiz\.json`: \[S2: json L1-L4\]$/m);
  assert.match(doc, /^- `quiz\.json` is the record declared as: the quiz per job as delivered\. \[S1: records\[3\]\]$/m);
  assert.match(doc, /^- S1: `quiz-maker\.agent-descriptor\.json`, the agent descriptor/m);
});

test("every staged prefix is taken off, and the inventory keeps the staged name", () => {
  const h = host();
  const quiz = JSON.stringify({ quiz: "v1", title: "t" });
  const r = run(h, { id: "hops", files: [{ name: "1-AbC_d-9x-agent-descriptor.json", text: readFileSync(join(FIX, "quiz-maker.agent-descriptor.json")) }, { name: "6-WTvYlXog-0-abcdefgh-quiz.json", text: quiz }] });
  assert.equal(r.status, 0, JSON.stringify(r.doc));
  const doc = readFileSync(join(r.jobDir, "out", "documentation.md"), "utf8");
  assert.match(doc, /^From `quiz\.json`: \[S2: json L1-L4\]$/m);
  const given = json(join(r.recordsDir, "given.json"));
  assert.deepEqual(given.sources.map((s) => [s.file, s.staged_as]), [["agent-descriptor.json", "1-AbC_d-9x-agent-descriptor.json"], ["quiz.json", "6-WTvYlXog-0-abcdefgh-quiz.json"]]);
});
