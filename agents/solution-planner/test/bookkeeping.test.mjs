// The two shared scripts keep the record of what a job went without, and the
// list of pieces a job filed.
//
// What is worth pinning: went-without.mjs exports exactly the names every
// package shares (FILE, fileIn, note, read, sentence, paragraph); a note is
// appended and returned, a missing file reads as no entries, one sentence is
// made over the entries and "" over none, and the paragraph is that sentence
// over what the records folder holds; pieces.mjs is reached through the
// package's own job (the plan test reads the pieces.json it wrote), and here
// only its fixed exports are checked to be there.
// Nothing here touches anything outside a temporary folder.
// Run: node --test test/bookkeeping.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE, fileIn, note, paragraph, read, sentence } from "../scripts/went-without.mjs";
import * as pieces from "../scripts/pieces.mjs";

function records(body) {
  const at = mkdtempSync(join(tmpdir(), "planner-ww-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
}

test("the record file is went-without.json and it lives under the records folder", () => {
  assert.equal(FILE, "went-without.json");
  assert.equal(fileIn("/r/job1"), join("/r/job1", "went-without.json"));
});

test("a records folder with no went-without file reads as nothing gone without", () => {
  records((at) => {
    assert.deepEqual(read(at), []);
    assert.equal(paragraph(at), "");
  });
});

test("a note is appended to the record, returned, and read back in order", () => {
  records((at) => {
    const first = note(at, { wanted: "the descriptor of broken.platform@agentmesh.ai", did: "left it with no offerings", why: "it answered 500" });
    assert.equal(first.wanted, "the descriptor of broken.platform@agentmesh.ai");
    assert.equal(first.did, "left it with no offerings");
    assert.equal(first.why, "it answered 500");
    note(at, { wanted: "step s3 as an existing agent", did: "made it new", why: "the handle is not in the catalog" });
    assert.ok(existsSync(fileIn(at)));
    assert.deepEqual(read(at).map((e) => e.wanted), [
      "the descriptor of broken.platform@agentmesh.ai",
      "step s3 as an existing agent",
    ]);
  });
});

test("one sentence is made over the entries, and none over no entries", () => {
  assert.equal(sentence([]), "");
  const said = sentence([{ wanted: "a descriptor", did: "went without it", why: "it timed out" }]);
  assert.equal(typeof said, "string");
  assert.ok(said.length > 0);
  assert.equal(said.includes("\n"), false);
});

test("the paragraph is the sentence over what the records folder holds", () => {
  records((at) => {
    note(at, { wanted: "a descriptor", did: "went without it", why: "it timed out" });
    assert.equal(paragraph(at), sentence(read(at)));
    assert.notEqual(paragraph(at), "");
  });
});

test("the pieces script offers the fixed names every package shares", () => {
  assert.equal(typeof pieces.STEP_OF, "object");
  assert.equal(typeof pieces.aboutOf, "function");
  assert.equal(typeof pieces.plan, "function");
  assert.equal(typeof pieces.fill, "function");
});
