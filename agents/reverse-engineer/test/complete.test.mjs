// What 0.3.0 adds so a rebuild has every fact it needs, found by code: the
// exported constants with their values, what the agent declares in its own
// files, the flags each command cannot run without, the allowed values of a
// field written from fixed literals, every string a person reads and every
// pattern (strings.json), the original tests carried byte for byte with the
// files they import from outside the codebase, and the completeness check.
// The fixture is a small repository (test/fixtures/repo-agent): an agent
// folder, agents/page-reader, and a shared helper outside it that the agent's
// test imports, which imports two more files in turn, one of them three
// levels down, which imports a package. The model is stood in.
//   node --test test/complete.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJob } from "../scripts/describe.mjs";
import { literalValue, scan, typeOfExpr } from "../scripts/js-source.mjs";
import { readSurface, stringsOf } from "../scripts/surface.mjs";
import { flagsOf } from "../scripts/flags.mjs";
import { declarationsIn, skillDeclarations } from "../scripts/declarations.mjs";
import { buildInterfaces } from "../scripts/interfaces.mjs";
import { completeness } from "../scripts/record.mjs";
import { isTestFile } from "../scripts/facts.mjs";
import { FIXTURES, commitAll, git, job, readPiece } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

const reader = (files) => (f) => (Object.hasOwn(files, f) ? files[f] : null);
const env = () => { const e = { ...process.env }; for (const k of ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL"]) delete e[k]; return e; };

/** The draft the stand-in answers: the items of out/pages.json, with no allowed values. */
const DRAFT = {
  architecture: {}, behaviors: [], tests: [], gaps: [],
  interfaces: [{
    kind: "file", name: "out/pages.json", path: "out/pages.json", does: "The pages read.", evidence: [{ file: "scripts/read-pages.mjs", line: 40 }],
    schema: { format: "json-schema", document: { type: "object", properties: { pages: { type: "array", items: { type: "object", properties: { text: { type: "string" }, from: { type: "string" }, done: { type: "boolean" } } } } } } },
  }],
};

/** The fixture repository, as a git checkout (or a plain folder). */
function repository({ checkout = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "reverse-engineer-repo-"));
  const top = join(root, "repo");
  cpSync(join(FIXTURES, "repo-agent"), top, { recursive: true });
  if (!checkout) return { root, top, agent: join(top, "agents", "page-reader"), commit: "0".repeat(40) };
  git(top, ["init", "-q"]);
  git(top, ["config", "core.autocrlf", "false"]);
  return { root, top, agent: join(top, "agents", "page-reader"), commit: commitAll(top, "repo") };
}

async function describe(r, more = []) {
  const j = job({ root: r.root, codebase: r.agent, commit: r.commit });
  const out = await runJob([...j.argv, ...more], env(), { call: async () => ({ text: JSON.stringify(DRAFT), answered_by: "stand-in" }) });
  assert.equal(out.code, 0, out.reply);
  return { j, out };
}

test("a constant's value is read as JSON when it is literals all the way down", () => {
  const s = scan("const MOST = 30;\nconst NAME = `x-${MOST}`;\nexport const SETTINGS = [{ name: \"count\", max: MOST, label: NAME, on: true, none: null }];\nexport const MADE = make();\nexport const RE = { p: /x/ };\n");
  const at = (name) => { const k = s.text.indexOf(`${name} =`) + name.length + 3; return [k, s.text.indexOf(";", k)]; };
  assert.deepEqual(literalValue(s, ...at("SETTINGS")), { ok: true, value: [{ name: "count", max: 30, label: "x-30", on: true, none: null }] });
  assert.match(literalValue(s, ...at("MADE")).why, /worked out by code \(make\(\)\)/);
  assert.match(literalValue(s, ...at("RE")).why, /regular expression/);
});

test("a let given only literals has those values, through an if and a destructuring", () => {
  const src = "function f(page, post) {\n  let text = null, from = null;\n  if (page) [text, from] = [page, \"article\"];\n  else if (post) [text, from] = [post, \"post\"];\n  return { text, from };\n}\n";
  const s = scan(src);
  const at = src.indexOf("{ text, from }");
  const k = src.indexOf("from }", at);
  assert.deepEqual(typeOfExpr(s, k, k + 4), { type: ["null", "string"], enum: [null, "article", "post"] });
  assert.match(typeOfExpr(s, at + 2, at + 6).$comment, /value: text/, "a let given a value worked out by code shows no type");
});

test("required flags: refused without one, optional where the code starts with a value, falls back or passes it over; the rest unsettled", () => {
  const files = {
    "cmd.mjs": [
      "#!/usr/bin/env node",
      "function parse(argv) {",
      "  const out = { job: \"\", count: 3, files: [], out: \"\" };",
      "  for (let i = 0; i < argv.length; i++) {",
      "    if (argv[i] === \"--job\") out.job = argv[++i];",
      "    else if (argv[i] === \"--count\") out.count = Number(argv[++i]);",
      "    else if (argv[i] === \"--file\") out.files.push(argv[++i]);",
      "    else if (argv[i] === \"--out\") out.out = argv[++i];",
      "    else if (argv[i] === \"--work\") i++;",
      "  }",
      "  return out;",
      "}",
      "const args = parse(process.argv.slice(2));",
      "if (!args.job) { console.error(\"Name the job.\"); process.exit(2); }",
      "use(args.out);",
    ].join("\n"),
  };
  const s = readSurface(Object.keys(files), reader(files), { isTest: isTestFile });
  const f = flagsOf(s).get("cmd.mjs");
  assert.deepEqual(f.required.map((x) => [x.flag, x.evidence[0].line]), [["--job", 14]]);
  assert.deepEqual(f.optional.map((x) => [x.flag, x.evidence[0].line]), [["--count", 3], ["--file", 3], ["--work", 9]]);
  assert.deepEqual(f.unsettled.map((x) => x.flag), ["--out"]);

  // The draft settles what the rule did not, with evidence that checks; the rule stands where it said.
  const gaps = [];
  const ifs = buildInterfaces({
    surface: s, requiredFlags: flagsOf(s), gap: (g) => gaps.push(g), known: { inCode: () => true, literalInCode: () => true },
    checkEv: (list) => (list ?? []).filter((e) => e.file === "cmd.mjs"),
    checked: [{ kind: "command", command: "cmd.mjs", name: "cmd.mjs", does: "Runs.", evidence: [{ file: "cmd.mjs", line: 1 }], required_flags: { flags: ["--out", "--count", "--nope"], evidence: [{ file: "cmd.mjs", line: 15 }] } }],
  }).interfaces;
  const cmd = ifs.find((i) => i.kind === "command");
  assert.deepEqual([cmd.required_flags, cmd.required_flags_by, cmd.flags_unsettled], [["--job", "--out"], "rule and draft", undefined]);
  assert.ok(gaps.some((g) => /reads no flag --nope/.test(g.why)) && gaps.some((g) => /goes on without --count/.test(g.why)));
});

test("declarations: each thing named by what it is, each field of it with its value and where it is declared", () => {
  const text = readFileSync(join(FIXTURES, "repo-agent", "agents", "page-reader", "agent-descriptor.json"), "utf8");
  const d = declarationsIn("agent-descriptor.json", text);
  const by = (name) => d.find((x) => x.name === name);
  assert.deepEqual(by("offering read-the-pages"), { name: "offering read-the-pages", declared_in: "agent-descriptor.json offerings[0].id", value: "read-the-pages", evidence: [{ file: "agent-descriptor.json", line: 7 }] });
  assert.deepEqual([by("output pages of read-the-pages").declared_in, by("label of output pages of read-the-pages").value], ["agent-descriptor.json offerings[0].outputs[0].name", "The pages read"]);
  assert.deepEqual([by("label of setting count").declared_in, by("label of setting count").value], ["agent-descriptor.json run_config.settings[0].label", "How many pages"]);
  assert.equal(by("step read-each-page of read-the-pages").value, "read-each-page");
  assert.deepEqual(skillDeclarations("skills/x/SKILL.md", "---\nname: x\ndescription: when it is wanted\n---\n").map((x) => [x.name, x.value, x.evidence[0].line]), [["skill x", "x", 2], ["description of skill x", "when it is wanted", 3]]);
});

test("strings: words a person reads, templates and patterns, exactly as written; not import paths or bare words", () => {
  const got = stringsOf(scan("import { a } from \"./a b.mjs\";\nconst k = \"name\";\nconst s = 'It is done.';\nconst t = `Read ${n} of ${m}.`;\nconst p = /^\\s*x$/i;\nconst e = \"Done.\";\nconst u = `${a}/${b}`;\n"));
  assert.deepEqual(got.map((x) => [x.line, x.kind, x.text]), [[3, "words", "It is done."], [4, "template", "Read ${n} of ${m}."], [5, "pattern", "/^\\s*x$/i"], [6, "words", "Done."]]);
});

test("the job on an agent in a repository: constants, declarations, required flags, allowed values, strings, carried tests, nothing missing", async () => {
  const r = repository();
  const { j, out } = await describe(r);
  const ifs = readPiece(j.jobDir, "interfaces.json");
  const one = (kind, name) => ifs.interfaces.find((i) => i.kind === kind && i.name === name);

  assert.deepEqual(one("constant", "VERSION"), { id: one("constant", "VERSION").id, kind: "constant", name: "VERSION", does: "A constant exported by scripts/read-pages.mjs, imported by test/read-pages.test.mjs.", module: "scripts/read-pages.mjs", export: "VERSION", value: "page-reader-v1", imported_by: ["test/read-pages.test.mjs"], evidence: [{ file: "scripts/read-pages.mjs", line: 6 }], read_by_rule: true });
  assert.deepEqual(one("constant", "LIMITS").value, { most: 5, wait_ms: 1000, words: ["title", "body"] });

  const label = one("declaration", "label of setting count");
  assert.deepEqual([label.declared_in, label.value, label.evidence], ["agent-descriptor.json run_config.settings[0].label", "How many pages", [{ file: "agent-descriptor.json", line: 30 }]]);
  for (const name of ["offering read-the-pages", "output pages of read-the-pages", "label of output pages of read-the-pages", "setting count", "command of run read-the-pages", "skill read-the-pages"]) assert.ok(one("declaration", name), name);

  const cmd = ifs.interfaces.find((i) => i.kind === "command");
  assert.deepEqual([cmd.flags, cmd.required_flags, cmd.required_flags_by, cmd.optional_flags.map((x) => x.flag)], [["--count", "--job"], ["--job"], "rule", ["--count"]]);
  assert.deepEqual(cmd.required_flags_evidence, [{ flag: "--job", evidence: [{ file: "scripts/read-pages.mjs", line: 32 }] }]);

  const file = one("file", "out/pages.json");
  assert.deepEqual(file.values, { "/format": ["page-reader-v1"], "/status": ["read", "empty"], "/pages/*/from": ["none", "heading", "body"] });
  assert.deepEqual(file.values_evidence["/pages/*/from"], [{ file: "scripts/read-pages.mjs", line: 25 }, { file: "scripts/read-pages.mjs", line: 22 }, { file: "scripts/read-pages.mjs", line: 23 }, { file: "scripts/read-pages.mjs", line: 24 }]);
  const schema = readPiece(j.jobDir, file.schema);
  assert.deepEqual(schema.properties.pages.items.properties.from, { type: "string", enum: ["none", "heading", "body"] }, "the schema carries the enum read by rule");
  assert.deepEqual(schema.properties.status, { type: "string", enum: ["read", "empty"] });

  const strings = readPiece(j.jobDir, "strings.json");
  assert.equal(strings.format, "as-built-strings-v1");
  assert.deepEqual(strings.strings.map((x) => [x.line, x.kind, x.text]), [[8, "pattern", "/^\\s*done\\s*:\\s*(\\d+)\\s*$/i"], [33, "words", "Name the job folder with --job."], [40, "template", "Read ${pages.length} pages for ${args.job}."], [43, "pattern", "/[\\/]/"]]);
  const lines = readFileSync(join(r.agent, "scripts", "read-pages.mjs"), "utf8").split("\n");
  for (const x of strings.strings) assert.ok(lines[x.line - 1].includes(x.text), `${x.text} is the code's, byte for byte`);

  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  assert.deepEqual(tg.carried, [
    { file: "test/fixtures/sample.txt", at: "tests/test/fixtures/sample.txt", imports: [] },
    { file: "test/read-pages.test.mjs", at: "tests/test/read-pages.test.mjs", imports: [{ from: "../../../shared/fake-pages.mjs", support: "support/shared/fake-pages.mjs" }] },
  ]);
  assert.deepEqual(tg.support.map((x) => [x.at, x.imported_by, x.imports]), [
    ["support/shared/fake-pages.mjs", ["tests/test/read-pages.test.mjs"], [{ from: "./lib/pages.mjs", support: "support/shared/lib/pages.mjs" }]],
    ["support/shared/lib/pages.mjs", ["support/shared/fake-pages.mjs"], [{ from: "./deep/words.mjs", support: "support/shared/lib/deep/words.mjs" }, { from: "./gone.mjs", support: null, why: `shared/lib/gone.mjs could not be read at ${r.commit.slice(0, 12)}` }]],
    ["support/shared/lib/deep/words.mjs", ["support/shared/lib/pages.mjs"], [{ from: "left-pad", package: "left-pad" }]],
  ], "the whole closure, three levels down; node's own modules are not copied");
  const as = (p) => readFileSync(join(j.jobDir, "out", "as-built", p));
  assert.ok(as("tests/test/read-pages.test.mjs").equals(readFileSync(join(r.agent, "test", "read-pages.test.mjs"))), "carried byte for byte");
  assert.ok(as("support/shared/lib/deep/words.mjs").equals(readFileSync(join(r.top, "shared", "lib", "deep", "words.mjs"))));
  assert.ok(tg.gaps.some((g) => g.part === "existing tests and gaps" && /imports the package left-pad/.test(g.about)));
  assert.ok(tg.gaps.some((g) => /shared\/lib\/gone\.mjs could not be read/.test(g.why)));

  const record = readPiece(j.jobDir, "record.json");
  assert.deepEqual(record.parts.map((p) => p.file).slice(-1), ["strings.json"]);
  assert.deepEqual(record.carried_files.map((c) => c.file), ["tests/test/fixtures/sample.txt", "tests/test/read-pages.test.mjs", "support/shared/fake-pages.mjs", "support/shared/lib/pages.mjs", "support/shared/lib/deep/words.mjs"]);
  assert.deepEqual(record.counts.completeness, {
    exports: { found: 5, covered: 5, missing: 0 }, files_written: { found: 1, covered: 1, missing: 0 }, commands_required_flags: { found: 1, covered: 1, missing: 0 },
    declarations: { found: 20, covered: 20, missing: 0 }, strings: { found: 4, covered: 4, missing: 0 }, missing: 0,
  });
  assert.ok(!tg.gaps.some((g) => g.kind === "incomplete"));
  assert.match(out.reply, /The completeness check found nothing a rebuild needs missing; 4 strings and patterns are in strings\.json, and 5 files of the original tests are carried/);
  assert.deepEqual(checkDelivered(j.jobDir, { undeclared: true }), []);
});

test("the completeness check names what the record misses, each as a gap", () => {
  const files = {
    "a.mjs": "#!/usr/bin/env node\nimport { writeFileSync } from \"node:fs\";\nexport const A = 1;\nexport function f() {}\nif (process.argv[2] === \"--x\") writeFileSync(\"o.txt\", \"Some words here.\");\n",
    "agent-descriptor.json": "{\n  \"name\": \"A\"\n}\n",
  };
  const list = Object.keys(files);
  const read = reader(files);
  const s = readSurface(list, read, { isTest: isTestFile });
  const c = completeness({ surface: s, interfaces: [{ kind: "function", module: "a.mjs", export: "f" }, { kind: "command", command: "a.mjs", required_flags: [], flags_unsettled: [{ flag: "--x", why: "not followed" }] }], files: list, read, strings: [] });
  assert.deepEqual(c.counts, {
    exports: { found: 2, covered: 1, missing: 1 }, files_written: { found: 1, covered: 0, missing: 1 }, commands_required_flags: { found: 1, covered: 0, missing: 1 },
    declarations: { found: 1, covered: 0, missing: 1 }, strings: { found: 1, covered: 0, missing: 1 }, missing: 5,
  });
  assert.deepEqual(c.gaps.map((g) => [g.kind, g.part, g.about]), [
    ["incomplete", "completeness", "the export A of a.mjs"], ["incomplete", "completeness", "the file o.txt written by a.mjs"],
    ["incomplete", "completeness", "the required flags of the command a.mjs"], ["incomplete", "completeness", "name of the descriptor (agent-descriptor.json name)"],
    ["incomplete", "completeness", "the string \"Some words here.\" at a.mjs:5"],
  ]);
  assert.match(c.gaps[2].why, /not settled for --x \(not followed\)/);
});

test("--repository-root: a codebase with no history reads its support files from the folder named, and says the commit was not checked", async () => {
  const r = repository({ checkout: false });
  const { j } = await describe(r, ["--repository-root", r.top]);
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  assert.deepEqual(tg.support.map((x) => x.at), ["support/shared/fake-pages.mjs", "support/shared/lib/pages.mjs", "support/shared/lib/deep/words.mjs"]);
  assert.ok(existsSync(join(j.jobDir, "out", "as-built", "support", "shared", "lib", "deep", "words.mjs")));
  assert.equal(tg.gaps.filter((g) => g.kind === "not-checked" && /^that support\//.test(g.about)).length, 3);

  // Without it, and with no history, the repository's top is not known: a gap, nothing copied.
  const bare = repository({ checkout: false });
  const second = await describe(bare);
  const tg2 = readPiece(second.j.jobDir, "tests-and-gaps.json");
  assert.deepEqual(tg2.support, []);
  assert.ok(tg2.gaps.some((g) => g.part === "existing tests and gaps" && /no --repository-root was named/.test(g.why)));
});
