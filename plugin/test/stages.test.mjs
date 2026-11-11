// The check and the person's word at Requirements, on the Hacker News digest.
// The approved spec has its refusals and no empty or failure case, so the
// check holds it on those two; with both stated it waits on the person, their
// approval pins the spec, a pin that moves stops the check, and sending the
// build back takes the pins off.
//
//   node --test plugin/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFolder } from "../kit/check.mjs";
import { approve, sendBackTo } from "../kit/approve.mjs";
import { coverageProblems, lockOf, ownerOf, stageOf } from "../kit/stages.mjs";

const AT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hn-digest");
const spec = JSON.parse(readFileSync(join(AT, "spec.json"), "utf8"));

/** The digest's spec with the empty case and the failure case stated. */
function complete() {
  const s = structuredClone(spec);
  const f = s.features[0];
  f.requirements.push(
    { id: "F1.R7", shall: "The agent shall say in one sentence that no top story is about the topic when none is, and list nothing.", kind: "behavior", priority: "must", source: { said: "the ones about a topic the caller names" }, verify: "test" },
    { id: "F1.R8", shall: "The agent shall stop and say that Hacker News could not be read when the API fails, and write no digest.", kind: "error", priority: "must", source: { said: "Writing about stories it did not read from Hacker News" }, verify: "test" },
  );
  f.acceptance.push(
    { id: "F1.A3", gherkin: "Scenario: No story is about the topic\n  Given a topic no top story is about\n  When the agent reads the current top stories on Hacker News\n  Then it says in one sentence that none is about the topic", checks: ["F1.R7"] },
    { id: "F1.A4", gherkin: "Scenario: Hacker News cannot be read\n  Given the Hacker News API fails\n  When the agent tries to read the top stories\n  Then it says Hacker News could not be read and writes no digest", checks: ["F1.R8"] },
  );
  return s;
}

function folder(s = spec) {
  const dir = mkdtempSync(join(tmpdir(), "adlc-stages-"));
  writeFileSync(join(dir, "spec.json"), JSON.stringify(s, null, 2) + "\n");
  copyFileSync(join(AT, "request.md"), join(dir, "request.md"));
  writeFileSync(join(dir, "answers.json"), JSON.stringify({ name: "hn-digest", price: "Free" }) + "\n");
  return dir;
}

test("the approved digest spec is held on its empty case and its failure case, and on nothing else", async () => {
  const dir = folder();
  try {
    const r = await checkFolder(dir);
    assert.equal(r.stage, "requirements");
    assert.equal(r.code, 1);
    assert.equal(r.problems.length, 2);
    assert.match(r.problems[0], /^the empty case is not stated/);
    assert.match(r.problems[1], /^the failure case is not stated/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a requirement no scenario checks is named", () => {
  const s = complete();
  s.features[0].acceptance.pop();
  assert.deepEqual(coverageProblems(s), ["requirement F1.R8 is checked by no scenario; every requirement has a scenario a test can be written from"]);
});

test("a spec the check passes waits on the person, and the person's approval pins it", async () => {
  const dir = folder(complete());
  try {
    const waiting = await checkFolder(dir);
    assert.equal(waiting.code, 4);
    assert.equal(waiting.waiting, true);
    assert.equal(stageOf(lockOf(dir)), "requirements");
    const ok = await approve(dir);
    assert.equal(ok.code, 0);
    const lock = lockOf(dir);
    assert.deepEqual(Object.keys(lock.digests), ["request.md", "spec.json"]);
    assert.equal(lock.gates.requirements.by, "the person");
    assert.equal(stageOf(lock), "architecture");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a spec the check holds is not approved", async () => {
  const dir = folder();
  try {
    const r = await approve(dir);
    assert.equal(r.code, 1);
    assert.equal(lockOf(dir).gates.requirements, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a pinned file that moves stops the check, and sending back takes the pins off", async () => {
  const dir = folder(complete());
  try {
    await approve(dir);
    appendFileSync(join(dir, "spec.json"), " ");
    const moved = await checkFolder(dir);
    assert.equal(moved.code, 3);
    assert.match(moved.problems[0], /^spec\.json is pinned and changed/);
    assert.equal(sendBackTo(dir, "requirements").code, 0);
    const lock = lockOf(dir);
    assert.deepEqual(lock.digests, {});
    assert.deepEqual(lock.gates, {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("each pinned path belongs to the stage that wrote it", () => {
  assert.equal(ownerOf("spec.json"), "requirements");
  assert.equal(ownerOf("architecture-record.md"), "architecture");
  assert.equal(ownerOf("skills/topic-digest/SKILL.md"), "files");
  assert.equal(ownerOf("test/f1.test.mjs"), "test");
  assert.equal(ownerOf("scripts/topic-digest.mjs"), null);
});
