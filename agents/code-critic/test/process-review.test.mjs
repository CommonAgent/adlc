// Reviewing a process document (code-critic 0.3.0, review-a-process): the
// ADLC builds processes, and a build whose artifact is a process is reviewed
// against the process rules (scripts/process-rules.mjs, standards'
// byte for byte): the four tests of Agent Processes 0.9.2 §20.1, which phases
// a person signs and whether the document says why, which phases act in the
// world and whether a person signs before each, and no line outside the
// extensions: block. The findings come in the critic's own format, and no
// model is called.
//   node --test test/process-review.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runJob } from "../scripts/job.mjs";
import { processAmong, processFindings, processFindingsDocument } from "../scripts/process-review.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const descriptor = JSON.parse(readFileSync(join(ROOT, "agent-descriptor.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));

/** A digest process with a planted problem: the step that posts publicly comes straight after the draft, with no person's yes. */
export const PLANTED = `PROCESS: competitor blog digest   id: acme/competitor-blog-digest   v1
owner: head of marketing   effective: 2026-11-01
trigger: the morning's scheduled hour arrives
concurrency: runs do not overlap
goal: an approved summary of competitor blog updates, posted on the
      company's public page
phases:
  read-the-blogs  - harness: an extract of recent posts from three
                    competitor blogs
                    owner: blog-reader
                    after: trigger   automation: autonomous
  draft-summary   - harness: a one-page summary of what changed
                    owner: summary-writer
                    after: read-the-blogs   automation: autonomous
  approve-summary - human: the head of marketing approves the summary,
                    asks for changes, or rejects it
                    owner: head of marketing (person)
                    after: draft-summary   automation: never
  post-publicly   - harness: the summary posted publicly on the
                    company's X account
                    owner: poster
                    after: draft-summary   automation: autonomous
handoffs:
  read-the-blogs -> draft-summary [extracts]: the extracts
  draft-summary -> approve-summary / post-publicly [summary]: the summary
deviations:
  approve-summary -> draft-summary [changes]: the head of marketing says
    what is wrong
bindings:
  roster: blog-reader, summary-writer and poster are agents
  systems: the company's X account (write)
  data: the three blogs' addresses
measures:
  quality gate: no summary is posted that the head of marketing did not
    approve
`;

const GATED = PLANTED.replace("after: draft-summary   automation: autonomous", "after: approve-summary   automation: autonomous")
  .replace("draft-summary -> approve-summary / post-publicly [summary]: the summary", "draft-summary -> approve-summary [summary]: the summary\n  approve-summary -> post-publicly [approved-summary]: the summary as\n    approved");

function setUp(doc, name = "competitor-blog-digest.process.txt") {
  const dir = mkdtempSync(join(tmpdir(), "cc-process-"));
  const file = join(dir, name);
  writeFileSync(file, doc);
  const msg = join(dir, "message.txt");
  writeFileSync(msg, "Review this process before it is wired.");
  return { dir, file, msg, job: join(dir, "job-1"), records: join(dir, "records"), work: join(dir, "work") };
}
const noModel = async () => { throw new Error("no model is called for a process"); };

test("a process document attached is found by its content, and nothing else is", () => {
  const s = setUp(PLANTED);
  const found = processAmong([{ path: s.file, media_type: "text/plain" }], "");
  assert.equal(found.name, "competitor-blog-digest.process.txt");
  assert.match(found.text, /^PROCESS: competitor blog digest/);
  assert.equal(processAmong([], "please review"), null);
  // The name the host puts on an attached file (a hop number and an id) is not the document's name.
  const hopped = setUp(PLANTED, "0-A23KdF0A-competitor-blog-digest.process.txt");
  assert.equal(processAmong([{ path: hopped.file, media_type: "text/vnd.agentprocesses.process" }], "").name, "competitor-blog-digest.process.txt");
  assert.equal(processAmong([], PLANTED).name, "the message");
});

test("the planted problem is a finding: the step that posts publicly with no person's yes before it", () => {
  const r = processFindings(PLANTED, "competitor-blog-digest.process.txt");
  const f = r.findings.find((x) => x.rule === "acts-in-the-world");
  assert.ok(f, JSON.stringify(r.findings));
  assert.deepEqual(f.place, { file: "competitor-blog-digest.process.txt", line: 19 });
  assert.match(f.claim, /post-publicly acts in the world \(it posts/);
  assert.match(f.consequence, /nobody having said yes/);
  assert.equal(f.source, "house rule");
  // The gate the run never waits on is a finding of its own.
  assert.ok(r.findings.some((x) => x.rule === "approval-level" && x.place.line === 15));
  assert.deepEqual(processFindings(GATED, "x.process.txt").findings, []);
});

test("the findings are written in the critic's own format, each with a place, a rule, a claim, a consequence and an Answer line", () => {
  const r = processFindings(PLANTED, "competitor-blog-digest.process.txt");
  const doc = processFindingsDocument({ ...r, file: "competitor-blog-digest.process.txt", version: "0.3.0", now: "2026-11-01T15:00:00Z" });
  assert.match(doc, /^# Review of acme\/competitor-blog-digest v1\n/);
  assert.match(doc, /^- package: acme\/competitor-blog-digest v1$/m);
  assert.match(doc, /^- change: the process document competitor-blog-digest\.process\.txt \(shape sha256:[0-9a-f]{64}\)$/m);
  assert.match(doc, /^- findings: 2$/m);
  assert.match(doc, /^- open: 2$/m);
  assert.match(doc, /^- reviewed_by: code-critic 0\.3\.0$/m);
  assert.match(doc, /^### F1\. post-publicly acts in the world/m);
  assert.match(doc, /^- Place: `competitor-blog-digest\.process\.txt:19`$/m);
  assert.match(doc, /^- Rule: acts-in-the-world \(Agent Processes §21\.3 and §7\.1/m);
  assert.match(doc, /^- Answer: open$/m);
  for (const h of ["## Findings", "## Warnings", "## Answers to the earlier review", "## Outside the change", "## Not reviewed", "## How to answer"]) assert.ok(doc.includes(`\n${h}\n`), h);
  assert.match(doc, /## Signed and acting\n/);
  assert.match(doc, /post-publicly posts, with no person's yes before it/);
});

test("the job reviews a process document with no model, files the findings as its one piece, and says what it found", async () => {
  const s = setUp(PLANTED);
  const out = await runJob({ job: s.job, records: s.records, work: s.work, files: [{ path: s.file, media_type: "text/plain" }], textFile: s.msg, env: {}, call: noModel, now: () => "2026-11-01T15:00:00Z" });
  assert.equal(out.ok, true, out.reply);
  assert.equal(out.findings, 2);
  assert.match(out.reply, /^Reviewed the process acme\/competitor-blog-digest v1: 2 findings, 2 open\./);
  assert.match(out.reply, /post-publicly/);
  const pieces = JSON.parse(readFileSync(join(s.job, "pieces.json"), "utf8"));
  assert.equal(pieces.length, 1);
  const offering = descriptor.offerings.find((o) => o.id === "review-a-process");
  assert.ok(offering.outputs.some((o) => o.name === pieces[0].name && o.kind === pieces[0].media_type));
  assert.ok(offering.steps.some((st) => st.id === pieces[0].step));
  assert.match(readFileSync(join(s.job, pieces[0].path), "utf8"), /^# Review of acme\/competitor-blog-digest v1/);
  const rec = JSON.parse(readFileSync(join(s.records, "job-1", "process-review.json"), "utf8"));
  assert.equal(rec.process_review, "v1");
  assert.equal(rec.findings.length, 2);
});

test("sending the findings back with a reason closes that finding", async () => {
  const s = setUp(PLANTED);
  await runJob({ job: s.job, records: s.records, work: s.work, files: [{ path: s.file, media_type: "text/plain" }], textFile: s.msg, env: {}, call: noModel });
  const first = readFileSync(join(s.job, "out", "findings.md"), "utf8");
  const answered = first.replace(/(### F2\.[\s\S]*?- Answer: )open/, "$1the head of marketing signs because a public post cannot be taken back");
  const back = join(s.dir, "findings.md");
  writeFileSync(back, answered);
  const s2 = { ...s, job: join(s.dir, "job-2") };
  const out = await runJob({ job: s2.job, records: s.records, work: s.work, files: [{ path: s.file, media_type: "text/plain" }, { path: back, media_type: "text/markdown" }], textFile: s.msg, env: {}, call: noModel });
  assert.equal(out.findings, 2);
  assert.match(out.reply, /2 findings, 1 open/);
});

test("the package declares review-a-process, with its skills, and carries the rules and the checker byte for byte", () => {
  const o = descriptor.offerings.find((x) => x.id === "review-a-process");
  assert.ok(o);
  assert.deepEqual(o.steps.map((s) => s.id), ["read-the-process", "check-the-process-rules"]);
  assert.ok(o.steps.every((s) => s.how.intelligence === "none"));
  assert.equal(o.inputs[0].kind, "text/vnd.agentprocesses.process");
  const skills = manifest.extensions["net.agentdoc.package"].build.skills;
  for (const f of ["scripts/process-review.mjs", "scripts/process-rules.mjs", "scripts/process-check.mjs"]) {
    assert.ok(skills["review-a-change"].scripts.includes(f), `${f}: the job command (review-a-change's) routes a process here, so its skill carries it`);
    assert.ok(skills["review-a-process"].scripts.includes(f), f);
  }
  for (const f of ["process-rules.mjs", "process-check.mjs"]) {
    const mine = readFileSync(join(ROOT, "scripts", f));
    const theirs = readFileSync(join(ROOT, "..", "..", "standards", f));
    assert.ok(mine.equals(theirs), `scripts/${f} differs from standards/${f}: copy it again`);
  }
});
