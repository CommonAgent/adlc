// Reviewing a process document (security-reviewer 0.3.0, review-a-process):
// the ADLC builds processes, and the Security stage of a build whose artifact
// is a process holds the document to the process rules
// (scripts/process-rules.mjs, standards' byte for byte). A phase that acts in
// the world (sends outside, posts, publishes, pays or signs) with no person's
// yes before it refuses the document, and so does an extension line that
// changes the work; a gate whose document gives no reason is flagged under No
// reason recorded. The review is the agent's own security-review-v1, with no
// model asked.
//   node --test test/process-review.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT, frontMatter, host, run } from "./helpers.mjs";
import { processAmong, processAssessment, processReviewMarkdown } from "../scripts/review-process.mjs";

const PLANTED = `PROCESS: competitor blog digest   id: acme/competitor-blog-digest   v1
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
policy:
  nothing is posted that names a person outside the company
measures:
  quality gate: no summary is posted that the head of marketing did not
    approve
`;
const GATED = PLANTED.replace("after: draft-summary   automation: autonomous", "after: approve-summary   automation: autonomous")
  .replace("draft-summary -> approve-summary / post-publicly [summary]: the summary", "draft-summary -> approve-summary [summary]: the summary\n  approve-summary -> post-publicly [approved-summary]: the summary as\n    approved");
const files = (doc) => [{ name: "competitor-blog-digest.process.txt", bytes: Buffer.from(doc), type: "text/plain" }];

test("a process document is found by its content, attached or in the message", () => {
  assert.equal(processAmong([], PLANTED).name, "the message");
  assert.equal(processAmong([], "Please review this package.\nspending limit: 3 USD per day\n"), null);
  // The name the host puts on an attached file (a hop number and an id) is not the document's name.
  const dir = mkdtempSync(join(tmpdir(), "sr-process-"));
  const hopped = join(dir, "0-k8oY7cpg-competitor-blog-digest.process.txt");
  writeFileSync(hopped, PLANTED);
  assert.equal(processAmong([{ path: hopped }], "").name, "competitor-blog-digest.process.txt");
});

test("the planted problem refuses the process: a step that posts publicly with no person's yes before it", () => {
  const a = processAssessment(PLANTED);
  assert.equal(a.verdict, "refused");
  assert.equal(a.refusals.length, 1);
  assert.match(a.refusals[0], /post-publicly acts in the world \(it posts/);
  assert.match(a.refusals[0], /line 19/);
  // The gate the run never waits on has no recorded reason.
  assert.deepEqual(a.unreasoned.map((u) => [u.permission, u.asked_in]), [["approve-summary signed by a person on every run (never)", "line 15"]]);
  assert.deepEqual(a.reaches.map((r) => [r.system, r.access]), [["the company's X account", "write"]]);
  assert.deepEqual(a.acting.map((x) => [x.phase, x.how, x.gated]), [["post-publicly", "posts", false]]);
  const g = processAssessment(GATED);
  assert.equal(g.verdict, "passed");
  assert.deepEqual(g.refusals, []);
  assert.ok(g.accepted.some((x) => /post-publicly posts, after approve-summary/.test(x)));
});

test("an extension line that skips an approval refuses the process too", () => {
  const a = processAssessment(GATED + "extensions:\n  example.org/ext/fast v1\n    approve-summary: skip on the second run\n");
  assert.equal(a.verdict, "refused");
  assert.match(a.refusals[0], /changes the work/);
});

test("the review is the agent's own security-review-v1, header and headings", () => {
  const md = processReviewMarkdown({ a: processAssessment(PLANTED), file: "competitor-blog-digest.process.txt", reviewedAt: "2026-11-01T15:00:00Z" });
  const fm = frontMatter(md);
  assert.equal(fm.review, "security-review-v1");
  assert.equal(fm.package, "acme/competitor-blog-digest");
  assert.equal(fm.version, "v1");
  assert.match(fm.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fm.verdict, "refused");
  assert.equal(fm.reaches[0].system, "the company's X account");
  assert.equal(fm.refused_for.length, 1);
  assert.equal(fm.no_reason_recorded[0].permission, "approve-summary signed by a person on every run (never)");
  assert.ok(fm.never_does.some((n) => /names a person outside the company/.test(n.act)));
  for (const h of ["Verdict", "Reaches", "Spends", "Never does", "No reason recorded", "Programs", "Parts", "Accepted knowingly", "Reasons weighed", "Not reviewed"]) assert.match(md, new RegExp(`^## ${h}$`, "m"), h);
  assert.match(md, /\*\*Refused\.\*\*/);
  assert.match(md, /\| post-publicly \| posts \| no person's yes before it \|/);
});

test("the job reviews an attached process with no model and files the review as its one piece", () => {
  const h = host();
  const r = run(h, { message: "Review this process before it is installed.", files: files(PLANTED) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.doc.verdict, "refused", r.doc.reply);
  assert.match(r.doc.reply, /^I reviewed the process acme\/competitor-blog-digest v1 and it does not pass/);
  assert.match(r.doc.reply, /post-publicly/);
  assert.equal(frontMatter(r.review).verdict, "refused");
  const pieces = JSON.parse(readFileSync(join(r.jobDir, "pieces.json"), "utf8"));
  assert.deepEqual(pieces.map((p) => [p.name, p.media_type]), [["security review", "text/markdown"]]);
  const ok = run(h, { id: "job-2", message: "Review this process.", files: files(GATED) });
  assert.equal(ok.doc.verdict, "passed", ok.doc.reply);
});

test("the package declares review-a-process and carries the rules and the checker byte for byte", () => {
  const d = JSON.parse(readFileSync(join(AGENT, "agent-descriptor.json"), "utf8"));
  const p = JSON.parse(readFileSync(join(AGENT, "plugin.json"), "utf8"));
  const o = d.offerings.find((x) => x.id === "review-a-process");
  assert.ok(o);
  assert.deepEqual(o.steps.map((s) => s.id), ["read-the-process", "check-the-process-rules"]);
  assert.ok([o, ...o.steps].every((s) => s.how.intelligence === "none"));
  const skills = p.extensions["net.agentdoc.package"].build.skills;
  for (const f of ["scripts/review-process.mjs", "scripts/process-rules.mjs", "scripts/process-check.mjs"]) {
    assert.ok(skills["review-a-package"].scripts.includes(f), `${f}: the job command (review-a-package's) routes a process here`);
    assert.ok(skills["review-a-process"].scripts.includes(f), f);
  }
  for (const f of ["process-rules.mjs", "process-check.mjs"]) {
    assert.ok(readFileSync(join(AGENT, "scripts", f)).equals(readFileSync(join(AGENT, "..", "..", "standards", f))), `scripts/${f} differs from standards/${f}`);
  }
});
