// The baseline run: the project's own test command, once, in a child process
// with a time limit, handed none of this agent's credentials, its results
// read from what it printed.
//   node --test test/baseline.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canCutNetwork, countsIn, runBaseline, tailOf } from "../scripts/baseline.mjs";
import { codebase } from "./helpers.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "reverse-engineer-scratch-"));

test("the node-app's own test command runs once and its results are read", async () => {
  const cb = codebase("node-app", { checkout: false });
  const r = await runBaseline({ command: "node --test", cwd: cb.dir, scratch: scratch() });
  assert.equal(r.exit_code, 0, r.output);
  assert.equal(r.timed_out, false);
  assert.deepEqual([r.passed, r.failed], [3, 0]);
  assert.equal(r.read_from, "the node test runner's summary");
  assert.equal(r.network.startsWith("cut off"), canCutNetwork());
});

test("a run past its time limit is stopped and said to be stopped", async () => {
  const cb = codebase("no-tests", { checkout: false });
  const r = await runBaseline({ command: "node -e \"setTimeout(() => {}, 60000)\"", cwd: cb.dir, scratch: scratch(), seconds: 1, floor: 1 });
  assert.equal(r.timed_out, true);
  assert.equal(r.time_limit_seconds, 1);
  assert.ok(r.seconds < 30, `stopped after ${r.seconds} seconds`);
});

test("the child is handed none of this agent's credentials", async () => {
  const cb = codebase("no-tests", { checkout: false });
  const env = { ...process.env, MODEL_KEY: "secret-model-key", LEDGER_TOKEN: "secret-ledger" };
  const r = await runBaseline({ command: "node -e \"console.log('key=' + (process.env.MODEL_KEY || 'none') + ' ledger=' + (process.env.LEDGER_TOKEN || 'none'))\"", cwd: cb.dir, scratch: scratch(), env });
  assert.match(r.output, /key=none ledger=none/);
  assert.doesNotMatch(r.output, /secret/);
});

test("the summaries of common runners are read, and an unknown one says nothing", () => {
  assert.deepEqual(countsIn("# tests 4\n# pass 3\n# fail 1\n# skipped 0\n"), { passed: 3, failed: 1, skipped: 0, read_from: "the node test runner's summary" });
  assert.deepEqual(countsIn("Tests:       1 failed, 2 passed, 3 total\n"), { passed: 2, failed: 1, skipped: 0, read_from: "Jest's summary" });
  assert.deepEqual(countsIn("  3 passing (12ms)\n  1 failing\n"), { passed: 3, failed: 1, skipped: 0, read_from: "Mocha's summary" });
  assert.deepEqual(countsIn("===== 2 failed, 5 passed, 1 skipped in 0.31s =====\n"), { passed: 5, failed: 2, skipped: 1, read_from: "pytest's summary" });
  assert.deepEqual(countsIn("all good\n"), {});
});

test("the tail kept in the record carries no path of the machine it ran on", () => {
  const t = tailOf("at /tmp/x/code/src/a.js:3\nhome /tmp/x/run-1/home", { cwd: "/tmp/x/code", scratch: "/tmp/x/run-1" });
  assert.doesNotMatch(t, /\/tmp\/x/);
  assert.match(t, /at \.\/src\/a\.js:3/);
  assert.match(t, /<scratch>\/home/);
});
