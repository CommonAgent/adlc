// The whole job, against a platform served from memory: what a person meets
// is what the report says, and the calls are the ones a page makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runJob } from "../scripts/test-usability.mjs";
import { readHeader } from "../scripts/report.mjs";
import { BASE, ENV, badDescriptor, fakePlatform, goodDescriptor, jobFolder } from "./helpers.mjs";

/** A clock that moves only when the tester waits. */
function virtual() {
  let t = Date.parse("2026-10-28T12:00:00Z");
  return { clock: () => t, sleep: async (ms) => { t += ms; } };
}

async function run(message, platform, { files = {}, env = ENV } = {}) {
  const f = jobFolder(message, files);
  const v = virtual();
  const out = await runJob(["--job", f.job, "--records", f.records, "--work", f.work, "--text-file", join(f.job, "message.txt"), ...f.paths.flatMap((p) => ["--file", p])], env, { fetchImpl: platform.fetchImpl, ...v, pollMs: 10_000 });
  let report = null;
  try { report = readFileSync(join(f.job, "out", "usability-report.md"), "utf8"); } catch { report = null; }
  return { out, report, f };
}

test("an agent a person can use is usable, and the runs are the page's own calls", async () => {
  const p = fakePlatform();
  const { out, report, f } = await run("agent: note-writer.platform@example.com", p);
  assert.equal(out.code, 0, out.reply);
  assert.equal(out.verdict, "usable", report);
  assert.deepEqual(out.offerings, [{ id: "write-a-note", form: "yes", delivers: "yes", readable: "yes", change: "yes" }]);
  const h = readHeader(report);
  assert.equal(h.usability_report, "v1");
  assert.equal(h.agent, "note-writer.platform@example.com");
  assert.equal(h.version, "1.2.0");
  assert.equal(h.package_digest, `sha256:${"a".repeat(64)}`);
  assert.match(h.descriptor_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(h.verdict, "usable");
  const run1 = p.calls.find((c) => c.path === "/v1/accounts/acct1/try");
  assert.equal(run1.body.to.startsWith("UAGENT"), true);
  assert.equal(run1.body.offering, "write-a-note");
  assert.match(run1.body.text, /^page: https:\/\/example\.com\/a\.html$/m);
  // The one input of words is the message itself, as the page sends it.
  assert.match(run1.body.text, /^Engineers new to the team\n\npage: /);
  const rev = p.calls.find((c) => c.path === "/v1/accounts/acct1/jobs/J1/revise");
  assert.deepEqual(rev.body.steps, ["write-a-note"]);
  assert.match(rev.body.text, /shorter/);
  const pieces = JSON.parse(readFileSync(join(f.job, "pieces.json"), "utf8"));
  assert.deepEqual(pieces.map((x) => [x.name, x.path, x.media_type, x.step]), [["usability report", "out/usability-report.md", "text/markdown", "write-the-report"]]);
  assert.match(report, /## Offerings\n\n\| Offering \| Started by \|/);
  assert.match(report, /## Not checked/);
  const rec = JSON.parse(readFileSync(join(f.records, "job-1", "test.json"), "utf8"));
  assert.equal(rec.account, "a fresh test account made for this job");
});

test("when the agent stops to ask, the tester answers once on the job and the run delivers", async () => {
  const p = fakePlatform({ ask: true });
  const { out, report } = await run("agent: note-writer.platform@example.com", p);
  assert.equal(out.verdict, "usable", report);
  const answers = p.calls.filter((c) => c.path === "/v1/accounts/acct1/try" && c.body.job);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].body.job, "ctx:1");
  assert.match(report, /It asked: "Who reads this note\?"/);
});

test("a change the agent will not take is an agent finding, and the verdict says so", async () => {
  const p = fakePlatform({ change: "refuse" });
  const { out, report } = await run("agent: note-writer.platform@example.com\nchange: Add a title.", p);
  assert.equal(out.verdict, "usable_with_findings", report);
  assert.equal(out.offerings[0].change, "no");
  const f = out.findings.find((x) => x.check === "change");
  assert.equal(f.label, "agent");
  assert.equal(f.fixed_by, "code");
  assert.match(f.what, /did not take the change "Add a title\."/);
});

test("a change that never comes back is reported after the wait", async () => {
  const p = fakePlatform({ change: "silent" });
  const { out } = await run("agent: note-writer.platform@example.com", p);
  assert.equal(out.offerings[0].change, "no");
  assert.match(out.findings.find((x) => x.check === "change").what, /no new version came back within 15 minutes/);
});

test("a known-bad agent: the descriptor findings, an example from the request, and JSON a person cannot read", async () => {
  const siteRead = JSON.stringify({ pages: [{ url: "https://example.com", text: "Example." }] });
  const digest = `sha256:${createHash("sha256").update(siteRead).digest("hex")}`;
  const p = fakePlatform({
    handle: "facts.platform@example.com", descriptor: badDescriptor(),
    pieces: [{ name: "facts", media_type: "application/json", step: "write-facts", text: JSON.stringify([{ fact: "Example is a company." }]) }],
    files: { "https://example.com/site-read.json": siteRead },
  });
  const examples = { "write-facts": { inputs: { "site-read": { url: "https://example.com/site-read.json", media_type: "application/json", digest } }, good_result: "Facts about Example, each with its quote." } };
  const { out, report } = await run("agent: facts.platform@example.com", p, { files: { "examples.json": examples } });
  assert.equal(out.code, 0, out.reply);
  assert.equal(out.verdict, "not_usable", report);
  assert.deepEqual(out.offerings[0], { id: "write-facts", form: "yes", delivers: "yes", readable: "no", change: "not offered" });
  const checks = new Set(out.findings.filter((x) => x.label === "descriptor").map((x) => x.check));
  for (const c of ["summary", "example", "inputs-to-controls", "options-settings", "presentation", "readable"]) assert.ok(checks.has(c), `${c} in ${[...checks]}`);
  assert.ok(out.findings.filter((x) => x.label === "descriptor").every((x) => x.fixed_by === "design"));
  assert.match(report, /\| Write facts \| not said \| given with the request \(the Descriptor declares none\) \|/);
  const tryCall = p.calls.find((c) => c.path === "/v1/accounts/acct1/try");
  assert.equal(tryCall.body.files[0].name, "site-read.json");
  assert.equal(tryCall.body.files[0].media_type, "application/json");
  assert.match(out.reply, /Descriptor \(fixed by design\)/);
});

test("an offering with no example anywhere is not run, and no account is made for it", async () => {
  const p = fakePlatform({ handle: "facts.platform@example.com", descriptor: badDescriptor() });
  const { out, report } = await run("agent: facts.platform@example.com", p);
  assert.equal(out.verdict, "not_usable");
  assert.deepEqual(out.offerings[0], { id: "write-facts", form: "not run", delivers: "not run", readable: "not run", change: "not run" });
  assert.equal(p.calls.some((c) => c.path === "/v1/operator/test-accounts"), false);
  assert.match(report, /none, in the Descriptor or with the request, so it was not run/);
});

test("a run the agent refuses delivers nothing, and that is an agent finding", async () => {
  const p = fakePlatform({ refuseRun: "I only read pages in French." });
  const { out } = await run("agent: note-writer.platform@example.com", p);
  assert.equal(out.verdict, "not_usable");
  assert.equal(out.offerings[0].delivers, "no");
  assert.match(out.findings.find((x) => x.check === "delivers").what, /refused the example: "I only read pages in French\."/);
});

test("without an agent named, or with one nobody answers to, nothing is tested", async () => {
  const p = fakePlatform();
  const a = await run("Please test something.", p);
  assert.equal(a.out.code, 3);
  assert.match(a.out.reply, /no agent was named/);
  const b = await run("agent: nobody.platform@example.com", p);
  assert.equal(b.out.code, 3);
  assert.match(b.out.reply, /No agent answers to nobody\.platform@example\.com/);
  const c = await run("agent: note-writer.platform@example.com", p, { env: { TEST_ACCOUNT_KEY: "k" } });
  assert.match(c.out.reply, /MESH_API_BASE/);
  const d = await run("agent: note-writer.platform@example.com\noffering: nope", p);
  assert.match(d.out.reply, /has no offering "nope"; it has write-a-note/);
});

test("without an account to run as, the job stops and says so", async () => {
  const p = fakePlatform();
  const { out } = await run("agent: note-writer.platform@example.com", p, { env: { MESH_API_BASE: BASE } });
  assert.equal(out.code, 3);
  assert.match(out.reply, /no test-account key \(TEST_ACCOUNT_KEY\)/);
});

test("a person's judgment is written in as theirs, and a change that only adds one runs nothing", async () => {
  const p = fakePlatform();
  const first = await run("agent: note-writer.platform@example.com", p);
  assert.match(first.report, /No person added a judgment/);
  const f = jobFolder("understood: yes\ncould use: no\nnote: The note was too long for me.");
  mkdirSync(join(f.job, "prior"), { recursive: true });
  writeFileSync(join(f.job, "prior", "manifest.json"), JSON.stringify({ pieces: [{ name: "usability report" }] }));
  writeFileSync(join(f.job, "prior", "usability report"), first.report);
  const p2 = fakePlatform();
  const out = await runJob(["--job", f.job, "--records", f.records, "--text-file", join(f.job, "message.txt")], ENV, { fetchImpl: p2.fetchImpl });
  assert.equal(out.code, 0, out.reply);
  assert.equal(p2.calls.length, 0);
  const report = readFileSync(join(f.job, "out", "usability-report.md"), "utf8");
  assert.match(report, /- Understood what it does: yes\n- Could use the result: no\n- It did the job: not said\n- Note: The note was too long for me\./);
  assert.equal(readHeader(report).person_judgment, "added");
  assert.equal(readHeader(report).verdict, "usable");
  assert.doesNotMatch(report, /A person adds it by asking for a change/);
});

test("a change whose earlier report did not come with it is refused before anything runs", async () => {
  const f = jobFolder("Test it again.");
  mkdirSync(join(f.job, "prior"), { recursive: true });
  writeFileSync(join(f.job, "prior", "manifest.json"), JSON.stringify({ pieces: [] }));
  const p = fakePlatform();
  const out = await runJob(["--job", f.job, "--records", f.records, "--text-file", join(f.job, "message.txt")], ENV, { fetchImpl: p.fetchImpl });
  assert.equal(out.code, 3);
  assert.match(out.reply, /earlier usability report did not come with this change/);
  assert.equal(p.calls.length, 0);
});

test("a change that is not a judgment tests the agent again from the earlier report", async () => {
  const p = fakePlatform();
  const first = await run("agent: note-writer.platform@example.com", p);
  const f = jobFolder("Please make it greener.");
  mkdirSync(join(f.job, "prior"), { recursive: true });
  writeFileSync(join(f.job, "prior", "manifest.json"), JSON.stringify({ pieces: [{ name: "usability report" }] }));
  writeFileSync(join(f.job, "prior", "usability report"), first.report);
  const p2 = fakePlatform();
  const v = virtual();
  const out = await runJob(["--job", f.job, "--records", f.records, "--text-file", join(f.job, "message.txt")], ENV, { fetchImpl: p2.fetchImpl, ...v });
  assert.equal(out.code, 0, out.reply);
  assert.equal(out.agent, "note-writer.platform@example.com");
  assert.match(out.reply, /these words I could not act on otherwise: "Please make it greener\."/);
  assert.ok(p2.calls.some((c) => c.path === "/v1/accounts/acct1/try"));
});

test("settings come from the run context: one outside its choices is refused, and no change is asked when told not to", async () => {
  const p = fakePlatform();
  const bad = await run("agent: note-writer.platform@example.com", p, { files: { "run-context.json": { "run-context": "v2", run_config: { settings: { ask_for_a_change: "maybe" } } } } });
  assert.equal(bad.out.code, 3);
  assert.match(bad.out.reply, /^RUN_CONFIG_REFUSED: not_allowed/);
  const p2 = fakePlatform();
  const ok = await run("agent: note-writer.platform@example.com", p2, { files: { "run-context.json": { "run-context": "v2", run_config: { settings: { ask_for_a_change: "no", wait_minutes: 5 } } } } });
  assert.equal(ok.out.code, 0, ok.out.reply);
  assert.equal(ok.out.offerings[0].change, "not tried");
  assert.equal(p2.calls.some((c) => /revise$/.test(c.path)), false);
  assert.deepEqual(ok.out.settings, { wait_minutes: 5, ask_for_a_change: "no" });
});

test("an agent that delivers a page instead of the Markdown it declares is caught", async () => {
  const p = fakePlatform({ pieces: [{ name: "note", media_type: "text/markdown", step: "write-a-note", text: "<!doctype html><html><body><p>A note.</p></body></html>" }] });
  const { out } = await run("agent: note-writer.platform@example.com", p);
  assert.equal(out.verdict, "not_usable");
  const f = out.findings.find((x) => x.check === "delivers");
  assert.equal(f.label, "agent");
  assert.match(f.what, /it is an HTML page, not Markdown/);
});

test("the descriptor's own example is preferred to one given with the request", async () => {
  const p = fakePlatform({ descriptor: goodDescriptor() });
  const { out, report } = await run("agent: note-writer.platform@example.com", p, { files: { "examples.json": { "write-a-note": { inputs: { page: "https://other.example/b.html" }, good_result: "x" } } } });
  assert.equal(out.verdict, "usable");
  assert.match(report, /\| Write a note \| person and agent \| the Descriptor's \|/);
  assert.match(p.calls.find((c) => c.path === "/v1/accounts/acct1/try").body.text, /example\.com\/a\.html/);
});

test("when the agent answers with a question in place of the result, a person replies yes once and the job is followed on", async () => {
  const p = fakePlatform({ answerFirst: "Here are the concepts the quiz will test. Reply yes to have the questions written." });
  const { out, report } = await run("agent: note-writer.platform@example.com", p);
  assert.equal(out.verdict, "usable", report);
  const answers = p.calls.filter((c) => c.path === "/v1/accounts/acct1/try" && c.body.job);
  assert.equal(answers.length, 1);
  assert.match(answers[0].body.text, /^Yes, go ahead/);
  assert.match(report, /It asked: "Here are the concepts/);
});

test("an answer in words that asks nothing is where the job stands", async () => {
  const p = fakePlatform({ answerFirst: "I read the page and there is nothing to write about." });
  const { out } = await run("agent: note-writer.platform@example.com", p);
  assert.equal(out.offerings[0].delivers, "no");
  assert.equal(p.calls.filter((c) => c.path === "/v1/accounts/acct1/try" && c.body.job).length, 0);
});

test("an offering other agents usually start is run too, its inputs given as files of their kinds; without an example it is a descriptor finding", async () => {
  const d = goodDescriptor();
  const o = d.offerings[0];
  o.started_by = ["agent"];
  o.inputs = [{ name: "site-read", kind: "application/vnd.x.site-read+json", required: true, given_by: "agent", about: "Another agent's read of a site." }];
  o.example = { inputs: { "site-read": "{\"pages\":[]}" }, good_result: "A note about the site." };
  const p = fakePlatform({ descriptor: d });
  const { out, report } = await run("agent: note-writer.platform@example.com", p);
  assert.equal(out.offerings[0].delivers, "yes", report);
  const sent = p.calls.find((c) => c.path === "/v1/accounts/acct1/try" && !c.body.job).body;
  assert.deepEqual([sent.files[0].name, sent.files[0].media_type], ["site-read.json", "application/vnd.x.site-read+json"]);
  assert.match(report, /| Write a note | agent |/);
  delete o.example;
  const p2 = fakePlatform({ descriptor: d });
  const none = await run("agent: note-writer.platform@example.com", p2);
  assert.equal(none.out.verdict, "not_usable");
  const f = none.out.findings.find((x) => x.check === "example");
  assert.equal(f.label, "descriptor");
});
