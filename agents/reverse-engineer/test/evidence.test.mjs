// Checking the evidence: a claim is delivered only with a file and line that
// exist at the commit (or the observed run, when there was one); a claim that
// judges or infers is held back; on drift a claim must touch a changed line.
//   node --test test/evidence.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClaims, checkEvidence, contextFor, readEvidence } from "../scripts/evidence.mjs";

const FILES = {
  "src/a.js": "one\ntwo\nthree\nfour\n",
  "src/b.js": "only line",
};
const read = (f) => FILES[f] ?? null;
const ctx = (more = {}) => contextFor({ files: Object.keys(FILES), read, ...more });
const label = (c) => c.name;

test("evidence is read from the forms a draft writes", () => {
  assert.deepEqual(readEvidence("src/a.js:2"), { file: "src/a.js", line: 2 });
  assert.deepEqual(readEvidence("src/a.js:2-3"), { file: "src/a.js", line: 2, end_line: 3 });
  assert.deepEqual(readEvidence({ file: "./src\\a.js", line: "4" }), { file: "src/a.js", line: 4 });
  assert.deepEqual(readEvidence({ run: true }), { run: "baseline" });
  assert.ok("unreadable" in readEvidence("somewhere in the code"));
});

test("a line that exists checks; a line past the end, a missing file or a path outside does not", () => {
  const { kept, failed } = checkEvidence([
    { file: "src/a.js", line: 4 },
    { file: "src/a.js", line: 2, end_line: 4 },
    { file: "src/b.js", line: 1 },
    { file: "src/a.js", line: 5 },
    { file: "src/a.js", line: 3, end_line: 9 },
    { file: "src/a.js", line: 3, end_line: 2 },
    { file: "src/missing.js", line: 1 },
    { file: "../etc/passwd", line: 1 },
    { file: "src/a.js" },
  ], ctx());
  assert.equal(kept.length, 3);
  assert.equal(failed.length, 6);
  assert.match(failed[0].why, /past the end of src\/a\.js, which has 4 lines/);
  assert.match(failed[1].why, /runs past the end/);
  assert.match(failed[2].why, /ends before it starts/);
  assert.match(failed[3].why, /not a file of the codebase at this commit/);
  assert.match(failed[4].why, /not a path inside the codebase/);
  assert.match(failed[5].why, /names no line/);
});

test("the observed run is evidence only when the code ran", () => {
  assert.equal(checkEvidence([{ run: "baseline" }], ctx({ ran: false })).kept.length, 0);
  assert.equal(checkEvidence([{ run: "baseline" }], ctx({ ran: true })).kept.length, 1);
});

test("a claim with no evidence that checks is not delivered, and is a gap saying why", () => {
  const { kept, gaps } = checkClaims([
    { name: "Counts lines", does: "Counts the lines.", evidence: ["src/a.js:1-4"] },
    { name: "Sends mail", does: "Sends a mail.", evidence: ["src/a.js:40"] },
    { name: "Logs", does: "Logs each call." },
  ], ctx(), { part: "behaviors", label });
  assert.deepEqual(kept.map((k) => k.name), ["Counts lines"]);
  assert.deepEqual(gaps.map((g) => [g.kind, g.about]), [["claim-without-evidence", "Sends mail"], ["claim-without-evidence", "Logs"]]);
  assert.match(gaps[0].why, /src\/a\.js:40 is past the end/);
  assert.match(gaps[1].why, /names no evidence/);
});

test("evidence that fails is taken off a claim that keeps other evidence, and said", () => {
  const { kept } = checkClaims([{ name: "Reads", does: "Reads a file.", evidence: ["src/a.js:1", "src/a.js:77"] }], ctx(), { part: "behaviors", label });
  assert.deepEqual(kept[0].evidence, [{ file: "src/a.js", line: 1 }]);
  assert.equal(kept[0].evidence_dropped.length, 1);
});

test("a claim that judges or infers is held back; the code's own quoted words do not count", () => {
  const { kept, gaps } = checkClaims([
    { name: "Farewell", does: "Farewell is a bug: it leaves out the exclamation mark.", evidence: ["src/a.js:1"] },
    { name: "Retry", does: "Probably retries on failure.", evidence: ["src/a.js:2"] },
    { name: "Error text", does: "Answers `wrong input` and the message \"bug report saved\".", evidence: ["src/a.js:3"] },
  ], ctx(), { part: "behaviors", label });
  assert.deepEqual(kept.map((k) => k.name), ["Error text"]);
  assert.deepEqual(gaps.map((g) => g.kind), ["held-back", "held-back"]);
  assert.match(gaps[0].why, /judgment \("bug"\)/);
  assert.match(gaps[1].why, /inference \("Probably"\)/);
});

test("on drift, a claim must touch a changed line; a removed one cites the last commit", () => {
  const drift = {
    byNewFile: new Map([["src/a.js", { file: "src/a.js", status: "modified", new_lines: [[3, 3]], old_lines: [[3, 4]] }]]),
    byFile: new Map([["src/a.js", { file: "src/a.js", status: "modified", new_lines: [[3, 3]], old_lines: [[3, 4]] }], ["src/gone.js", { file: "src/gone.js", status: "deleted", new_lines: [], old_lines: [[1, 2]] }]]),
  };
  const previous = { commit: "a".repeat(40), lineCount: (f) => ({ "src/a.js": 5, "src/gone.js": 2 })[f] ?? null };
  const { kept, gaps } = checkClaims([
    { name: "Changed", does: "Does the new thing.", change: "changed", evidence: ["src/a.js:2-3"] },
    { name: "Untouched", does: "Does the old thing.", change: "changed", evidence: ["src/a.js:1"] },
    { name: "Gone", does: "Did the removed thing.", change: "removed", evidence: [{ file: "src/gone.js", line: 1, at: "a".repeat(40) }] },
    { name: "Gone without the commit", does: "Did it.", change: "removed", evidence: ["src/gone.js:1"] },
  ], ctx({ previous }), { part: "behaviors", label, drift });
  assert.deepEqual(kept.map((k) => k.name), ["Changed", "Gone"]);
  assert.deepEqual(gaps.map((g) => [g.about, g.kind]), [["Untouched", "outside-the-change"], ["Gone without the commit", "claim-without-evidence"]]);
});
