// The files a change depends on: attached scripts and shared copies.
//   node --test test/dependencies.test.mjs
//
// What is pinned: an attached dependency's text and its exported names reach
// the request the writer builds; a shared copy the spec names reaches it too,
// read from this package's own copy (scripts/model-caller.mjs,
// scripts/went-without.mjs, scripts/agent-folder.mjs); a test importing a
// name a dependency does not export is a static finding naming both the name
// and the file; a test importing only exported names is not a finding; and
// with no dependency attached and none named, the request is as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportsOf, requestParts, sharedDependencies, staticFindings,
} from "../scripts/write-suite.mjs";
import { findDependencies } from "../scripts/job.mjs";

test("exports of a dependency script are extracted from its export statements", () => {
  const code = `
export function callModel(prompt, opts) {}
export async function cannotCall(env) {}
export const FILE = "went-without.json";
export let counter = 0;
export class AgentFolder {}
export { existingHelper, alias as renamedHelper };
`;
  const names = exportsOf(code);
  assert.deepEqual(names.sort(), [
    "AgentFolder",
    "FILE",
    "callModel",
    "cannotCall",
    "counter",
    "existingHelper",
    "renamedHelper",
  ]);
  assert.deepEqual(exportsOf("// no exports here\nconst a = 1;\n"), []);
});

test("an attached dependency's text and its exported names reach the request the writer builds", () => {
  const dep = {
    path: "scripts/calc.mjs",
    text: "export function multiply(a, b) { return a * b; }\nexport const PI = 3.14;\n",
    exports: ["multiply", "PI"],
  };
  const spec = { name: "adder", version: "0.1.0", scripts: ["scripts/add.mjs"], jobs: [] };
  const declared = { name: "adder", version: "0.1.0", scripts: ["scripts/add.mjs"], jobs: [] };
  const parts = requestParts({
    spec,
    declared,
    dependencies: [dep],
  });
  const joined = parts.join("\n");
  assert.ok(joined.includes("scripts/calc.mjs"));
  assert.ok(joined.includes("export function multiply(a, b) { return a * b; }"));
  assert.match(joined, /multiply/);
  assert.match(joined, /PI/);
  assert.ok(
    joined.indexOf("THE SPEC THAT SUITE TESTS") < joined.indexOf("THE FILES THE CHANGE DEPENDS ON"),
    "dependencies go after the worked example spec",
  );
});

test("a shared copy the spec names reaches the request too, read from this package's own copy", () => {
  const spec = {
    name: "reasoner",
    version: "0.1.0",
    scripts: ["scripts/model-caller.mjs", "scripts/run.mjs"],
    jobs: [{ slug: "run", scripts: ["scripts/model-caller.mjs", "scripts/run.mjs"] }],
  };
  const declared = {
    name: "reasoner",
    version: "0.1.0",
    scripts: ["scripts/model-caller.mjs", "scripts/run.mjs"],
    jobs: [{ slug: "run", commands: [] }],
  };

  const shared = sharedDependencies(spec);
  assert.ok(shared.length > 0, "shared dependencies found for model-caller");
  const caller = shared.find((s) => s.path === "scripts/model-caller.mjs");
  assert.ok(caller, "scripts/model-caller.mjs is identified as a shared dependency");
  assert.ok(caller.text.includes("callModel"), "read from this package's own copy of model-caller.mjs");
  assert.ok(caller.exports.includes("callModel"));
  assert.ok(caller.exports.includes("cannotCall"));

  const parts = requestParts({ spec, declared });
  const joined = parts.join("\n");
  assert.ok(joined.includes("scripts/model-caller.mjs"));
  assert.ok(joined.includes("callModel"));
  assert.ok(joined.includes("cannotCall"));
});

test("a test importing a name a dependency does not export is a static finding naming both", () => {
  const dep = {
    path: "scripts/model-caller.mjs",
    text: "export function callModel() {}\nexport function cannotCall() {}\n",
    exports: ["callModel", "cannotCall"],
  };
  const declared = {
    name: "reasoner",
    version: "0.1.0",
    scripts: ["scripts/run.mjs"],
    jobs: [],
  };
  const badTest = {
    path: "test/run.test.mjs",
    text: `// tests run
import { test } from "node:test";
import assert from "node:assert/strict";
import { callModel, unknownCall } from "../scripts/model-caller.mjs";
import { run } from "../scripts/run.mjs";

test("a first decision about the run script", () => {
  assert.equal(run(), 1);
});
test("a second decision about calling the model", () => {
  assert.equal(callModel(), 2);
});
`,
  };
  const findings = staticFindings([badTest], declared, { dependencies: [dep] });
  assert.ok(
    findings.some((f) => f.includes("unknownCall") && f.includes("scripts/model-caller.mjs")),
    findings.join(" | "),
  );
});

test("a test importing only exported names from a dependency is not a finding", () => {
  const dep = {
    path: "scripts/model-caller.mjs",
    text: "export function callModel() {}\nexport function cannotCall() {}\n",
    exports: ["callModel", "cannotCall"],
  };
  const declared = {
    name: "reasoner",
    version: "0.1.0",
    scripts: ["scripts/run.mjs"],
    jobs: [],
  };
  const goodTest = {
    path: "test/run.test.mjs",
    text: `// tests run
import { test } from "node:test";
import assert from "node:assert/strict";
import { callModel, cannotCall } from "../scripts/model-caller.mjs";
import { run } from "../scripts/run.mjs";

test("a first decision about the run script", () => {
  assert.equal(run(), 1);
});
test("a second decision about calling the model", () => {
  assert.equal(callModel(), 2);
});
`,
  };
  const findings = staticFindings([goodTest], declared, { dependencies: [dep] });
  assert.ok(!findings.some((f) => f.includes("model-caller.mjs")), findings.join(" | "));
});

test("with no dependency attached and none named, the request is as before", () => {
  const cleanSpec = { name: "adder", version: "0.1.0", scripts: ["scripts/add.mjs"], jobs: [] };
  const cleanDeclared = { name: "adder", version: "0.1.0", scripts: ["scripts/add.mjs"], jobs: [] };
  const parts = requestParts({ spec: cleanSpec, declared: cleanDeclared });
  const joined = parts.join("\n");
  assert.doesNotMatch(joined, /THE FILES THE CHANGE DEPENDS ON/);
});

test("the job finds attached scripts that are not tests as dependencies", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-writer-deps-"));
  try {
    const spec = join(dir, "0-spec.json");
    writeFileSync(
      spec,
      JSON.stringify({ name: "adder", version: "0.1.0", jobs: [{ slug: "add", scripts: ["scripts/add.mjs"] }] }),
    );
    const testFile = join(dir, "1-add.test.mjs");
    writeFileSync(testFile, 'import { test } from "node:test";\ntest("a", () => {});\n');
    const depScript = join(dir, "2-calc.mjs");
    writeFileSync(depScript, "export function calc() { return 1; }\n");
    const notes = join(dir, "3-notes.txt");
    writeFileSync(notes, "just notes\n");

    const files = [{ path: spec }, { path: testFile }, { path: depScript }, { path: notes }];
    const deps = findDependencies(files, spec);
    assert.deepEqual(deps.map((d) => d.path), [depScript]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
