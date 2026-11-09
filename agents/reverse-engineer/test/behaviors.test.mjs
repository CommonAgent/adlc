// The checks a behavior goes through after its evidence, and the drafted
// schemas: kinds from the fixed list, one behavior per anchor, quotes byte
// for byte, rules with a kind and evidence, the patterns and constants
// attached by rule; a drafted schema keeps only fields and constants the code
// has, and fills only what the rule left unknown.
//   node --test test/behaviors.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorsWithout, checkBehaviors, findQuote } from "../scripts/behaviors.mjs";
import { contextFor } from "../scripts/evidence.mjs";
import { checkSchema, mergeSchema } from "../scripts/interfaces.mjs";
import { KIND_NAMES, RULE_NAMES } from "../scripts/kinds.mjs";
import { readSurface } from "../scripts/surface.mjs";
import { isTestFile } from "../scripts/facts.mjs";
import { planBehaviorPasses } from "../scripts/draft.mjs";

const FILES = {
  "src/notice.mjs": [
    "const STOP = /^\\s*halt\\s+(j-\\d{6})\\s*:\\s*stop now\\b/i;",
    "const LIMIT = 5;",
    "export function notice(text) {",
    "  const m = STOP.exec(String(text ?? \"\").slice(0, LIMIT * 100));",
    "  return m ? { job: m[1] } : null;",
    "}",
    "export function reply({ job }) {",
    "  return `Nothing was running for ${job}.`;",
    "}",
    "function helper() { return 1; }",
  ].join("\n"),
  "test/notice.test.mjs": "import { test } from \"node:test\";\nimport { notice, reply } from \"../src/notice.mjs\";\ntest(\"x\", () => notice(\"\"));\n",
};
const read = (f) => FILES[f] ?? null;
const files = Object.keys(FILES);
const ctx = contextFor({ files, read });
const surface = readSurface(files, read, { isTest: isTestFile });
const ev = (line, end_line) => [{ file: "src/notice.mjs", line, ...(end_line ? { end_line } : {}) }];

test("the kinds are a fixed list, in order of precedence", () => {
  assert.deepEqual(KIND_NAMES, ["entry", "fetch", "write", "state", "check", "parse", "compute", "compose"]);
  assert.deepEqual(RULE_NAMES, ["order", "limit", "header", "default"]);
});

test("a quote is found byte for byte, first in the cited lines, then in the cited file", () => {
  assert.deepEqual(findQuote("Nothing was running for ${job}.", read, ev(7, 9)), [{ file: "src/notice.mjs", line: 8 }]);
  assert.deepEqual(findQuote("/^\\s*halt\\s+(j-\\d{6})", read, ev(3, 6)), [{ file: "src/notice.mjs", line: 1 }], "outside the range, in the same file");
  assert.equal(findQuote("Nothing was running for ${job}!", read, ev(7, 9)), null, "one character off is not the code's words");
  assert.equal(findQuote("/^\\s*halt\\s+(j-\\d{6})\\s*:\\s*stop that\\b/i", read, ev(1)), null);
});

test("a behavior's kind must be in the list, its anchor counted once, and one the rule counts", () => {
  const drafted = [
    { name: "Notice", does: "Gives back the job a stop notice names.", kind: "check", anchor: "src/notice.mjs#notice", evidence: ev(3, 6) },
    { name: "Notice again", does: "Reads the job id.", kind: "parse", anchor: "src/notice.mjs#notice", evidence: ev(4) },
    { name: "Helper", does: "Returns one.", kind: "compute", anchor: "src/notice.mjs#helper", evidence: ev(10) },
    { name: "Reply", does: "Says nothing ran.", kind: "Transform", anchor: "src/notice.mjs#reply", evidence: ev(7, 9) },
  ];
  const r = checkBehaviors(drafted, ctx, { read, surface });
  assert.deepEqual(r.kept.map((b) => [b.name, b.kind]), [["Notice", "check"]]);
  assert.deepEqual(r.gaps.map((g) => [g.kind, g.about.split(":")[0]]), [["held-back", "Notice again"], ["held-back", "Helper"], ["held-back", "Reply"]]);
  assert.match(r.gaps[0].why, /one behavior per anchor/);
  assert.match(r.gaps[1].why, /not one the granularity rule counts/);
  assert.match(r.gaps[2].why, /its kind \("transform"\) is not one of the behavior kinds/);
  // The held-back anchor is named, so it is not also listed as an anchor with no behavior.
  assert.deepEqual(anchorsWithout(surface, r.kept, r.anchorsHeld, null), []);
  assert.deepEqual(anchorsWithout(surface, r.kept, new Set(), null).map((g) => g.about.split(" ")[0]), ["src/notice.mjs#reply"]);
});

test("quotes and rules are checked; the patterns and constants the lines use are attached by rule", () => {
  const [b] = checkBehaviors([{
    name: "Notice", does: "Gives back the job a stop notice names.", kind: "check", anchor: "src/notice.mjs#notice", evidence: ev(3, 6),
    quotes: [{ what: "a reply that is not there", text: "Stopped." }],
    rules: [
      { kind: "limit", rule: "Reads at most 500 characters.", quote: "LIMIT * 100", evidence: [] },
      { kind: "limit", rule: "Probably reads less.", evidence: ev(4) },
      { kind: "cap", rule: "Caps it.", evidence: ev(4) },
      { kind: "default", rule: "Treats nothing as empty text.", evidence: [] },
    ],
  }], ctx, { read, surface }).kept;
  assert.deepEqual(b.quotes, [{ what: "the pattern STOP", text: "/^\\s*halt\\s+(j-\\d{6})\\s*:\\s*stop now\\b/i", evidence: [{ file: "src/notice.mjs", line: 1 }], by_rule: true }]);
  assert.deepEqual(b.rules, [{ kind: "limit", rule: "Reads at most 500 characters.", quote: "LIMIT * 100", evidence: [{ file: "src/notice.mjs", line: 4 }] }]);
  assert.deepEqual(b.constants, [{ name: "LIMIT", value: 5, evidence: [{ file: "src/notice.mjs", line: 2 }] }]);
  const gaps = checkBehaviors([{ name: "Notice", does: "x", kind: "check", evidence: ev(3, 6), quotes: [{ what: "w", text: "Stopped." }], rules: [{ kind: "limit", rule: "Probably reads less.", evidence: ev(4) }, { kind: "cap", rule: "Caps it.", evidence: ev(4) }, { kind: "default", rule: "Defaults.", evidence: [] }] }], ctx, { read, surface }).gaps;
  assert.deepEqual(gaps.map((g) => g.kind), ["held-back", "held-back", "held-back", "claim-without-evidence"]);
  assert.match(gaps[0].why, /not in src\/notice\.mjs byte for byte/);
});

test("a drafted schema keeps only the fields and constants the code has, and fills only what the rule left unknown", () => {
  const known = { inCode: (n) => ["format", "items", "id", "title"].includes(n), literalInCode: (v) => v === "feed-v1" };
  const drafted = { type: "object", properties: { format: { type: "string", const: "feed-v9" }, items: { type: "array", items: { type: "object", properties: { id: {}, title: { type: "string" }, score: { type: "integer" } }, required: ["id", "score"] } }, stamp: { type: "string" } } };
  const c = checkSchema(drafted, known);
  assert.deepEqual(c.dropped, ["the constant \"feed-v9\" at format is not a literal in the code", "the field items[].score is not written in the code", "the field stamp is not written in the code"]);
  assert.deepEqual(c.doc.properties.items.items.required, ["id"]);
  const rule = { type: "object", properties: { format: { type: "string", const: "feed-v1" }, items: { $comment: "value: rows" } }, required: ["format", "items"] };
  const m = mergeSchema(rule, { type: "object", properties: { format: { type: "string" }, items: c.doc.properties.items, other: {} } });
  assert.deepEqual(m.schema.properties.format, { type: "string", const: "feed-v1" }, "what the rule read stands");
  assert.equal(m.schema.properties.items.type, "array", "what the rule left unknown is filled");
  assert.deepEqual(m.extra, ["other"], "a field the closed object literal does not have is not added");
});

test("behavior passes: a few files each, anchored files first, inside the limits", () => {
  const many = { ...FILES, "src/a.mjs": "x".repeat(500), "src/b.mjs": "y".repeat(500), "src/c.mjs": "z".repeat(500) };
  const list = Object.keys(many);
  const facts = { surface: readSurface(list, (f) => many[f] ?? null, { isTest: isTestFile }) };
  const plan = planBehaviorPasses(list, (f) => many[f] ?? null, facts, { charsPerPass: 900, maxPasses: 2 });
  assert.deepEqual(plan.passes.map((p) => p.sent.map((s) => s.file)), [["src/notice.mjs", "src/a.mjs"], ["src/b.mjs"]]);
  assert.deepEqual(plan.notSent.map((n) => [n.file, /2 behavior passes/.test(n.why)]), [["src/c.mjs", true]]);
});
