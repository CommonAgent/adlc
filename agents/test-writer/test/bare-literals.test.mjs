// A value a rule decides is never pinned as a bare number in an assertion
// (found 2026-10-31 in build ab_481ac696b24d8cf8fd).
//   node --test test/bare-literals.test.mjs
//
// What is worth pinning. vowel-scale's suite worked 23 values twice, and all
// held, but one test wrote its counts straight into the assertions:
// assert.equal(result.counts.a, 3) and assert.equal(result.total, 4) for
// "Café façade rôle naïve", where the spec's rule gives a 4, e 3, total 7. The
// static check only asked for some worked value in the suite, so this one was
// never cross-checked, and the code writer stopped on it as a conflict.
//
// So, whenever the worked-values check goes into the suite, an assertion that
// compares what a test got to a bare number, or to an object or list holding
// numbers, or that matches a regular expression with a number written in it,
// is a finding by line: the value goes in a worked constant at the top of the
// file. An exit status, a count of calls or attempts, and a length are not
// values a spec's rule decides, and are left alone.
//
// Nothing here reaches a network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTRUCTION, askForSuite, bareLiteralFindings, staticFindings } from "../scripts/write-suite.mjs";
import { declaredOf } from "../scripts/declared.mjs";

const file = (body) => ({ path: "test/count.test.mjs", text: `// pins the tally\nimport { test } from "node:test";\nimport { tally } from "../scripts/count.mjs";\nimport { worked } from "./worked-values.test.mjs";\nconst N = worked(1, () => 1, "x");\n${body}` });

test("a script's result compared to a bare number is a finding naming the lines", () => {
  const f = file(`test("accented letters are left out", () => {
  const result = tally("Café façade rôle naïve");
  assert.equal(result.counts.a, 3, "plain a");
  assert.strictEqual(result.total, 4);
  assert.equal(result.counts.i, 0);
});
`);
  const found = bareLiteralFindings([f]);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0], /test\/count\.test\.mjs/);
  assert.match(found[0], /lines 8, 9, 10/);
  assert.match(found[0], /worked/);
});

test("an object or list of numbers, and a regular expression with a number in it, are findings too", () => {
  const f = file(`test("the counts", () => {
  assert.deepEqual(tally("abc").counts, { a: 1, e: 0 });
  assert.deepStrictEqual(tally("x").list, [2, 3]);
  assert.match(tally("x").report, /^- a: 14$/m);
});
`);
  assert.match(bareLiteralFindings([f])[0], /lines 7, 8, 9/);
});

test("an exit status, a count of calls, a length, a worked constant and a word are left alone", () => {
  const f = file(`test("the process contract", () => {
  const r = run();
  assert.equal(r.status, 3);
  assert.equal(r.code, 2);
  assert.equal(calls, 0);
  assert.equal(modelInvocations, 0, "no model");
  assert.equal(pieces.length, 2);
  assert.equal(tally("x").total, N);
  assert.deepEqual(tally("x").counts, { a: N });
  assert.equal(tally("x").reply, "There was nothing to count.");
  assert.match(tally("x").report, /^- a: \\d+$/m);
  assert.match(text, /## Counts/);
});
`);
  assert.deepEqual(bareLiteralFindings([f]), []);
});

test("the finding comes through the static check only when the worked-values check is held, and the model is told", () => {
  const f = file(`test("a count", () => {\n  assert.equal(tally("ab").total, 1);\n});\ntest("a second", () => tally(""));\n`);
  assert.ok(staticFindings([f], null, { workedCheck: true }).some((x) => /bare number/.test(x)));
  assert.ok(staticFindings([f], null, { literalCheck: true }).some((x) => /bare number/.test(x)));
  assert.ok(!staticFindings([f], null).some((x) => /bare number/.test(x)));
  assert.match(INSTRUCTION, /never as a bare number in an assertion/);
});

test("a suite in parts is held to it part by part", async () => {
  const spec = { name: "t", version: "0.1.0", jobs: [{ slug: "j", offered: true, scripts: ["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs", "scripts/d.mjs"] }] };
  const sent = [];
  const bare = (n) => `<<<FILE test/${n}.test.mjs>>>\n// ${n}\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { ${n} } from "../scripts/${n}.mjs";\ntest("${n} counts", () => assert.equal(${n}().total, 7));\ntest("${n} answers twice", () => ${n}());\n<<<END>>>`;
  await askForSuite({
    declared: declaredOf(spec), spec, workedTest: "// the worked check", part: { scripts: ["scripts/a.mjs"], first: true, others: [], taken: [] },
    call: async (request) => { sent.push(request); return bare("a"); },
  });
  assert.equal(sent.length, 2, "the part was asked again with the finding");
  assert.match(sent[1].body.contents[0].parts.map((p) => p.text).join("\n"), /bare number/);
});
