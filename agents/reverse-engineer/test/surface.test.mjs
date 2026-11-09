// The surface read by rule: the lexer that keeps strings, templates, regular
// expressions and comments apart from code; the exports and imports of ES
// modules and CommonJS; the files written with the schema their value shows;
// the commands, their flags, the patterns and constants; imports that leave
// the codebase; and node --test when package.json names no test script.
//   node --test test/surface.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { scan, typeOfExpr } from "../scripts/js-source.mjs";
import { exportsOf, importsOf, patternsOf, readSurface, resolveImport, writesOf } from "../scripts/surface.mjs";
import { declaredSettings, entryHints, entryPoints, isTestFile, testCommand } from "../scripts/facts.mjs";

const reader = (files) => (f) => files[f] ?? null;

test("the lexer blanks strings, templates, comments and regular expressions, and keeps their values", () => {
  const src = [
    "const a = \"x { y\"; // a comment with } and 'quotes'",
    "const re = /a\\/b[/]c/gi; const half = 4 / 2 / 1;",
    "const t = `one ${a + \"}\"} two`;",
    "/* block { */ const b = 'it\\'s';",
  ].join("\n");
  const s = scan(src);
  assert.equal(s.masked.length, src.length);
  assert.ok(!/[{}]/.test(s.masked.split("\n")[0].replace(/\s/g, "")), "no brace from a string or a comment survives");
  const kinds = s.tokens.map((t) => [t.kind, t.value ?? null]);
  assert.deepEqual(kinds, [["string", "x { y"], ["regex", "/a\\/b[/]c/gi"], ["template", null], ["string", "}"], ["string", "it's"]]);
  assert.equal(s.tokens.filter((t) => t.kind === "regex").length, 1, "a division is not a regular expression");
  assert.equal(s.tokens.find((t) => t.kind === "regex").line, 2);
});

test("an object literal's schema: field names, types, constants and which fields are always there", () => {
  const src = [
    "const SOURCE = \"https://feed.example.org/\";",
    "function save(items, maybe) {",
    "  const when = new Date().toISOString();",
    "  const doc = { format: \"feed-v2\", at: when, source: SOURCE, count: items.length, ok: items.length > 0, items, tags: [\"a\", \"b\"], note: maybe ? `n ${maybe}` : null, ...(maybe ? { extra: 1 } : {}) };",
    "  return doc;",
    "}",
  ].join("\n");
  const s = scan(src);
  const at = s.masked.indexOf("{ format");
  const end = s.masked.indexOf("};", at) + 1;
  const schema = typeOfExpr(s, at, end);
  assert.deepEqual(schema.required, ["format", "at", "source", "count", "ok", "items", "tags", "note"]);
  assert.deepEqual(schema.properties.format, { type: "string", const: "feed-v2" });
  assert.deepEqual(schema.properties.at, { type: "string", format: "date-time" });
  assert.deepEqual(schema.properties.source, { type: "string", const: "https://feed.example.org/" });
  assert.deepEqual(schema.properties.count, { type: "integer" });
  assert.deepEqual(schema.properties.ok, { type: "boolean" });
  assert.deepEqual(schema.properties.items, { $comment: "value: items" });
  assert.deepEqual(schema.properties.tags, { type: "array", items: { type: "string", enum: ["a", "b"] } });
  assert.deepEqual(schema.properties.note, { type: ["string", "null"] });
  assert.deepEqual(schema.properties.extra, { type: "integer", const: 1 });
});

test("a let is never resolved as a constant, and an outer const is hidden by a nearer let", () => {
  const src = [
    "const text = \"outer\";",
    "function f(page) {",
    "  let text = null;",
    "  if (page) text = page.body;",
    "  return { text };",
    "}",
  ].join("\n");
  const s = scan(src);
  const at = s.masked.lastIndexOf("{ text }");
  assert.deepEqual(typeOfExpr(s, at, at + 8).properties.text, { $comment: "value: text" });
});

test("exports of an ES module: functions with parameters, async and what they throw; constants with values", () => {
  const src = [
    "export const KIND = \"thing-v1\";",
    "export const API_KEY = \"not-a-real-one\";",
    "const LIMIT = 30;",
    "export class Refusal extends Error {}",
    "export async function load(url, { tries = 2 } = {}) {",
    "  if (!url) throw new Refusal(\"no url\");",
    "  return url;",
    "}",
    "export const pick = (list) => list[0];",
    "function inner() { throw new TypeError(\"x\"); }",
    "export { inner as helper, LIMIT };",
  ].join("\n");
  const ex = exportsOf(scan(src));
  const by = Object.fromEntries(ex.map((e) => [e.name, e]));
  assert.deepEqual(ex.map((e) => e.name), ["KIND", "API_KEY", "Refusal", "load", "pick", "helper", "LIMIT"].sort((a, b) => by[a].line - by[b].line || a.localeCompare(b)));
  assert.deepEqual([by.KIND.kind, by.KIND.value], ["constant", "thing-v1"]);
  assert.equal(by.API_KEY.value, undefined, "a credential's value is never written");
  assert.match(by.API_KEY.withheld, /credential/);
  assert.deepEqual([by.load.kind, by.load.async, by.load.params, by.load.throws], ["function", true, "url, { tries = 2 } = {}", [{ error: "Refusal", line: 6 }]]);
  assert.deepEqual([by.pick.kind, by.pick.async, by.pick.params], ["function", false, "list"]);
  assert.deepEqual([by.helper.kind, by.helper.throws], ["function", [{ error: "TypeError", line: 10 }]]);
  assert.deepEqual([by.LIMIT.kind, by.LIMIT.value], ["constant", 30]);
});

test("exports of CommonJS, and the names each import takes", () => {
  const cjs = "function greet(name) { return name; }\nconst VERSION = \"2\";\nmodule.exports = { greet, VERSION, shout: (s) => s.toUpperCase() };\nexports.extra = function (a) { return a; };\n";
  const ex = exportsOf(scan(cjs));
  assert.deepEqual(ex.map((e) => [e.name, e.kind]), [["greet", "function"], ["VERSION", "constant"], ["shout", "function"], ["extra", "function"]]);
  const im = importsOf(scan("import a, { b, c as d } from \"./x.mjs\";\nimport * as ns from \"./y.mjs\";\nconst { e } = require(\"./z.js\");\nconst whole = require(\"../up.js\");\nimport \"./side.mjs\";\nconst f = require(\"./w.js\").f;\n"));
  assert.deepEqual(im.map((i) => [i.spec, i.names]), [["./x.mjs", ["b", "c", "default"]], ["./y.mjs", ["*"]], ["./z.js", ["e"]], ["../up.js", ["*"]], ["./side.mjs", []], ["./w.js", ["f"]]]);
});

test("an import is resolved inside the codebase, or said to leave it", () => {
  const files = new Set(["scripts/a.mjs", "lib/index.js"]);
  assert.deepEqual(resolveImport("test/a.test.mjs", "../scripts/a.mjs", files), { resolved: "scripts/a.mjs" });
  assert.deepEqual(resolveImport("scripts/a.mjs", "../lib", files), { resolved: "lib/index.js" });
  assert.deepEqual(resolveImport("test/a.test.mjs", "../../shared/x.mjs", files), { outside: "../shared/x.mjs" });
  assert.deepEqual(resolveImport("scripts/a.mjs", "node:fs", files), {});
});

test("a file written: its path from the literals, JSON or text, and the schema of the value", () => {
  const src = [
    "import { writeFileSync } from \"node:fs\";",
    "import { join } from \"node:path\";",
    "export function save(dir, rows) {",
    "  const out = join(dir || \".\", \"out\");",
    "  const doc = { format: \"rows-v1\", rows };",
    "  writeFileSync(join(out, \"rows.json\"), `${JSON.stringify(doc, null, 2)}\\n`);",
    "  writeFileSync(join(out, \"log.txt\"), rows.join(\"\\n\"));",
    "}",
  ].join("\n");
  const w = writesOf(scan(src));
  assert.deepEqual(w.map((x) => [x.path, x.content, x.line]), [["out/rows.json", "json", 6], ["out/log.txt", "text", 7]]);
  assert.deepEqual(w[0].schema.properties.format, { type: "string", const: "rows-v1" });
  assert.deepEqual(w[0].schema.required, ["format", "rows"]);
});

test("patterns are kept as written, with their names and lines; new RegExp keeps its argument as written", () => {
  const p = patternsOf(scan("const STOP = /^\\s*halt\\s+(j-\\d+)/i;\nfunction f(s) { return new RegExp(`^${s}\\\\b`, \"i\").test(s) && /x/.test(s); }\n"));
  assert.deepEqual(p.map((x) => [x.text, x.line, x.name ?? null, x.top]), [["/^\\s*halt\\s+(j-\\d+)/i", 1, "STOP", true], ["`^${s}\\\\b`", 2, null, false], ["/x/", 2, null, false]]);
});

test("the surface of a small codebase: anchors, commands and their flags, outside imports", () => {
  const files = {
    "bin/run.mjs": "#!/usr/bin/env node\nimport { work } from \"../lib/work.mjs\";\nconst args = process.argv.slice(2);\nif (args[0] === \"--dry-run\") console.log(\"dry\");\nwork();\n",
    "lib/work.mjs": "export function work() { return 1; }\nexport function unused() { return 2; }\nfunction helper() {}\nconst flag = \"--loud\";\n",
    "lib/other.mjs": "export function lonely() { return \"--never\"; }\n",
    "test/work.test.mjs": "import { test } from \"node:test\";\nimport { unused } from \"../lib/work.mjs\";\nimport { fixture } from \"../../outside/fixture.mjs\";\ntest(\"x\", () => unused());\n",
  };
  const s = readSurface(Object.keys(files).sort(), reader(files), { isTest: isTestFile });
  assert.deepEqual(s.anchors.map((a) => [a.id, a.kind]), [["bin/run.mjs", "command"], ["lib/work.mjs#work", "function"], ["lib/work.mjs#unused", "function"]]);
  assert.deepEqual(s.entries.map((e) => [e.file, e.flags]), [["bin/run.mjs", ["--dry-run", "--loud"]]]);
  assert.ok(!s.flags.some((f) => f.name === "--never"), "a file no command reaches gives no flags");
  // 0.3.0: every module's exports are listed (a rebuild exports them too); one nothing imports is no anchor.
  assert.deepEqual(s.exports.filter((e) => e.module === "lib/other.mjs").map((e) => [e.name, e.imported_by]), [["lonely", []]]);
  assert.ok(!s.anchors.some((a) => a.module === "lib/other.mjs"), "a module nothing imports has no anchor");
  assert.deepEqual(s.outside, [{ file: "test/work.test.mjs", line: 3, spec: "../../outside/fixture.mjs", resolved: "../outside/fixture.mjs" }]);
  assert.deepEqual(s.exports.find((e) => e.name === "unused").imported_by, ["test/work.test.mjs"]);
});

test("the manifests' hints: package.json main and bin, an Agent Package's run command, its declared settings", () => {
  const files = {
    "package.json": "{\n  \"name\": \"p\",\n  \"main\": \"src/index.js\",\n  \"bin\": { \"p\": \"bin/p.js\" }\n}\n",
    "agent-runtime-requirements.json": "{\n  \"run\": {\n    \"go\": {\n      \"command\": [\"node\", \"{home}/{package}/skills/go/scripts/go.mjs\"]\n    }\n  }\n}\n",
    "agent-descriptor.json": "{\n  \"run_config\": {\n    \"settings\": [\n      { \"name\": \"count\", \"default\": 3 }\n    ]\n  }\n}\n",
    "scripts/go.mjs": "export function go() {}\n",
  };
  const list = Object.keys(files);
  const read = reader(files);
  const hints = entryHints(list, read, entryPoints(list, read).entry_points);
  assert.deepEqual(hints.map((h) => [h.file, Boolean(h.main), Boolean(h.command)]), [["src/index.js", true, false], ["bin/p.js", false, true], ["scripts/go.mjs", false, true]]);
  assert.deepEqual(hints[2].evidence, [{ file: "agent-runtime-requirements.json", line: 4 }]);
  assert.deepEqual(declaredSettings(list, read), [{ name: "count", declared_in: "agent-descriptor.json run_config", evidence: [{ file: "agent-descriptor.json", line: 4 }] }]);
});

test("with no package.json, the node:test files are run with node --test; fixtures and other runners' files are not", () => {
  const files = {
    "scripts/a.mjs": "export const a = 1;\n",
    "test/a.test.mjs": "// a\nimport { test } from \"node:test\";\n",
    "test/b.test.js": "const { test } = require('node:test');\n",
    "test/jest.test.js": "describe('x', () => {});\n",
    "test/fixtures/app/test/c.test.mjs": "import { test } from \"node:test\";\n",
  };
  const tc = testCommand(Object.keys(files), reader(files));
  assert.equal(tc.command, "node --test test/a.test.mjs test/b.test.js");
  assert.deepEqual(tc.evidence, [{ file: "test/a.test.mjs", line: 2 }, { file: "test/b.test.js", line: 1 }]);
  assert.match(tc.found_by, /no package\.json/);
  const none = testCommand(["scripts/a.mjs"], reader(files));
  assert.match(none.none, /no package\.json.*node --test/);
  const withScript = { ...files, "package.json": "{\n  \"scripts\": {\n    \"test\": \"vitest\"\n  }\n}\n" };
  assert.equal(testCommand(Object.keys(withScript), reader(withScript)).command, "vitest", "a test script package.json names is run as named");
});
