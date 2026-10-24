// The reply: whether scripts are delivered and why, first.
//   node --test test/report.test.mjs
//
// Worth pinning: the first sentence decides whether there is something to
// take; a conflict, a used-up ceiling and a broken fence each say so in their
// own words and deliver nothing; the check's words go in as written; and the
// writer's account and what the job went without ride behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { replyText } from "../scripts/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "report.mjs");

const WS = { name: "adder", scripts: [{ path: "scripts/add.mjs" }, { path: "scripts/pieces.mjs" }] };
const RUNS = [{ round: 1, tests: 9, pass: 6, fail: 3, failing: ["a", "b", "c"] }, { round: 2, tests: 9, pass: 9, fail: 0, failing: [] }];
const DONE = { done: true, round: 2, tests: 9, said: "Round 2: the suite passes, 9 of 9. Blanked one at a time, the suite noticed every one of the 2. The builder is not on this host, so whether the package builds was not checked here; the package-maker builds it and refuses what does not." };

test("a done verdict says what was written, in how many rounds, then the check's words, then the account, then the manifest line", () => {
  const r = replyText({ workspace: WS, runs: RUNS, verdict: DONE, account: "I wrote add and pieces.\nThe spec did not say what a negative is; I let it through.", wentWithout: "This job went ahead without one of the things it takes: the prototype." });
  const p = r.split("\n\n");
  assert.equal(p[0], "Wrote 2 scripts for adder in 2 rounds; the suite passes, 9 of 9.");
  assert.equal(p[1], "Blanked one at a time, the suite noticed every one of the 2. The builder is not on this host, so whether the package builds was not checked here; the package-maker builds it and refuses what does not.");
  assert.equal(p[2], "The writer's account: I wrote add and pieces. The spec did not say what a negative is; I let it through.");
  assert.equal(p[3], "This job went ahead without one of the things it takes: the prototype.");
  assert.match(p[4], /^The scripts go with a signed manifest/);
});

test("a conflict delivers nothing and says whose call it is", () => {
  const r = replyText({ workspace: WS, runs: RUNS.slice(0, 1), verdict: { done: false }, conflict: "test \"a credential is refused\" expects exit 3; the spec's empty sentence says exit 0 with a note." });
  const p = r.split("\n\n");
  assert.equal(p[0], "Stopped without delivering after 1 round: a test cannot pass without breaking what the spec says.");
  assert.match(p[1], /^test "a credential is refused" expects exit 3/);
  assert.match(p[2], /a person's call at the review gate/);
  assert.doesNotMatch(r, /signed manifest/);
});

test("a used-up ceiling names the last failures and how to go on, and a broken fence says what was touched", () => {
  const ceiling = replyText({ workspace: WS, runs: RUNS.slice(0, 1), verdict: { done: false, stop: "ceiling", said: "x" } });
  assert.match(ceiling, /^Stopped after 1 round without delivering: the rounds are used up and the suite still fails, 3 of 9\./);
  assert.match(ceiling, /Still failing: a; b; c\./);
  assert.match(ceiling, /Raise the ceiling and send it again/);
  const fence = replyText({ workspace: WS, runs: RUNS, verdict: { done: false, stop: "fence", said: "The fence was broken: test/add.test.mjs changed. Put it back; nothing is delivered until the check passes with the fence whole." } });
  assert.match(fence, /^Stopped without delivering: The fence was broken: test\/add\.test\.mjs changed\./);
  const none = replyText({ workspace: WS, runs: [], verdict: null });
  assert.equal(none, "Nothing was checked for adder: no round was run.");
  const notYet = replyText({ workspace: WS, runs: RUNS.slice(0, 1), verdict: { done: false } });
  assert.match(notYet, /^Not done after 1 round: the suite still fails, 3 of 9\. Nothing is delivered\./);
});

test("as a process it exits 2 without RECORDS, and otherwise prints one JSON object whose reply is the whole answer", () => {
  const wrong = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, RECORDS: "" } });
  assert.equal(wrong.status, 2);
  const dir = mkdtempSync(join(tmpdir(), "code-writer-report-"));
  try {
    const ws = join(dir, "ws");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "spec.json"), JSON.stringify({ name: "adder", version: "0.1.0", jobs: [{ slug: "a" }] }));
    writeFileSync(join(dir, "workspace.json"), JSON.stringify({ folder: ws, scripts: WS.scripts }));
    writeFileSync(join(dir, "runs.json"), JSON.stringify({ runs: RUNS }));
    writeFileSync(join(dir, "verdict.json"), JSON.stringify(DONE));
    writeFileSync(join(dir, "account.md"), "I wrote it.\n");
    const r = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, RECORDS: dir } });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.match(out.reply, /^Wrote 2 scripts for adder in 2 rounds; the suite passes, 9 of 9\./);
    assert.match(out.reply, /The writer's account: I wrote it\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
