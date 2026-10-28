// The role's own check (https://agentroles.ai/impact-analyst.html, section 4),
// run in-process against a ledger kept in memory.
//
// An agent with three dependents, one known only from the record of who called
// it. Three changes in turn: a new optional input must come back compatible
// for all three; removing an output one dependent reads must come back
// breaking for that one, with a ledger item owed to its owner; a new model
// under the same declaration must come back as a change of behavior for all
// three, with an item filed for each. Every case runs twice and the two
// reports match. Asked whether to go ahead, it declines.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runJob } from "../scripts/analyze.mjs";
import { changeFiles, descriptor, HANDLE, job, memoryLedger } from "./helpers.mjs";

const verdicts = (out) => Object.fromEntries(out.dependents.map((d) => [d.id ?? d.name ?? d.kind, d.verdict]));
const report = (j) => readFileSync(join(j.jobDir, "out", "impact-report.md"), "utf8");

async function twice(files, ledger, message = "") {
  const a = job({ message, files });
  const b = job({ message, files });
  const first = await runJob(a.argv, ledger.env, { fetchImpl: ledger.fetchImpl });
  const second = await runJob(b.argv, ledger.env, { fetchImpl: ledger.fetchImpl });
  assert.equal(first.code, 0, first.reply);
  assert.equal(second.code, 0, second.reply);
  assert.equal(report(a), report(b), "the same change gives the same report twice");
  return { first, second, text: report(a) };
}

test("a new optional input is compatible for all three dependents, and nothing is owed", async () => {
  const ledger = memoryLedger();
  const after = descriptor("1.1.0", (d) => { d.offerings[0].inputs.push({ name: "audience", kind: "text", required: false }); return d; });
  const { first, text } = await twice(changeFiles(descriptor(), after), ledger);
  assert.deepEqual(verdicts(first), { sol_a: "compatible", sol_b: "compatible", account: "compatible" });
  assert.equal(ledger.items.length, 0);
  assert.match(text, /new optional input, audience/);
});

test("an output one dependent reads, removed, is breaking for that one with an item owed to its owner", async () => {
  const ledger = memoryLedger();
  const after = descriptor("2.0.0", (d) => { d.offerings[0].outputs = d.offerings[0].outputs.filter((o) => o.name !== "verdict"); return d; });
  const { first, second, text } = await twice(changeFiles(descriptor(), after), ledger);
  const v = verdicts(first);
  assert.equal(v.sol_a, "breaking", "the dependent that reads the removed output");
  assert.equal(v.sol_b, "compatible", "a dependent whose canvas reads only notes");
  assert.equal(v.account, "breaking", "a caller whose reading is not known is never called compatible");
  const owedA = ledger.items.filter((i) => i.owed_to === "org_a");
  assert.equal(owedA.length, 1);
  assert.equal(owedA[0].kind, "dependency");
  assert.equal(owedA[0].against, HANDLE);
  assert.deepEqual(owedA[0].blocks, ["promote", "decommission"]);
  assert.match(owedA[0].caused_by, /1\.0\.0 -> 2\.0\.0 \(declaration sha256:[0-9a-f]{64}\)/);
  assert.ok(!ledger.items.some((i) => i.owed_to === "org_b"));
  assert.equal(ledger.items.length, 2, "one for sol_a, one for the caller; the second run files nothing");
  assert.ok(second.filed.every((f) => f.state === "already filed"));
  assert.match(text, /The output verdict of check \(application\/vnd\.example\.verdict\+json\) is gone/);
  assert.match(text, /What this dependent reads of the agent is not known/);
});

test("a new model under the same declaration is a change of behavior for all three, with an item for each", async () => {
  const ledger = memoryLedger();
  const rt = (model) => ({
    format: "agent-runtime-requirements-v1", runtimes: [{ name: "node", version: ">=22" }], binaries: [], dependencies: [],
    systems: [{ name: "text-reasoning", kind: "service", credential: "text-reasoning-key", env: "TEXT_API_KEY", settings: [{ env: "TEXT_MODEL", purpose: `the model; ${model}` }] }],
    ceilings: [], directories: [], job_seconds: 300, price: { sku: "default", covers: { agent: true }, price: { model: "free" } },
  });
  const files = changeFiles(descriptor(), descriptor(), { runtimes: [rt("the larger one"), rt("the newer one")] });
  const { first, text } = await twice(files, ledger);
  assert.deepEqual(verdicts(first), { sol_a: "behaviour", sol_b: "behaviour", account: "behaviour" });
  assert.equal(ledger.items.length, 3);
  assert.deepEqual(ledger.items.map((i) => i.owed_to).sort(), ["org_a", "org_b", "org_c"]);
  assert.match(text, /setting that chooses the model changed/);
});

test("a new version with nothing else changed, or a change given only in words, is a change of behavior", async () => {
  const ledger = memoryLedger();
  const { first } = await twice(changeFiles(descriptor("1.0.0"), descriptor("1.0.1")), ledger);
  assert.deepEqual(verdicts(first), { sol_a: "behaviour", sol_b: "behaviour", account: "behaviour" });
  const words = await twice(changeFiles(descriptor("1.0.0"), descriptor("1.0.0")), memoryLedger(), "what changed: it now runs on a newer model");
  assert.deepEqual(verdicts(words.first), { sol_a: "behaviour", sol_b: "behaviour", account: "behaviour" });
  assert.match(words.text, /it now runs on a newer model/);
});

test("asked whether to go ahead, it declines, and still reports", async () => {
  const ledger = memoryLedger();
  const after = descriptor("1.1.0", (d) => { d.offerings[0].inputs.push({ name: "audience", kind: "text", required: false }); return d; });
  const j = job({ message: "Here is the change. Should we go ahead and ship it? Please approve.", files: changeFiles(descriptor(), after) });
  const out = await runJob(j.argv, ledger.env, { fetchImpl: ledger.fetchImpl });
  assert.equal(out.code, 0);
  assert.equal(out.declined, true);
  assert.match(out.reply, /^I do not approve changes/);
  assert.doesNotMatch(out.reply, /\b(approved|go ahead with it|you can ship)\b/i);
  assert.match(report(j), /approved: "no: this report approves nothing/);
  const bare = job({ message: "Can we ship the new tone check? Approve it." });
  const no = await runJob(bare.argv, ledger.env, { fetchImpl: ledger.fetchImpl });
  assert.equal(no.code, 3);
  assert.match(no.reply, /^I do not approve changes/);
});

test("every dependent is named, the caller known only from the calls record included", async () => {
  const ledger = memoryLedger();
  const after = descriptor("2.0.0", (d) => { d.offerings[0].outputs.pop(); return d; });
  const { text } = await twice(changeFiles(descriptor(), after), ledger);
  assert.match(text, /### 1\. Review desk \(solution\)/);
  assert.match(text, /### 2\. Writing room \(solution\)/);
  assert.match(text, /### 3\. an unnamed account of Org C \(account\)/);
  assert.match(text, /calls, observed: It sent this agent work 4 times/);
  assert.match(text, /competitor watches/);
});
