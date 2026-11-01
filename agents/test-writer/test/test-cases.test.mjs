// The write-test-cases offering (scripts/test-cases.mjs): Agent Processes
// 0.9.0 §21 test cases written for a process document, each named and pinned
// to the document's digest, and held to the coverage check before they go.
//
// What is worth pinning: the model drafts the cases and code writes them, so
// every case names the document's id and its exact digest; the coverage check
// (check-cases.mjs) runs before anything is handed back, what it finds goes
// back to the model once and never a third time, and a suite still short of
// the rule after that is delivered with the shortfall said first; a message
// with no process document wakes no model; the job command sends a process
// document here and an agent's files to the suite writer; and the checker the
// package carries is standards/process-check.mjs byte for byte.
//
// Nothing here touches a network or a model: the model is a function handed in.
//   node --test test/test-cases.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeCases, renderCase, readCases, promptFor, REPLY_MAX, CASE_KIND } from "../scripts/test-cases.mjs";
import { parseCase, checkCases } from "../scripts/check-cases.mjs";
import { digestOf } from "../scripts/process-check.mjs";
import { runJob, processAmong } from "../scripts/job.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIX = join(HERE, "fixtures", "cases");
const DOC = readFileSync(join(FIX, "explore.process.txt"), "utf8");
const ANSWER = JSON.parse(readFileSync(join(FIX, "explore.answer.json"), "utf8"));
const DESC = JSON.parse(readFileSync(join(ROOT, "agent-descriptor.json"), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));

function dirs() {
  const at = mkdtempSync(join(tmpdir(), "test-writer-cases-"));
  const d = { at, records: join(at, "records"), work: join(at, "work"), job: join(at, "job") };
  for (const k of ["records", "work", "job"]) mkdirSync(d[k], { recursive: true });
  return d;
}
function model(...answers) {
  const prompts = [];
  const ask = async (prompt) => {
    prompts.push(prompt);
    const a = answers[Math.min(prompts.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { text: typeof a === "string" ? a : JSON.stringify(a), answered_by: "test-model", tokens_in: 1, tokens_out: 2 };
  };
  return { ask, prompts };
}

test("a case is written in §21's form, named and pinned to the document's digest, and reads back as itself", () => {
  const { cases } = readCases(clone(ANSWER));
  const text = renderCase(cases[2], { id: "research/explore-a-topic", digest: digestOf(DOC) });
  assert.match(text, /^TEST: wrong-angles +for: research\/explore-a-topic\n +digest: sha256:[0-9a-f]{64}\n/);
  assert.match(text, /^answer: approve-the-cards = changes: \[wrong-angles\] the angles miss/m);
  assert.match(text, /^stand-in: publish-the-cards = /m);
  assert.match(text, /^expect: goal reached$/m);
  const back = parseCase(text);
  assert.deepEqual(back.problems, []);
  assert.equal(back.digest, digestOf(DOC));
  assert.equal(back.answers[1].deviation, "wrong-angles");
});

test("the prompt carries the document, what the suite must cover, and the rule", () => {
  const p = promptFor({ doc: DOC });
  assert.match(p, /DOCUMENT START\nPROCESS: explore a topic/);
  assert.match(p, /approve-the-cards/);
  assert.match(p, /approve, changes and reject/);
  assert.match(p, /\[no-sources\]/);
  assert.match(p, /stand-in/i);
});

test("good cases are written, checked, and filed as pieces, with what they cover", async () => {
  const d = dirs();
  const m = model(ANSWER);
  const out = await writeCases({ processText: DOC, records: d.records, work: d.work, jobDir: d.job, ask: m.ask });
  assert.equal(out.code, 0, out.reply);
  assert.equal(m.prompts.length, 1);
  const pieces = JSON.parse(readFileSync(join(d.job, "pieces.json"), "utf8"));
  const cases = pieces.filter((p) => p.media_type === CASE_KIND);
  assert.equal(cases.length, 6);
  for (const p of cases) {
    const text = readFileSync(join(d.job, p.path), "utf8");
    assert.equal(parseCase(text).digest, digestOf(DOC));
    assert.match(p.path, /^out\/cases\/[a-z0-9-]+\.test\.txt$/);
  }
  const all = cases.map((p) => ({ file: basename(p.path), text: readFileSync(join(d.job, p.path), "utf8") }));
  assert.equal(checkCases(DOC, all).ok, true);
  const cover = pieces.find((p) => p.name === "what the test cases cover");
  assert.ok(cover);
  assert.match(readFileSync(join(d.job, cover.path), "utf8"), /^# What the test cases cover/);
  assert.match(out.reply, /6 test cases/);
  assert.match(out.reply, /covers/i);
  assert.ok(out.reply.length <= REPLY_MAX);
  for (const f of ["cases.json", "cases-checked.json", "calls.json", "went-without.json"]) assert.ok(existsSync(join(d.records, f)), f);
});

test("cases short of the rule go back to the model once, with what is missing", async () => {
  const d = dirs();
  const short = clone(ANSWER);
  short.cases = short.cases.filter((c) => c.name !== "no-sources" && c.name !== "cards-rejected");
  const m = model(short, ANSWER);
  const out = await writeCases({ processText: DOC, records: d.records, work: d.work, jobDir: d.job, ask: m.ask });
  assert.equal(out.code, 0, out.reply);
  assert.equal(m.prompts.length, 2);
  assert.match(m.prompts[1], /no-sources/);
  assert.match(m.prompts[1], /reject/);
  assert.equal(JSON.parse(readFileSync(join(d.records, "cases-checked.json"), "utf8")).ok, true);
});

test("cases still short after the second go are delivered with the shortfall said first, never a third call", async () => {
  const d = dirs();
  const short = clone(ANSWER);
  short.cases = short.cases.filter((c) => c.name !== "no-sources");
  const m = model(short, short, ANSWER);
  const out = await writeCases({ processText: DOC, records: d.records, work: d.work, jobDir: d.job, ask: m.ask });
  assert.equal(m.prompts.length, 2);
  assert.match(out.reply, /^The coverage check refuses these test cases/);
  assert.match(out.reply, /no-sources/);
  assert.equal(JSON.parse(readFileSync(join(d.records, "cases-checked.json"), "utf8")).ok, false);
});

test("text that is not a process document wakes no model", async () => {
  const d = dirs();
  const m = model(ANSWER);
  const out = await writeCases({ processText: "hello there", records: d.records, work: d.work, jobDir: d.job, ask: m.ask });
  assert.equal(out.code, 3);
  assert.equal(m.prompts.length, 0);
  assert.match(out.reply, /process document/);
});

test("a model that cannot be reached is said in words, and nothing is filed", async () => {
  const d = dirs();
  const m = model(new Error("the model service at example.test could not be reached"));
  const out = await writeCases({ processText: DOC, records: d.records, work: d.work, jobDir: d.job, ask: m.ask });
  assert.equal(out.code, 4);
  assert.match(out.reply, /could not be reached/);
  assert.ok(!existsSync(join(d.job, "pieces.json")));
});

test("the job command sends a process document to the test-case writer, and an agent's files to the suite writer", () => {
  const d = dirs();
  const docFile = join(d.at, "0-abcdefgh-explore.process");
  writeFileSync(docFile, DOC);
  assert.equal(processAmong([{ path: docFile }]), docFile);
  const ran = [];
  const spawn = (bin, argv, opts) => { ran.push({ script: basename(argv[0]), env: opts.env }); return { status: 0, stdout: `${JSON.stringify({ ok: true, code: 0, reply: "6 test cases" })}\n`, stderr: "" }; };
  const out = runJob({ job: d.job, records: d.records, work: d.work, files: [{ path: docFile }], spawn });
  assert.deepEqual(ran.map((r) => r.script), ["test-cases.mjs"]);
  assert.equal(ran[0].env.PROCESS, docFile);
  assert.equal(out.reply, "6 test cases");
});

test("the checker the package carries is standards/process-check.mjs, byte for byte", () => {
  const mine = readFileSync(join(ROOT, "scripts", "process-check.mjs"));
  const theirs = readFileSync(join(ROOT, "..", "..", "standards", "process-check.mjs"));
  assert.ok(mine.equals(theirs), "scripts/process-check.mjs differs from standards/process-check.mjs: copy it again");
});

test("the declaration: write-test-cases is an offering with its steps, outputs, price and scripts", () => {
  const o = DESC.offerings.find((x) => x.id === "write-test-cases");
  assert.ok(o, "no write-test-cases offering");
  assert.deepEqual(o.steps.map((s) => s.id), ["write-the-cases", "check-the-cases"]);
  assert.equal(o.steps.find((s) => s.id === "check-the-cases").how.intelligence, "none");
  const outs = Object.fromEntries(o.outputs.map((x) => [x.name, x.kind]));
  assert.equal(outs["the test cases"], CASE_KIND);
  assert.equal(outs["what the test cases cover"], "text/markdown");
  assert.ok(o.inputs.some((i) => i.kind === "text/vnd.agentprocesses.process" && i.required));
  const req = JSON.parse(readFileSync(join(ROOT, "agent-runtime-requirements.json"), "utf8"));
  assert.ok(req.price.covers.offerings.includes("write-test-cases"));
  const skills = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")).extensions["net.agentdoc.package"].build.skills;
  for (const s of ["write-test-cases", "write-the-cases", "check-the-cases"]) {
    assert.ok(skills[s], `plugin.json names no skill ${s}`);
    assert.ok(existsSync(join(ROOT, "skills", s, "SKILL.md")), `skills/${s}/SKILL.md`);
  }
  for (const f of ["scripts/test-cases.mjs", "scripts/check-cases.mjs", "scripts/process-check.mjs"]) assert.ok(skills["write-test-cases"].scripts.includes(f), f);
  for (const f of ["scripts/test-cases.mjs", "scripts/check-cases.mjs", "scripts/process-check.mjs"]) assert.ok(skills["write-a-suite"].scripts.includes(f), `${f}: the job command (write-a-suite's) routes a process document here, so its skill carries it`);
  for (const r of ["cases.json", "cases-checked.json"]) assert.ok(DESC.records.some((x) => x.file === `*/${r}`), r);
});
