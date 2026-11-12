// The reference builder was built through this plugin: its record, its own
// files and its standard checks are what the generators write from its
// sources, its scripts read nothing its files do not declare, and its suite
// passes.
//
//   node --test plugin/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filesFrom, recordFrom, standardTestsOf } from "../kit/generate.mjs";
import { answerValues } from "../kit/answers.mjs";
import { runTests, undeclaredReads } from "../kit/stages.mjs";

const AT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agents", "reference-builder");
const read = (n) => readFileSync(join(AT, n), "utf8");
const json = (n) => JSON.parse(read(n));

test("the reference builder's record is what the generator writes from its facts and answers", async () => {
  const r = await recordFrom({ spec: json("spec.json"), named: json("architecture.json"), answers: answerValues(json("answers.json")), request: read("request.md") });
  assert.equal(r.done, true);
  assert.equal(r.text, read("architecture-record.md"));
});

test("the reference builder's own files and standard checks are what the generators write", () => {
  const r = filesFrom({ spec: json("spec.json"), recordText: read("architecture-record.md"), prose: json("prose.json") });
  assert.deepEqual(r.empty, []);
  for (const [rel, text] of Object.entries(r.files)) assert.equal(read(rel), text, rel);
  for (const [rel, text] of Object.entries(standardTestsOf(json("spec.json")))) assert.equal(read(rel), text, rel);
});

test("the reference builder reads nothing its files do not declare, and its suite passes", () => {
  assert.deepEqual(undeclaredReads(AT), []);
  const run = runTests(AT, ["test/f1-build-an-agent.test.mjs", "test/printed-reply.test.mjs", "test/delivered-formats.test.mjs", "test/records-per-job.test.mjs", "test/worked-values.test.mjs", "test/kept-interfaces.test.mjs"]);
  assert.equal(run.fails, false, run.failing.join("\n"));
});
