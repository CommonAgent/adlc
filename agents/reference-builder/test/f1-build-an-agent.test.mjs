// The reference builder drives the coding harness and the ADLC plugin; it
// writes none of a build's files. What is worth pinning:
//   - a request starts a folder with /adlc:start; an answer naming a build
//     resumes the same session; only "approve" for the build approves;
//   - after each run the reply says where the build is in the words of the
//     folder's own check, in its two phases, and never that the build has
//     passed when the check does not;
//   - the approval is offered only when the check says the spec waits;
//   - once approved, the harness is asked to carry on until the build passes;
//   - the person's answer is added to said.md before the harness gets it,
//     every harness run has ADLC_NOT_THE_PERSON=1, and said.md is put back
//     when the harness cannot be run.
// Every program it runs is handed in here: the harness, the folder's check
// and the approval answer as the tests say, and nothing reaches a network or
// a model.
//
//   node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { parseMessage, runJob, whereOf } from "../scripts/build-an-agent.mjs";

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
  at.folder = (id) => join(at.work, "builds", id, "agent");
  return at;
}

const WAITING = { phase: "spec", code: 4, passed: false, waiting: true, problems: [] };

/** A stand-in for every program the agent runs, keeping each call. The
 *  harness lays out the folder on /adlc:start, as the plugin does, and
 *  answers with its words and a session; the check answers with `state.check`
 *  (an object as JSON, or a string as it is). Each harness call keeps what
 *  said.md held when the harness was run. */
function programs({ said = "I wrote the spec from your words.", check = WAITING, harnessFails = false } = {}) {
  const state = { said, check, harnessFails };
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const call = { cmd, args, cwd: opts?.cwd, env: opts?.env };
    calls.push(call);
    if (cmd === "coding-harness") {
      call.prompt = readFileSync(args[args.indexOf("--prompt-file") + 1], "utf8");
      const kept = join(opts.cwd, "agent", "said.md");
      call.saidMd = existsSync(kept) ? readFileSync(kept, "utf8") : null;
      if (state.harnessFails) return { status: null, error: new Error("spawn coding-harness ENOENT"), stdout: "", stderr: "" };
      const m = /^\/adlc:start (\S+)/.exec(call.prompt);
      if (m) { mkdirSync(join(opts.cwd, m[1], ".adlc"), { recursive: true }); writeFileSync(join(opts.cwd, m[1], "request.md"), "the person's words\n"); }
      return { status: 0, stdout: JSON.stringify({ result: state.said, session_id: "s-1" }), stderr: "" };
    }
    if (cmd === "node" && args[0].endsWith("check.mjs")) {
      const c = state.check;
      return { status: typeof c === "object" ? c.code : 1, stdout: typeof c === "object" ? JSON.stringify({ phases: ["spec", "build"], ...c }) : c, stderr: "" };
    }
    if (cmd === "node" && args[0].endsWith("approve.mjs")) return { status: 0, stdout: "Approved. The spec is pinned.", stderr: "" };
    return { status: 1, stdout: "", stderr: `unexpected ${cmd}` };
  };
  return { calls, spawn, state };
}

const harnessCalls = (calls) => calls.filter((c) => c.cmd === "coding-harness");
const NOW = () => "2026-11-12T20:54:02.280Z";

test("[F1.A1] a request starts a build folder with /adlc:start, runs the coding harness on it, and names the build and where it is", async () => {
  const at = job("Build an agent that turns meeting notes into tasks.");
  try {
    const p = programs();
    const out = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.equal(out.code, 0);
    const h = harnessCalls(p.calls);
    assert.equal(h.length, 1);
    assert.match(h[0].prompt, /^\/adlc:start agent Build an agent that turns meeting notes into tasks\./);
    assert.ok(!h[0].args.includes("--session"));
    assert.match(out.reply, /^build: b-abc123$/m);
    assert.match(out.reply, /^phase: spec$/m);
    assert.match(out.reply, /^where: The spec waits for the person's approval\.$/m);
    assert.deepEqual(checkDelivered(at.job), []);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A1] a build runs with relative folders: each is made absolute, so the harness finds its prompt from inside the build's folder", async () => {
  const at = job("Build an agent that turns meeting notes into tasks.");
  const started = process.cwd();
  try {
    // The agent starts in the job's root and is given each folder by a path
    // relative to it.
    process.chdir(at.root);
    const rel = (p) => relative(at.root, p);
    const argv = ["--job", rel(at.job), "--records", rel(at.records), "--work", rel(at.work), "--text-file", rel(join(at.job, "message.txt"))];
    assert.ok(!isAbsolute(argv[1]) && !isAbsolute(argv[5]), "the folders are given relative");
    const p = programs();
    const out = await runJob({ argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.equal(out.code, 0);
    const h = harnessCalls(p.calls)[0];
    const promptFile = h.args[h.args.indexOf("--prompt-file") + 1];
    assert.ok(isAbsolute(promptFile), `the prompt file is given as ${promptFile}`);
    assert.ok(isAbsolute(h.cwd), `the harness runs in ${h.cwd}`);
    assert.equal(readFileSync(resolve(h.cwd, promptFile), "utf8"), h.prompt, "the harness finds the prompt from where it runs");
    assert.ok(existsSync(join(at.work, "builds", "b-abc123", "build.json")), "the build is kept under the work folder");
    assert.match(out.reply, /^build: b-abc123$/m);
    assert.deepEqual(checkDelivered(at.job), []);
    // An answer to the same build, with the same relative folders, resumes it.
    writeFileSync(join(at.job, "message.txt"), "b-abc123: yes, to the author");
    const next = await runJob({ argv, spawn: p.spawn, now: NOW });
    assert.equal(next.code, 0);
    const h2 = harnessCalls(p.calls).at(-1);
    assert.equal(readFileSync(resolve(h2.cwd, h2.args[h2.args.indexOf("--prompt-file") + 1]), "utf8"), "yes, to the author");
  } finally { process.chdir(started); rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A2] the harness's question is the reply, and an answer naming the build resumes the same session", async () => {
  const at = job("Build an agent that turns meeting notes into tasks.");
  try {
    const p = programs({ said: "Should a task with no owner go to the note's author? I recommend yes.", check: { phase: "build", code: 1, passed: false, problems: ["answers.json: owner has no words"] } });
    const first = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.match(first.reply, /Should a task with no owner go to the note's author\? I recommend yes\./);
    assert.match(first.reply, /b-abc123: <your answer>/);
    const next = at.again("b-abc123: yes, to the author");
    const second = await runJob({ argv: next.argv, spawn: p.spawn, newId: () => "b-never", now: NOW });
    assert.equal(second.code, 0);
    const h = harnessCalls(p.calls);
    assert.equal(h.length, 2);
    assert.deepEqual(h[1].args.slice(h[1].args.indexOf("--session"), h[1].args.indexOf("--session") + 2), ["--session", "s-1"]);
    assert.equal(h[1].prompt, "yes, to the author");
    assert.equal(h[1].cwd, h[0].cwd);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A3] only the person's word approves the spec: approve for the build runs the approval, other words do not", async () => {
  const at = job("Build an agent that turns meeting notes into tasks.");
  try {
    const p = programs();
    await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    await runJob({ argv: at.again("b-abc123: looks fine to me").argv, spawn: p.spawn, now: NOW });
    assert.equal(p.calls.filter((c) => c.cmd === "node" && c.args[0].endsWith("approve.mjs")).length, 0, "words that are not approve approve nothing");
    p.state.check = { phase: "build", code: 0, passed: true, problems: [] };
    const out = await runJob({ argv: at.again("b-abc123: approve").argv, spawn: p.spawn, now: NOW });
    assert.equal(out.code, 0);
    const approvals = p.calls.filter((c) => c.cmd === "node" && c.args[0].endsWith("approve.mjs"));
    assert.equal(approvals.length, 1);
    assert.ok(approvals[0].cwd.endsWith(join("b-abc123", "agent")));
    assert.match(harnessCalls(p.calls).at(-1).prompt, /^The person approved the spec/);
    assert.match(out.reply, /^where: The build has passed\.$/m);
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
    assert.deepEqual(readdirSync(at.folder("b-abc123")).sort(), [".adlc", "request.md"]);
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

test("[F1.A6] the reply says where the build is in the check's words, in each phase", async () => {
  const cases = [
    [{ phase: "spec", code: 1, passed: false, problems: ["spec.json: F1 has no scenario", "answers.json: no price"] }, "spec", "The spec still has things missing."],
    [WAITING, "spec", "The spec waits for the person's approval."],
    [{ phase: "build", code: 1, passed: false, problems: ["a", "b", "c"], tests_fixed: false }, "build", "The build has 3 things missing."],
    [{ phase: "build", code: 1, passed: false, problems: ["a"] }, "build", "The build has 1 thing missing."],
    [{ phase: "build", code: 0, passed: true, problems: [] }, "build", "The build has passed."],
    [{ phase: null, code: 0, passed: true, problems: [] }, "build", "The build has passed."],
  ];
  for (const [check, phase, where] of cases) {
    const at = job("Build an agent that sorts receipts.");
    try {
      const p = programs({ check });
      const out = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
      assert.match(out.reply, new RegExp(`^phase: ${phase}$`, "m"), JSON.stringify(check));
      assert.ok(out.reply.split("\n").includes(`where: ${where}`), `${JSON.stringify(check)} says ${where}`);
    } finally { rmSync(at.root, { recursive: true, force: true }); }
  }
});

test("[F1.A6] it never says the build has passed when the check does not, and says the check could not tell when it does not answer", async () => {
  const notPassed = [
    { phase: "build", code: 1, passed: false, problems: ["Code: the suite fails"] },
    { phase: "build", code: 3, passed: false, problems: ["spec.json was changed"] },
    { phase: "build", code: 0, passed: false, problems: [] },
    "Error: the check broke",
    "",
  ];
  for (const check of notPassed) {
    const at = job("Build an agent that sorts receipts.");
    try {
      const p = programs({ check, said: "Done. The build has passed." });
      const out = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
      assert.doesNotMatch(out.reply, /^where: The build has passed\.$/m, `the check said ${JSON.stringify(check)}`);
      if (typeof check === "string") assert.match(out.reply, /^where: The check could not tell where the build is\.$/m);
    } finally { rmSync(at.root, { recursive: true, force: true }); }
  }
  assert.equal(whereOf(null).passed, false);
  assert.equal(whereOf(null).where, "The check could not tell where the build is.");
  assert.equal(whereOf({ phase: "build", code: 3, passed: false, problems: ["x"] }).passed, false);
  assert.equal(whereOf({ phase: "build", code: 0, passed: true, problems: [] }).passed, true);
});

test("[F1.A7] the approval of the spec is offered only when the check says the spec waits for the person", async () => {
  const others = [
    { phase: "spec", code: 1, passed: false, problems: ["spec.json: no refusal"] },
    { phase: "build", code: 1, passed: false, problems: ["a"] },
    { phase: "build", code: 0, passed: true, problems: [] },
    "not json",
  ];
  const at = job("Build an agent that sorts receipts.");
  try {
    const p = programs({ said: "Here is where it is." });
    const waiting = await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.match(waiting.reply, /b-abc123: approve/);
    for (const check of others) {
      p.state.check = check;
      const out = await runJob({ argv: at.again("b-abc123: carry on").argv, spawn: p.spawn, now: NOW });
      assert.doesNotMatch(out.reply, /approve/i, `the check said ${JSON.stringify(check)}`);
    }
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A8] once the spec is approved, the harness is asked to carry on until the check says the build has passed, not stage by stage", async () => {
  const at = job("Build an agent that sorts receipts.");
  try {
    const p = programs();
    await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    await runJob({ argv: at.again("b-abc123: approve").argv, spawn: p.spawn, now: NOW });
    const prompt = harnessCalls(p.calls).at(-1).prompt;
    assert.match(prompt, /^The person approved the spec/);
    assert.match(prompt, /until the check says the build has passed/);
    assert.doesNotMatch(prompt, /stage/i);
    assert.deepEqual(harnessCalls(p.calls).at(-1).args.slice(-2), ["--session", "s-1"]);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A9] the person's answer is added to said.md under a heading with the time before the harness gets it, and every run is marked not the person's", async () => {
  const at = job("Build an agent that sorts receipts.");
  try {
    const p = programs();
    await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    assert.equal(existsSync(join(at.folder("b-abc123"), "said.md")), false, "a new request goes to request.md through /adlc:start");
    await runJob({ argv: at.again("b-abc123: yes, to the author").argv, spawn: p.spawn, now: NOW });
    const h = harnessCalls(p.calls);
    assert.match(h[1].saidMd, /^## 2026-11-12T20:54:02\.280Z\n\nyes, to the author\n/m, "the words were in said.md when the harness ran");
    await runJob({ argv: at.again("b-abc123: approve").argv, spawn: p.spawn, now: () => "2026-11-12T21:00:00.000Z" });
    const kept = readFileSync(join(at.folder("b-abc123"), "said.md"), "utf8");
    assert.doesNotMatch(kept, /2026-11-12T21:00:00/, "the approval prompt is the agent's, not the person's");
    for (const c of harnessCalls(p.calls)) assert.equal(c.env?.ADLC_NOT_THE_PERSON, "1", `run with ${c.prompt.slice(0, 30)}`);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.A9] when the harness cannot be run on the person's answer, said.md is as it was", async () => {
  const at = job("Build an agent that sorts receipts.");
  try {
    const p = programs();
    await runJob({ argv: at.argv, spawn: p.spawn, newId: () => "b-abc123" });
    const kept = join(at.folder("b-abc123"), "said.md");
    p.state.harnessFails = true;
    const first = await runJob({ argv: at.again("b-abc123: yes").argv, spawn: p.spawn, now: NOW });
    assert.equal(first.code, 1);
    assert.match(first.reply, /coding harness could not be run/);
    assert.equal(existsSync(kept), false, "a said.md that was not there is not left behind");
    p.state.harnessFails = false;
    await runJob({ argv: at.again("b-abc123: yes").argv, spawn: p.spawn, now: NOW });
    const before = readFileSync(kept, "utf8");
    p.state.harnessFails = true;
    await runJob({ argv: at.again("b-abc123: and one more").argv, spawn: p.spawn, now: () => "2026-11-12T22:00:00.000Z" });
    assert.equal(readFileSync(kept, "utf8"), before);
  } finally { rmSync(at.root, { recursive: true, force: true }); }
});

test("[F1.R3] a message names a build by its id, followed by a colon", () => {
  assert.deepEqual(parseMessage("b-abc123: approve"), { kind: "approve", build: "b-abc123" });
  assert.deepEqual(parseMessage("b-abc123:  yes please "), { kind: "answer", build: "b-abc123", words: "yes please" });
  assert.deepEqual(parseMessage("Build an agent."), { kind: "new", request: "Build an agent." });
  assert.deepEqual(parseMessage(" \n "), { kind: "empty" });
});
