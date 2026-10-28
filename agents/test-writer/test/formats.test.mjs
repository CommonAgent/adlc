// Every suite carries the standard check that each delivered piece is in its
// declared format (owner, 2026-10-27).
//   node --test test/formats.test.mjs
//
// What is worth pinning. The check is one file, test/delivered-formats.test.mjs,
// whose master copy ships in references/ and is added to every suite this
// writes, never written by the model and never answered with. The model's
// tests call its checkDelivered on each job folder they fill, and a suite
// whose declaration has outputs and whose tests never call it is sent back
// with that finding, once in one ask and over the whole suite in parts. The
// check itself bites: against a real script that delivers JSON where Markdown
// is declared, the suite fails, and against one that delivers the declared
// convention it passes.
//
// Nothing here reaches a network or a model; the stand-in and proving runs
// spawn node over scratch folders that are removed whatever happens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORMAT_TEST, NO_FORMAT_CHECK, askForSuite, refreshFormatTest, callsFormatCheck, declaresOutputs, formatTestAt, staticFindings, withFormatTest,
  INSTRUCTION,
} from "../scripts/write-suite.mjs";
import { provingRuns, standInRun } from "../scripts/check-suite.mjs";
import { declaredOf } from "../scripts/declared.mjs";
import { checkDelivered, conventionOf, formatProblems, sampleOf } from "../references/delivered-formats.test.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MASTER = join(HERE, "..", "references", "delivered-formats.test.mjs");
const FORMAT_TEXT = readFileSync(MASTER, "utf8");

const ABOUT = "Markdown: a header `source`, then `## Key points` with one bullet per point.";
const SPEC = {
  name: "key-points", version: "0.1.0", description: "Lists a page's key points for a person to review.",
  jobs: [{
    slug: "list-the-key-points", title: "List the key points", offered: true,
    inputs: [{ name: "page", kind: "url", required: true, given_by: "person" }],
    outputs: [{ name: "key points", kind: "text/markdown", when: "per_task", about: ABOUT }],
    scripts: ["scripts/points.mjs"],
  }],
  refuses: ["inventing a point the page does not make"], records: ["the job manifest"],
};

/** The test a model would write: run the script into a job folder, then hold
 *  what it delivered to the declared formats. */
const MODEL_TEST = `// The points script files its piece.
//   node --test test/points.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fill } from "../scripts/points.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

test("the key points are filed in their declared format", () => {
  const jobDir = mkdtempSync(join(tmpdir(), "points-"));
  try {
    fill(jobDir, "https://example.com");
    assert.deepEqual(checkDelivered(jobDir), []);
  } finally { rmSync(jobDir, { recursive: true, force: true }); }
});

test("a second page is filed the same way", () => {
  const jobDir = mkdtempSync(join(tmpdir(), "points-"));
  try {
    fill(jobDir, "https://example.org");
    assert.deepEqual(checkDelivered(jobDir), []);
  } finally { rmSync(jobDir, { recursive: true, force: true }); }
});
`;

const script = (body) => `import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function fill(jobDir, url) {
  mkdirSync(join(jobDir, "out"), { recursive: true });
  writeFileSync(join(jobDir, "out", "points.md"), ${body});
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify([{ name: "key points", path: "out/points.md", media_type: "text/markdown" }]));
}
`;

const folders = (fn) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-formats-"));
  try { return fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

test("the format check ships among the references, for both skills that write a suite", () => {
  assert.equal(formatTestAt({}), MASTER);
  const plugin = JSON.parse(readFileSync(join(HERE, "..", "plugin.json"), "utf8"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  for (const slug of ["write-a-suite", "write-the-suite"]) {
    assert.ok(skills[slug].references.includes("references/delivered-formats.test.mjs"), `${slug} does not carry it`);
  }
  assert.equal(FORMAT_TEST, "test/delivered-formats.test.mjs");
});

test("the format check is added to a suite once, and kept when the suite has it", () => {
  const one = [{ path: "test/a.test.mjs", text: "x" }];
  assert.deepEqual(withFormatTest(one, FORMAT_TEXT).map((f) => f.path), ["test/a.test.mjs", FORMAT_TEST]);
  const has = [...one, { path: FORMAT_TEST, text: "kept" }];
  assert.equal(withFormatTest(has, FORMAT_TEXT), has);
});

test("the model is told to call the check and never to write it", () => {
  assert.match(INSTRUCTION, /test\/delivered-formats\.test\.mjs, which the test writer adds\nitself\. Do not write it/);
  assert.match(INSTRUCTION, /import \{ checkDelivered \} from "\.\/delivered-formats\.test\.mjs"/);
});

test("a suite that never calls the check, for a spec with outputs, is a finding; one that calls it is not", () => {
  const declared = declaredOf(SPEC);
  assert.equal(declaresOutputs(declared), true);
  const without = [{ path: "test/points.test.mjs", text: MODEL_TEST.replace(/checkDelivered/g, "nothing") }];
  assert.ok(staticFindings(without, declared, { formatCheck: true }).includes(NO_FORMAT_CHECK));
  const withIt = [{ path: "test/points.test.mjs", text: MODEL_TEST }];
  assert.equal(callsFormatCheck(withIt), true);
  assert.ok(!staticFindings(withIt, declared, { formatCheck: true }).includes(NO_FORMAT_CHECK));
  assert.equal(declaresOutputs(declaredOf({ ...SPEC, jobs: [{ ...SPEC.jobs[0], outputs: [] }] })), false);
});

test("an answer that writes the format check itself is told it is the test writer's", () => {
  const found = staticFindings([{ path: FORMAT_TEST, text: FORMAT_TEXT }, { path: "test/points.test.mjs", text: MODEL_TEST }], declaredOf(SPEC));
  assert.match(found.join(" "), /written by the test writer itself/);
});

test("the second ask carries the missing check, and the stand-in run gets the check beside the suite", async () => {
  const sent = []; const ran = [];
  const answer = (text) => `<<<FILE test/points.test.mjs>>>\n${text}<<<END>>>`;
  const out = await askForSuite({
    declared: declaredOf(SPEC), spec: SPEC, formatTest: FORMAT_TEXT,
    call: async (request) => {
      sent.push(request.body.contents[0].parts.map((p) => p.text).join("\n"));
      return answer(sent.length === 1 ? MODEL_TEST.replace(/checkDelivered/g, "nothing") : MODEL_TEST);
    },
    run: async (files) => { ran.push(files.map((f) => f.path)); return { tests: 2, pass: 0, fail: 2, fails: true, status: 1 }; },
  });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /no test calls checkDelivered\(jobDir\)/);
  assert.deepEqual(out.findings, []);
  assert.deepEqual(ran, [["test/points.test.mjs", FORMAT_TEST]]);
});

test("the check bites: JSON delivered as Markdown fails the suite, and the declared convention passes it", () => {
  folders((at) => {
    const files = withFormatTest([{ path: "test/points.test.mjs", text: MODEL_TEST }], FORMAT_TEXT);
    // Against nothing it fails, as every suite must.
    assert.ok(standInRun({ spec: SPEC, files }).fails);
    const pkg = (name, body) => {
      const dir = join(at, name);
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "scripts", "points.mjs"), script(body));
      writeFileSync(join(dir, "spec.json"), JSON.stringify(SPEC));
      return dir;
    };
    const good = provingRuns({ spec: SPEC, files, realDir: pkg("good", "`---\\nsource: ${url}\\n---\\n\\n## Key points\\n\\n- one\\n`") });
    assert.equal(good.real.fails, false, JSON.stringify(good.real));
    assert.equal(good.mutations[0].noticed, true);
    const json = provingRuns({ spec: SPEC, files, realDir: pkg("json", "JSON.stringify({ source: url, points: ['one'] })") });
    assert.equal(json.real.fails, true, "a JSON dump passed as the declared Markdown");
  });
});

test("the checker reads pieces.json, the media type it lists, and the convention's headings", () => {
  folders((jobDir) => {
    const decl = { offerings: [{ id: "x", outputs: [{ name: "key points", kind: "text/markdown", about: ABOUT }] }] };
    mkdirSync(join(jobDir, "out"));
    writeFileSync(join(jobDir, "out", "p.md"), "source: x\n\n## Key points\n\n- one\n");
    writeFileSync(join(jobDir, "out", "extra.txt"), "x");
    const list = (media) => writeFileSync(join(jobDir, "pieces.json"), JSON.stringify([
      { name: "key points", path: "out/p.md", media_type: media }, { name: "extra", path: "out/extra.txt" }]));
    list("text/markdown");
    assert.deepEqual(checkDelivered(jobDir, { declaration: decl }), []);
    assert.deepEqual(checkDelivered(jobDir, { declaration: decl, undeclared: true }), ['the piece "extra" is delivered and no output declares it']);
    list("application/json");
    assert.deepEqual(checkDelivered(jobDir, { declaration: decl }), ['the piece "key points" is listed as application/json and declared text/markdown']);
  });
  assert.deepEqual(conventionOf(ABOUT), { headings: ["## Key points"], header: ["source"], shape: null });
  assert.deepEqual(formatProblems('{"a":1}', "application/vnd.agentmesh.x+json", "`{a, b?}`"), []);
});


test("a suite being added to gets the current check, and keeps one that is already the same bytes", () => {
  const other = { path: "test/a.test.mjs", text: "x" };
  const old = { path: FORMAT_TEST, text: "an older copy" };
  const r = refreshFormatTest([other, old], FORMAT_TEXT);
  assert.deepEqual(r.existing, [other]);
  assert.deepEqual(r.generated, [{ path: FORMAT_TEST, text: FORMAT_TEXT }]);
  const same = { path: FORMAT_TEST, text: FORMAT_TEXT };
  assert.deepEqual(refreshFormatTest([other, same], FORMAT_TEXT), { existing: [other, same], generated: [] });
  assert.deepEqual(refreshFormatTest([other], FORMAT_TEXT).generated.map((f) => f.path), [FORMAT_TEST]);
});

test("a header may follow a title line and be written bold or as a list item", () => {
  const about = "Markdown: a header `source, read_at`, then `## Key points`.";
  assert.deepEqual(formatProblems("# A page\n\nsource: x\n**Read_at:** y\n\n## Key points\n- a\n", "text/markdown", about), []);
  assert.deepEqual(formatProblems("# A page\n\n- **source:** x\n- read_at: y\n\n## Key points\n", "text/markdown", about), []);
  assert.match(formatProblems("# A page\n\n## Key points\nsource: x\n", "text/markdown", about).join(" "), /no source: line/);
});

test("a markdown output that sketches no convention is held only to being markdown", () => {
  assert.equal(sampleOf("text/markdown", "plain notes a person reads"), null);
  assert.deepEqual(formatProblems("Some notes.\n", "text/markdown", "plain notes a person reads"), []);
  assert.match(formatProblems('{"notes":1}', "text/markdown", "plain notes").join(" "), /is JSON/);
});
