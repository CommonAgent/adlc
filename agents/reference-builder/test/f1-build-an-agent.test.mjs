// The reference builder drives the coding harness and the ADLC plugin; it
// writes none of a build's files. Every program it runs is handed in here:
// the harness, the folder's check and the person's approval answer as the
// tests say, and nothing reaches a network or a model.
//
//   node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { parseMessage, runJob } from "../scripts/build-an-agent.mjs";

/** A job's folders, and the house command line for one message. */
function job(message) {
  const root = mkdtempSync(join(tmpdir(), "reference-builder-"));
  const at = { root, job: join(root, "job"), records: join(root, "records"), work: join(root, "work") };
  for (const d of [at.job, at.records, at.work]) mkdirSync(d, { recursive: true });
  writeFileSync(join(at.job, "message.txt"), message);
  at.argv = ["--job", at.job, "--records", at.records, "--work", at.work, "--text-file", join(at.job, "message.txt")];
  at.again = (words) => {
    const next = join(root, `job-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(next, { recursive: true });
    writeFileSync(join(next, "message.txt"), words);
    return { job: next, argv: ["--job", next, "--records", at.records, "--work", at.work, "--text-file", join(next, "message.txt")] };
  };
  return at;
}

/** A stand-in for every program the agent runs, keeping each call. The
 *  harness lays out the folder on /adlc:start, as the plugin does, and
 *  answers with its words and a session; the check answers with the stage. */
function programs({ said = "The spec is ready. Approve it?", stage = "requirements", code = 4, harnessFails = false } = {}) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    if (cmd === "coding-harness") {
      if (harnessFails) return { status: null, error: new Error("spawn coding-harness ENOENT"), stdout: "", stderr: "" };
      const prompt = readFileSync(args[args.indexOf("--prompt-file") + 1], "utf8");
      const m = /^\/adlc:start (\S+)/.exec(prompt);
      if (m) { mkdirSync(join(opts.cwd, m[1], ".adlc"), { recursive: true }); writeFileSync(join(opts.cwd, m[1], "request.md"), "the person's words\n"); }
      return { status: 0, stdout: JSON.stringify({ result: said, session_id: "s-1" }), stderr: "" };
    }
    if (cmd === "node" && args[0].endsWith("check.mjs")) return { status: code, stdout: JSON.stringify({ stage, code, problems: [] }), stderr: "" };
    if (cmd === "node" && args[0].endsWith("approve.mjs")) return { status: 0, stdout: "Approved. The spec is pinned.", stderr: "" };
    return { status: 1, stdout: "", stderr: `unexpected ${cmd}` };
  };
  return { calls, spawn };
}

const harnessCalls = (calls) => calls.filter((c) => c.cmd === "coding-harness");
const replyOf = (dir) => readFileSync(join(dir, "out", "reply.md"), "utf8");

test("[F1.A1] a request starts a build folder with /adlc:start and runs the coding harness on it", async () => {
  const at = job("Build an agent that turns meeting notes into tasks.");
  try {
    const p = programs();
    const out = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.equal(out.code, 0);
    const h = harnessCalls(p.calls);
    assert.equal(h.length, 1);
    const prompt = readFileSync(h[0].args[h[0].args.indexOf("--prompt-file") + 1], "utf8");
    assert.match(prompt, /^\/adlc:start agent Build an agent that turns meeting notes into tasks\./);
    assert.ok(!h[0].args.includes("--session"));
    assert.match(out.reply, /^build: b-abc123$/m);
    assert.match(out.reply, /^stage: Requirements$/m);
    assert.deepEqual(checkDelivered(at.job), []);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A2] the harness's question is the reply, and an answer naming the build resumes the same session", async () => {
  const at = job("Build an agent that turns meeting notes into tasks.");
  try {
    const p = programs({ said: "Should a task with no owner go to the note's author? I recommend yes." });
    const first = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.match(first.reply, /Should a task with no owner go to the note's author\? I recommend yes\./);
    assert.match(first.reply, /b-abc123: <your answer>/);
    const next = at.again("b-abc123: yes, to the author");
    const second = await runJob({ argv: next.argv, spawn: p.spawn, newId: () => "b-never" });
    assert.equal(second.code, 0);
    const h = harnessCalls(p.calls);
    assert.equal(h.length, 2);
    assert.deepEqual(h[1].args.slice(h[1].args.indexOf("--session"), h[1].args.indexOf("--session") + 2), ["--session", "s-1"]);
    assert.equal(readFileSync(h[1].args[h[1].args.indexOf("--prompt-file") + 1], "utf8"), "yes, to the author");
    assert.equal(h[1].cwd, h[0].cwd);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A3] only the person's word approves the spec: approve for the build runs the approval, other words do not", async () => {
  const at = job("Build an agent that turns meeting notes into tasks.");
  try {
    const p = programs();
    await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    await runJob({ argv: at.again("b-abc123: looks fine to me").argv, spawn: p.spawn });
    assert.equal(p.calls.filter((c) => c.cmd === "node" && c.args[0].endsWith("approve.mjs")).length, 0);
    const out = await runJob({ argv: at.again("b-abc123: approve").argv, spawn: p.spawn });
    assert.equal(out.code, 0);
    const approvals = p.calls.filter((c) => c.cmd === "node" && c.args[0].endsWith("approve.mjs"));
    assert.equal(approvals.length, 1);
    assert.ok(approvals[0].cwd.endsWith(join("b-abc123", "agent")));
    const last = harnessCalls(p.calls).at(-1);
    assert.match(readFileSync(last.args[last.args.indexOf("--prompt-file") + 1], "utf8"), /^The person approved the spec/);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A4] an unknown build is refused, a message with no words asks for the request, and the agent writes no build file itself", async () => {
  const at = job("   \n");
  try {
    const p = programs();
    const empty = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.equal(empty.code, 3);
    assert.match(empty.reply, /what the agent should do/i);
    assert.equal(p.calls.length, 0);
    const unknown = await runJob({ argv: at.again("b-zzz999: approve").argv, spawn: p.spawn });
    assert.equal(unknown.code, 3);
    assert.match(unknown.reply, /keeps no build b-zzz999/);
    assert.equal(p.calls.length, 0);
    const started = await runJob({ argv: at.again("Build an agent that sorts receipts.").argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.equal(started.code, 0);
    // Inside the build folder there is only what the harness wrote.
    assert.deepEqual(readdirSync(join(at.work, "builds", "b-abc123", "agent")).sort(), [".adlc", "request.md"]);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A5] when the coding harness cannot be run it says so and keeps no build", async () => {
  const at = job("Build an agent that sorts receipts.");
  try {
    const p = programs({ harnessFails: true });
    const out = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.equal(out.code, 1);
    assert.match(out.reply, /coding harness could not be run/);
    assert.equal(existsSync(join(at.work, "builds", "b-abc123")), false);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.R3] a message names a build by its id, followed by a colon", () => {
  assert.deepEqual(parseMessage("b-abc123: approve"), { kind: "approve", build: "b-abc123" });
  assert.deepEqual(parseMessage("b-abc123:  yes please "), { kind: "answer", build: "b-abc123", words: "yes please" });
  assert.deepEqual(parseMessage("Build an agent."), { kind: "new", request: "Build an agent." });
  assert.deepEqual(parseMessage(" \n "), { kind: "empty" });
});
