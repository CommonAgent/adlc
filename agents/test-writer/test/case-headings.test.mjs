// A heading the `about` gives only to one case is that case's shape, not a
// heading every piece must carry (technical debt 647, 2026-10-31).
//   node --test test/case-headings.test.mjs
//
// What is worth pinning. vowel-counter 0.1.0's descriptor said of its Markdown
// output: a header `total, letters_read`, then `## Counts`, then `## Not
// counted`; "When there was no sentence, the header is absent and the only
// content is `## Nothing to count`." The format check took every backticked
// heading as fixed, so it required `## Nothing to count` in a piece that had
// counts, no script could meet both the spec and the check, and the code
// writer stopped on it as a conflict.
//
// So a heading in a sentence that opens on a case (when, if, unless,
// otherwise, without, ...), or that says it is only for one, or that is
// followed straight away by such a condition, is that case's heading. A piece
// must carry every heading of the main shape and its header, unless it
// carries all the headings of one case, in which case it is that case and is
// held to nothing more. A heading in a plain sentence is still required.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conventionOf, formatProblems, sampleOf } from "../references/delivered-formats.test.mjs";

const VOWELS = "Markdown: a header `total, letters_read`, then `## Counts` with one line per vowel, then `## Not counted` listing what was left out. When there was no sentence, the header is absent and the only content is `## Nothing to count`.";

const COUNTED = "total: 14\nletters_read: 31\n\n## Counts\n\n- a: 1\n\n## Not counted\n\n- y\n";
const EMPTY = "## Nothing to count\n\nThere was no sentence.\n";

test("a heading given only to the empty case is that case's, and the main shape's headings stay fixed", () => {
  const c = conventionOf(VOWELS);
  assert.deepEqual(c.headings, ["## Counts", "## Not counted"]);
  assert.deepEqual(c.cases, [["## Nothing to count"]]);
  assert.deepEqual(c.header, ["total", "letters_read"]);
});

test("a piece in the main shape is not held to the empty case's heading", () => {
  assert.deepEqual(formatProblems(COUNTED, "text/markdown", VOWELS), []);
});

test("a piece in the empty case's shape is held to neither the main headings nor the header", () => {
  assert.deepEqual(formatProblems(EMPTY, "text/markdown", VOWELS), []);
});

test("a piece in neither shape is still told which main heading it lacks", () => {
  const found = formatProblems("total: 1\nletters_read: 1\n\n## Not counted\n\n- y\n", "text/markdown", VOWELS);
  assert.match(found.join(" "), /missing the heading ## Counts/);
  assert.doesNotMatch(found.join(" "), /Nothing to count/);
});

test("conditions are read whichever word opens them, or straight after the heading, and a plain sentence's heading stays fixed", () => {
  assert.deepEqual(conventionOf("Markdown: `## Summary`. If nothing was found, only `## Nothing found`.").cases, [["## Nothing found"]]);
  assert.deepEqual(conventionOf("Markdown: `## Summary`. Otherwise `## Refused` with the reason.").cases, [["## Refused"]]);
  assert.deepEqual(conventionOf("Markdown: `## Summary`, or `## Nothing found` when nothing was found.").headings, ["## Summary"]);
  assert.deepEqual(conventionOf("Markdown: `## Summary`, or `## Nothing found` when nothing was found.").cases, [["## Nothing found"]]);
  assert.deepEqual(conventionOf("Markdown: `## Key points`, then `## Sources`. Each source is a link.").headings, ["## Key points", "## Sources"]);
  assert.deepEqual(conventionOf("Markdown: `## Key points`, then `## Sources`.").cases, []);
});

test("a sentence's end is not read inside backticks", () => {
  const c = conventionOf("Markdown: a header `see. at`, then `## Counts`. When empty, `## Nothing`.");
  assert.deepEqual(c.headings, ["## Counts"]);
  assert.deepEqual(c.cases, [["## Nothing"]]);
});

test("a piece made from the convention still meets it", () => {
  assert.deepEqual(formatProblems(sampleOf("text/markdown", VOWELS), "text/markdown", VOWELS), []);
});
