// Filing pieces and recording omissions for security review jobs.
//
// What is worth pinning: pieces.mjs files pieces under the job out directory
// and records pieces.json matching declared formats; went-without.mjs notes
// missing items and renders summaries without error; every delivered piece
// matches its declared format in agent-descriptor.json.
// Nothing here touches a network or calls an external service.
// Run: node --test test/delivery.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE, fileIn, note, paragraph, read, sentence } from "../scripts/went-without.mjs";
import { aboutOf, fill, plan, STEP_OF } from "../scripts/pieces.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

function withJob(fn) {
  const at = mkdtempSync(join(tmpdir(), "reviewer-delivery-"));
  const dirs = {
    root: at,
    records: join(at, "records", "job1"),
    job: join(at, "job"),
  };
  mkdirSync(dirs.records, { recursive: true });
  mkdirSync(join(dirs.job, "out"), { recursive: true });
  try {
    return fn(dirs);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

test("went-without notes missing items and formats summaries", () => {
  withJob(({ records }) => {
    assert.equal(FILE, "went-without.json");
    assert.equal(fileIn(records), join(records, "went-without.json"));
    assert.deepEqual(read(records), []);

    note(records, {
      wanted: "a model to weigh the reasons",
      did: "went ahead without judging the recorded reasons",
      why: "no model was configured",
    });

    const entries = read(records);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].wanted, "a model to weigh the reasons");

    const sent = sentence(entries);
    assert.match(sent, /went ahead without/);
    assert.equal(paragraph(records), sent);
  });
});

test("pieces plans and files the review and matches declared formats", () => {
  withJob(({ records, job }) => {
    const reviewContent = [
      "---",
      "review: security-review-v1",
      "package: demo",
      "version: 1.0.0",
      "digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "verdict: passed",
      "reviewed_at: 2026-09-14T00:00:00Z",
      "architecture_record: absent",
      "spending_limit: none set",
      "reaches: []",
      "spends: []",
      "never_does: []",
      "no_reason_recorded: []",
      "refused_for: []",
      "warnings: []",
      "---",
      "",
      "## Verdict",
      "Passed.",
      "",
      "## Reaches",
      "None.",
      "",
      "## Spends",
      "None.",
      "",
      "## Never does",
      "None.",
      "",
      "## No reason recorded",
      "None.",
      "",
      "## Programs",
      "None.",
      "",
      "## Parts",
      "None.",
      "",
      "## Accepted knowingly",
      "None.",
      "",
      "## Reasons weighed",
      "None.",
      "",
      "## Not reviewed",
      "None.",
    ].join("\n");

    const reviewFile = join(records, "security-review.md");
    writeFileSync(reviewFile, reviewContent);

    const planned = plan({ reviewFile });
    assert.equal(planned.length, 1);
    assert.equal(planned[0].name, "security review");

    fill(job, {
      entries: planned,
      copies: [{ from: reviewFile, to: "security-review.md" }],
    });

    assert.ok(existsSync(join(job, "pieces.json")));
    assert.ok(existsSync(join(job, "out", "security-review.md")));
    assert.deepEqual(checkDelivered(job), []);
  });
});

test("step_of attributes each delivered piece to its declaring step", () => {
  assert.equal(STEP_OF["security review"], "write-the-review");
  const about = aboutOf("Security review report", "security-review.md");
  assert.ok(about.length > 0);
});
