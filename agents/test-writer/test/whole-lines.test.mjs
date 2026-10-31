// A delivered piece is read by whole lines, never by a single letter found
// anywhere in it (found 2026-10-31 in build ab_6d0a79ba51025b1beb).
//   node --test test/whole-lines.test.mjs
//
// What is worth pinning. vowel-tally's suite cut the `## Counts` block out of
// the delivered Markdown and checked the vowels' order with
// countsBlock.indexOf("a") < countsBlock.indexOf("e") and so on. The heading
// the spec requires, "## Counts", holds o and u before any i, so no piece that
// keeps the spec can pass it, and the code writer stopped on the conflict with
// 25 of 26 tests passing. A heading or a word of prose holds letters too; a
// line is found by a pattern for the whole line ("- a: 1"), or by the text
// after its heading line.
//
// So the model is told to read a piece by whole lines, and a search for one
// letter, by a one-letter literal, by an element of a list of one-letter
// strings or by a variable that runs over one, with indexOf, lastIndexOf,
// includes or search, is a static finding naming the file and the line.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTRUCTION, letterSearchFindings, staticFindings } from "../scripts/write-suite.mjs";

const file = (body) => ({ path: "test/count.test.mjs", text: `// pins the tally\nimport { test } from "node:test";\nimport { count } from "../scripts/count.mjs";\n${body}` });

test("a search for an element of a list of single letters is a finding by line", () => {
  const f = file(`const EXPECTED_VOWELS = worked(["a", "e", "i", "o", "u"], () => "aeiou".split(""), "order");
test("the counts are in order", () => {
  const countsBlock = count();
  for (let i = 0; i < EXPECTED_VOWELS.length - 1; i++) {
    const first = countsBlock.indexOf(EXPECTED_VOWELS[i]);
    assert.ok(first < countsBlock.indexOf(EXPECTED_VOWELS[i + 1]));
  }
});
`);
  const found = letterSearchFindings([f]);
  assert.equal(found.length, 2, JSON.stringify(found));
  assert.match(found[0], /test\/count\.test\.mjs:8/);
  assert.match(found[0], /single letter/);
  assert.match(found[0], /whole line/);
});

test("a search by a variable that runs over single letters, or by a one-letter literal, is a finding", () => {
  const loop = file(`test("each vowel is listed", () => {
  const text = count();
  for (const v of ["a", "e", "i", "o", "u"]) assert.ok(text.includes(v));
  assert.ok(!text.includes("y"));
  assert.ok(text.search('e') > 0);
});
`);
  const found = letterSearchFindings([loop]);
  assert.equal(found.length, 3, JSON.stringify(found));
  const each = file(`const LETTERS = ["a", "b"];\ntest("each letter is listed", () => {\n  LETTERS.forEach((ch) => assert.ok(count().lastIndexOf(ch) > 0));\n});\n`);
  assert.equal(letterSearchFindings([each]).length, 1);
});

test("a search for a whole line, a word, or a split on a separator is not a finding", () => {
  const fine = file(`test("each vowel has its line", () => {
  const text = count();
  for (const v of ["a", "e", "i", "o", "u"]) assert.match(text, new RegExp("^- " + v + ": \\\\d+$", "m"));
  assert.ok(text.includes("## Counts"));
  assert.ok(text.indexOf("- a: 1") < text.indexOf("- e: 3"));
  assert.deepEqual("a,b".split(","), ["a", "b"]);
  assert.ok(text.includes("\\n"));
});
`);
  assert.deepEqual(letterSearchFindings([fine]), []);
});

test("the finding comes through the static check, and the model is told to read a piece by whole lines", () => {
  const f = file(`test("o comes after a", () => {\n  const t = count();\n  assert.ok(t.indexOf("a") < t.indexOf("o"));\n});\ntest("a second", () => count());\n`);
  assert.ok(staticFindings([f], null).some((x) => /single letter/.test(x)), JSON.stringify(staticFindings([f], null)));
  assert.match(INSTRUCTION, /whole line/);
  assert.match(INSTRUCTION, /never by a single letter/);
  assert.match(INSTRUCTION, /## Counts/);
});
