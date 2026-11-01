// The write-a-process offering as one job (scripts/process.mjs): a person's
// words in, an Agent Processes 0.9.0 document and its open questions out,
// checked before it is handed back.
//
// What is worth pinning: the checker runs over every document before it goes,
// and a document it finds wrong goes back to the model once with what was
// found, never a third time; what is still wrong after that is said and asked
// as an open question rather than delivered as if it were right. A refused
// request writes no document. Nothing to work from wakes no model. The pieces
// are what the descriptor declares them to be, the records the descriptor
// names are written on every run, and the checker the package carries is
// standards/process-check.mjs byte for byte.
//
// Nothing here touches a network or a model: the model is a function handed in.
//   node --test test/process-job.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { writeProcess, REPLY_MAX } from "../scripts/process.mjs";
import { checkProcess } from "../scripts/process-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ANSWER = readFileSync(join(HERE, "fixtures", "process", "morning-summary.answer.json"), "utf8");
const WORDS = "each morning, read three competitor blogs and send me a one-page summary for approval before it goes to the team";
const DESC = JSON.parse(readFileSync(join(ROOT, "agent-descriptor.json"), "utf8"));

function dirs() {
  const at = mkdtempSync(join(tmpdir(), "spec-writer-process-"));
  const d = { records: join(at, "records"), job: join(at, "job"), at };
  mkdirSync(d.records, { recursive: true });
  mkdirSync(d.job, { recursive: true });
  return d;
}

/** A model that answers from a list, in order, and keeps every prompt. */
function model(...answers) {
  const prompts = [];
  const ask = async (prompt) => {
    prompts.push(prompt);
    const a = answers[Math.min(prompts.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { text: typeof a === "string" ? a : JSON.stringify(a), answered_by: "test-model", tokens_in: 10, tokens_out: 20 };
  };
  return { ask, prompts };
}

const pieces = (d) => JSON.parse(readFileSync(join(d.job, "pieces.json"), "utf8"));

test("a good answer is written as a document the checker passes, with its open questions, and filed as pieces", async () => {
  const d = dirs();
  const m = model(ANSWER);
  const out = await writeProcess({ text: WORDS, records: d.records, jobDir: d.job, ask: m.ask, today: "2026-11-01" });
  assert.equal(out.code, 0, out.reply);
  assert.equal(m.prompts.length, 1);
  const listed = pieces(d);
  const doc = listed.find((p) => p.name === "the process document");
  assert.ok(doc, JSON.stringify(listed));
  assert.equal(doc.media_type, "text/vnd.agentprocesses.process");
  assert.equal(doc.path, "out/morning-competitor-summary.process.txt");
  const text = readFileSync(join(d.job, doc.path), "utf8");
  const r = checkProcess(text);
  assert.equal(r.conforms && r.clean, true, JSON.stringify(r.failures.concat(r.findings)));
  const open = listed.find((p) => p.name === "what is still open");
  assert.ok(open);
  const md = readFileSync(join(d.job, open.path), "utf8");
  for (const k of ["name", "owner", "signs", "outside"]) assert.match(md, new RegExp(`\`${k}\``));
  assert.deepEqual(checkDelivered(d.job, { undeclared: true }), []);
  // The reply: the name, each step, the check, what is open, in its room.
  assert.match(out.reply, /morning competitor summary/);
  assert.match(out.reply, /read-the-blogs/);
  assert.match(out.reply, /conforms to Agent Processes 0\.9\.0/);
  assert.match(out.reply, /sha256:[0-9a-f]{64}/);
  assert.match(out.reply, /`signs`/);
  assert.ok(out.reply.length <= REPLY_MAX, `${out.reply.length} characters`);
  // The records the descriptor names.
  for (const f of ["process-asked.json", "process-draft.json", "process-check.json", "calls.json", "went-without.json"]) assert.ok(existsSync(join(d.records, f)), f);
  const calls = JSON.parse(readFileSync(join(d.records, "calls.json"), "utf8"));
  assert.equal(calls.calls.length, 1);
  assert.equal(calls.calls[0].answered_by, "test-model");
  const check = JSON.parse(readFileSync(join(d.records, "process-check.json"), "utf8"));
  assert.equal(check.conforms, true);
  assert.equal(check.digest, r.digest);
});

test("a document the checker finds wrong goes back to the model once, with what was found", async () => {
  const d = dirs();
  const bad = JSON.parse(ANSWER);
  delete bad.measures["quality gate"];
  bad.handoffs[1].to = ["approve-the-summry"];
  const m = model(bad, ANSWER);
  const out = await writeProcess({ text: WORDS, records: d.records, jobDir: d.job, ask: m.ask, today: "2026-11-01" });
  assert.equal(out.code, 0, out.reply);
  assert.equal(m.prompts.length, 2);
  assert.match(m.prompts[1], /§12\.2/);
  assert.match(m.prompts[1], /approve-the-summry/);
  assert.match(out.reply, /conforms/);
  const went = JSON.parse(readFileSync(join(d.records, "went-without.json"), "utf8"));
  assert.ok(went.entries.length >= 1, "the first answer's findings are recorded as what the job went without");
});

test("what is still wrong after the second go is said and asked, never a third call", async () => {
  const d = dirs();
  const bad = JSON.parse(ANSWER);
  delete bad.measures["quality gate"];
  const m = model(bad, bad, ANSWER);
  const out = await writeProcess({ text: WORDS, records: d.records, jobDir: d.job, ask: m.ask, today: "2026-11-01" });
  assert.equal(m.prompts.length, 2);
  assert.equal(out.code, 0);
  assert.match(out.reply, /does not conform/);
  assert.match(out.reply, /§12\.2/);
  const md = readFileSync(join(d.job, "out", "still-open.md"), "utf8");
  assert.match(md, /`conformance`/);
});

test("a request the model refuses writes no document, and the reply says why", async () => {
  const d = dirs();
  const m = model({ refused: "It sends a message to thousands of people who did not ask for it.", phases: [] });
  const out = await writeProcess({ text: "email every address on this list of 40,000 strangers each morning", records: d.records, jobDir: d.job, ask: m.ask, today: "2026-11-01" });
  assert.equal(out.code, 0);
  assert.match(out.reply, /^I cannot write this process: It sends a message to thousands/);
  assert.ok(!existsSync(join(d.job, "pieces.json")));
  assert.ok(existsSync(join(d.records, "process-draft.json")));
});

test("nothing to work from wakes no model", async () => {
  const d = dirs();
  const m = model(ANSWER);
  const out = await writeProcess({ text: "   ", records: d.records, jobDir: d.job, ask: m.ask });
  assert.equal(out.code, 3);
  assert.equal(m.prompts.length, 0);
  assert.match(out.reply, /nothing/i);
  assert.ok(existsSync(join(d.records, "went-without.json")));
});

test("an answer that is not JSON on both goes writes no document", async () => {
  const d = dirs();
  const m = model("I would plan it like this: first read the blogs.", "Still prose.");
  const out = await writeProcess({ text: WORDS, records: d.records, jobDir: d.job, ask: m.ask });
  assert.equal(out.code, 4);
  assert.equal(m.prompts.length, 2);
  assert.match(out.reply, /^I cannot write this process/);
  assert.ok(!existsSync(join(d.job, "pieces.json")));
});

test("a model that cannot be reached is said in words, and no document is written", async () => {
  const d = dirs();
  const m = model(new Error("the model service at example.test could not be reached"));
  const out = await writeProcess({ text: WORDS, records: d.records, jobDir: d.job, ask: m.ask });
  assert.equal(out.code, 4);
  assert.match(out.reply, /could not be reached/);
});

test("an attached process document is revised, not written again", async () => {
  const d = dirs();
  const earlier = join(d.at, "0-abcdefgh-morning.process.txt");
  writeFileSync(earlier, "PROCESS: morning competitor summary   id: <team>/morning-competitor-summary   v1\nowner: whoever starts the run   effective: 2026-10-30\n");
  const m = model(ANSWER);
  const out = await writeProcess({ text: "make it run on Mondays only", files: [{ path: earlier, media_type: "text/plain" }], records: d.records, jobDir: d.job, ask: m.ask, today: "2026-11-01" });
  assert.equal(out.code, 0, out.reply);
  assert.match(m.prompts[0], /EARLIER DOCUMENT START\nPROCESS: morning competitor summary/);
  assert.match(m.prompts[0], /make it run on Mondays only/);
});

test("the command line: exit 2 without its folders, and the reply as one JSON object", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "process.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  const d = dirs();
  const t = join(d.at, "message.txt");
  writeFileSync(t, "");
  const ok = spawnSync(process.execPath, [join(ROOT, "scripts", "process.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, JOB_DIR: d.job, RECORDS: d.records, TEXT_FILE: t } });
  assert.equal(ok.status, 3);
  assert.match(JSON.parse(ok.stdout.trim().split("\n").pop()).reply, /nothing/i);
});

test("the checker the package carries is standards/process-check.mjs, byte for byte", () => {
  const mine = readFileSync(join(ROOT, "scripts", "process-check.mjs"));
  const theirs = readFileSync(join(ROOT, "..", "..", "standards", "process-check.mjs"));
  assert.ok(mine.equals(theirs), "scripts/process-check.mjs differs from standards/process-check.mjs: copy it again");
});

test("the declaration: write-a-process is an offering with its steps, outputs, price and scripts", () => {
  const o = DESC.offerings.find((x) => x.id === "write-a-process");
  assert.ok(o, "no write-a-process offering");
  assert.deepEqual(o.steps.map((s) => s.id), ["draft-the-process", "check-the-process"]);
  assert.equal(o.steps.find((s) => s.id === "draft-the-process").how.intelligence, "called");
  assert.equal(o.steps.find((s) => s.id === "check-the-process").how.intelligence, "none");
  const outs = Object.fromEntries(o.outputs.map((x) => [x.name, x.kind]));
  assert.equal(outs["the process document"], "text/vnd.agentprocesses.process");
  assert.equal(outs["what is still open"], "text/markdown");
  assert.ok(o.inputs.some((i) => i.given_by === "person" && i.required));
  const req = JSON.parse(readFileSync(join(ROOT, "agent-runtime-requirements.json"), "utf8"));
  assert.ok(req.price.covers.offerings.includes("write-a-process"));
  const skills = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")).extensions["net.agentdoc.package"].build.skills;
  for (const s of ["write-a-process", "draft-the-process", "check-the-process"]) {
    assert.ok(skills[s], `plugin.json names no skill ${s}`);
    assert.ok(existsSync(join(ROOT, "skills", s, "SKILL.md")), `skills/${s}/SKILL.md`);
  }
  for (const f of ["scripts/process.mjs", "scripts/process-draft.mjs", "scripts/process-check.mjs"]) assert.ok(skills["write-a-process"].scripts.includes(f), f);
  for (const r of ["process-draft.json", "process-check.json"]) assert.ok(DESC.records.some((x) => x.file === `*/${r}`), r);
  assert.ok(DESC.will_not.some((w) => /agent's name|name an agent/i.test(w) && /process/i.test(w)));
});
