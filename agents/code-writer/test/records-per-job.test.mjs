// Whoever writes the scripts is told how a per-job record is written
// (technical debt 639, 2026-10-31).
//   node --test test/records-per-job.test.mjs
//
// What is worth pinning. The host hands every job of an agent the same
// records folder, the agent's own, and keeps it from one job to the next. A
// record the declaration keeps per job (a file pattern such as
// `*/went-without.json`) belongs under a folder named after the job folder,
// join(RECORDS, basename(JOB_DIR)). Three agents built on dev wrote it
// straight into the records folder, so each job overwrote the last. The code
// writer's harness reads the house-stack reference and rules.md, and an
// outside coding agent reads only the hand-off's AGENTS.md, so all three say
// it in the same words, and name the suite's check that holds them to it.
//
// Nothing here runs a job, a model or a network; it reads the package's own
// files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, "..", rel), "utf8").replace(/\r\n/g, "\n");
const flat = (text) => text.replace(/\s+/g, " ");

const FILES = {
  "the hand-off's AGENTS.md": "references/agents-md-template.md",
  "the house-stack reference": "references/what-the-house-stack-is.md",
  "rules.md": "rules.md",
};

for (const [who, rel] of Object.entries(FILES)) {
  test(`${who} says every job shares the agent's own records folder`, () => {
    assert.match(flat(read(rel)), /same records folder, the agent's own/);
  });

  test(`${who} says a per-job record goes under a folder named after the job folder`, () => {
    const text = flat(read(rel));
    assert.match(text, /join\(RECORDS, basename\(JOB_DIR\)\)/);
    assert.match(text, /\*\/went-without\.json/);
    assert.match(text, /never straight into the records folder/);
  });

  test(`${who} names the suite's check that holds two jobs to their own records`, () => {
    assert.match(flat(read(rel)), /test\/records-per-job\.test\.mjs/);
  });
}

test("the hand-off's AGENTS.md still carries the three fields the hand-off fills in", () => {
  const t = read(FILES["the hand-off's AGENTS.md"]);
  for (const f of ["{{name}}", "{{version}}", "{{scripts}}"]) assert.ok(t.includes(f), `${f} is missing`);
});
