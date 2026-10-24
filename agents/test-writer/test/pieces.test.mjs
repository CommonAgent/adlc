// The pieces: what the adapter reads when the reply is sent.
//   node --test test/pieces.test.mjs
//
// One piece per test file, each carrying the sentence the file wrote about
// itself, so a reader choosing which to open first has it. What could not be
// tested goes as a file only when there is something in it. And nothing is
// written until every copy has a source, so a refused delivery leaves no
// half-filled folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STEP_OF, aboutOf, fill, plan } from "../scripts/pieces.mjs";

const FILE = "// The reader: who answered and who did not.\n// Nothing here touches the platform.\n//   node --test test/read.test.mjs\n//\n// A second block that is not the sentence.\nimport { test } from \"node:test\";\n";

test("a file's sentence about itself is its opening comment, without the run line", () => {
  assert.equal(aboutOf(FILE, "test/read.test.mjs"), "read.test.mjs: The reader: who answered and who did not. Nothing here touches the platform.");
  assert.equal(aboutOf("import { test } from \"node:test\";\n", "test/x.test.mjs"), "x.test.mjs, a test file that says nothing about itself");
  assert.ok(aboutOf("// " + "x".repeat(500) + "\n", "test/long.test.mjs").length < 300, "a long sentence is cut");
});

test("one piece per test file, with the step that made it, and what could not be tested only when there is something", () => {
  const files = [{ path: "test/read.test.mjs", text: FILE }, { path: "test/say.test.mjs", text: "// says\nimport { test } from \"node:test\";\n" }];
  const { entries, copies } = plan({ workDir: "/w", files, couldNot: [{ what: "the platform read", why: "no stand-in" }, { what: "  " }] });
  assert.deepEqual(entries.map((e) => [e.name, e.step, e.path, e.media_type]), [
    ["read.test.mjs", STEP_OF["test file"], "out/test/read.test.mjs", "text/javascript"],
    ["say.test.mjs", STEP_OF["test file"], "out/test/say.test.mjs", "text/javascript"],
    ["what it could not test", STEP_OF["what it could not test"], "out/could-not-test.txt", "text/plain"],
  ]);
  assert.match(entries[0].about, /^read\.test\.mjs: The reader/);
  assert.deepEqual(entries[0].produced_from, ["spec"]);
  assert.equal(copies[0].from, join("/w", "test/read.test.mjs"));
  assert.equal(copies[2].text, "the platform read: no stand-in\n", "a could-not with nothing in it is not written");
  const none = plan({ workDir: "/w", files, couldNot: [] });
  assert.equal(none.entries.length, 2, "no file saying nothing could not be tested");
});

test("a plan needs a suite and a work folder", () => {
  assert.throws(() => plan({ workDir: "/w", files: [] }), /nothing was written/);
  assert.throws(() => plan({ files: [{ path: "test/a.test.mjs", text: "" }] }), /no work folder/);
});

test("nothing is written until every copy has a source, and then every piece is under out/ with pieces.json beside them", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-writer-pieces-"));
  try {
    const work = join(dir, "work");
    const job = join(dir, "job");
    mkdirSync(join(work, "test"), { recursive: true });
    mkdirSync(job, { recursive: true });
    writeFileSync(join(work, "test", "read.test.mjs"), FILE);
    const files = [{ path: "test/read.test.mjs", text: FILE }, { path: "test/missing.test.mjs", text: "// gone\n" }];
    assert.throws(() => fill(job, plan({ workDir: work, files, couldNot: [] })), /missing\.test\.mjs is not at/);
    assert.equal(existsSync(join(job, "pieces.json")), false, "a refused delivery leaves no list");
    assert.equal(existsSync(join(job, "out")), false, "and no half-filled folder");
    const listed = fill(job, plan({ workDir: work, files: [files[0]], couldNot: [{ what: "x", why: "y" }] }));
    assert.equal(listed.length, 2);
    assert.equal(readFileSync(join(job, "out", "test", "read.test.mjs"), "utf8"), FILE);
    assert.equal(readFileSync(join(job, "out", "could-not-test.txt"), "utf8"), "x: y\n");
    assert.deepEqual(JSON.parse(readFileSync(join(job, "pieces.json"), "utf8")).map((e) => e.name), ["read.test.mjs", "what it could not test"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
