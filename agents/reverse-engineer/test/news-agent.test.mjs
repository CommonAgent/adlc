// The job on a small agent with the features a rebuild needs word for word:
// an output file with a format id, an exported async function its test
// imports, a stop-notice pattern, a fallback order, a cap, request headers,
// a test that imports ../shared, and no package.json. The model is stood in.
//   node --test test/news-agent.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runJob } from "../scripts/describe.mjs";
import { FIXTURES, codebase, job, pieceBytes, readPiece } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

function testEnv() {
  const env = { ...process.env };
  for (const k of ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL", "MODEL_MAX_OUTPUT_TOKENS", "TEXT_MODEL", "TEXT_API_KEY"]) delete env[k];
  return env;
}

const ANSWER = JSON.parse(readFileSync(join(FIXTURES, "answers", "news-agent.json"), "utf8"));

/** A stand-in that answers `doc` to every pass, and keeps each prompt. */
function answering(doc) {
  const prompts = [];
  return { prompts, call: async (prompt) => { prompts.push(prompt); return { text: JSON.stringify(doc), answered_by: "stand-in", tokens_in: 1, tokens_out: 1 }; } };
}

async function describe(doc = ANSWER, { mayRun = "yes", id = "job-1", cb = codebase("news-agent") } = {}) {
  const j = job({ root: cb.root, id, codebase: cb.dir, commit: cb.commit, mayRun });
  const model = answering(doc);
  const out = await runJob(j.argv, testEnv(), { call: model.call });
  assert.equal(out.code, 0, out.reply);
  return { cb, j, out, model };
}

test("interfaces: the output file with its schema and format id, the exported functions, the command and its flags", async () => {
  const { j } = await describe();
  const ifs = readPiece(j.jobDir, "interfaces.json");
  const file = ifs.interfaces.find((i) => i.kind === "file");
  assert.deepEqual([file.id, file.name, file.direction, file.content, file.read_by_rule, file.evidence[0]], ["I1", "out/top.json", "out", "json", true, { file: "scripts/read-news.mjs", line: 59 }]);
  assert.match(file.does, /format \(always "news-top-v1"\)/);
  const schema = readPiece(j.jobDir, file.schema);
  assert.deepEqual(schema.properties.format, { type: "string", const: "news-top-v1" }, "the format id read by rule, and the drafted news-top-v2 dropped");
  assert.deepEqual(schema.required, ["format", "fetched_at", "source", "items"]);
  assert.deepEqual(Object.keys(schema.properties.items.items.properties), ["id", "title", "text", "text_from"], "the draft fills the items; the field the code never writes is dropped");
  assert.deepEqual(schema.properties.items.items.properties.text_from.enum, ["article", "summary", "comments"]);

  const readTop = ifs.interfaces.find((i) => i.export === "readTop");
  assert.deepEqual([readTop.kind, readTop.name, readTop.async, readTop.params, readTop.imported_by], ["function", "readTop(count, fetchImpl = fetch)", true, "count, fetchImpl = fetch", ["test/read-news.test.mjs"]]);
  assert.deepEqual(readTop.rejects, [{ error: "Refusal", evidence: [{ file: "scripts/read-news.mjs", line: 34 }] }]);
  assert.equal(readTop.returns, "a promise of the list of items, each with id, title, text and text_from");
  const command = ifs.interfaces.find((i) => i.kind === "command");
  assert.deepEqual([command.name, command.flags], ["scripts/read-news.mjs", ["--count", "--job", "--text-file"]]);

  assert.deepEqual(ifs.constants.map((c) => [c.name, c.value, c.imported_by]), [["FEED", "https://news.example.com/v0", []], ["FORMAT", "news-top-v1", ["test/read-news.test.mjs"]]]);
  assert.deepEqual(ifs.flags.map((f) => f.name), ["--count", "--job", "--text-file"]);
  assert.deepEqual(ifs.settings, [{ name: "count", declared_in: "agent-descriptor.json run_config", evidence: [{ file: "agent-descriptor.json", line: 7 }] }]);
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  assert.ok(tg.gaps.some((g) => g.part === "interfaces" && /"news-top-v2".*not a literal.*items\[\]\.score is not written/.test(g.why)));
  assert.deepEqual(checkDelivered(j.jobDir), []);
});

test("behaviors: one per anchor, each with its kind, quotes byte for byte and rules with evidence", async () => {
  const { j } = await describe();
  const { behaviors } = readPiece(j.jobDir, "behaviors.json");
  assert.deepEqual(behaviors.map((b) => [b.id, b.kind, b.anchor]), [
    ["B1", "fetch", "scripts/read-news.mjs#readTop"], ["B2", "entry", "scripts/read-news.mjs"],
    ["B3", "check", "scripts/stop.mjs#stopNotice"], ["B4", "compose", "scripts/stop.mjs#stoppedReply"],
  ]);
  const stop = behaviors[2].quotes[0];
  assert.equal(stop.text, "/^\\s*halt\\s+(j-\\d{6})\\s*:\\s*stop now\\b/i");
  assert.ok(readFileSync(join(FIXTURES, "news-agent", "scripts", "stop.mjs"), "utf8").split("\n")[stop.evidence[0].line - 1].includes(stop.text), "the quoted pattern is the code's, byte for byte");
  assert.deepEqual(behaviors[3].quotes.map((q) => q.text), ["Nothing was running for ${job}, so nothing was done."]);
  assert.deepEqual(behaviors[0].quotes.map((q) => q.text), ["I cannot read the news feed right now. Nothing was written."]);
  assert.deepEqual(behaviors[0].rules.map((r) => [r.kind, r.evidence[0].line]), [["order", 39], ["limit", 37], ["limit", 26], ["header", 11]]);
  assert.deepEqual(behaviors[0].constants.map((c) => [c.name, c.value]), [["FEED", "https://news.example.com/v0"], ["MOST", 25]]);
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  const held = tg.gaps.filter((g) => g.part === "behaviors").map((g) => g.why);
  assert.equal(held.length, 5);
  assert.ok(held.some((w) => /quoted text is not in scripts\/read-news\.mjs byte for byte/.test(w)));
  assert.ok(held.some((w) => /\("retry"\) is not one of the rule kinds/.test(w)));
  assert.ok(held.some((w) => /one behavior per anchor/.test(w)));
  assert.ok(held.some((w) => /#getJson is not one the granularity rule counts/.test(w)));
  assert.ok(held.some((w) => /\("transform"\) is not one of the behavior kinds/.test(w)));
  assert.deepEqual(tg.tests.map((t) => [t.file, t.covers]), [["test/read-news.test.mjs", ["B1"]], ["test/stop.test.mjs", ["B3", "B4"]]]);
  assert.deepEqual(readPiece(j.jobDir, "record.json").counts.behavior_kinds, { entry: 1, fetch: 1, check: 1, compose: 1 });
});

test("granularity: a draft that splits, reorders and invents kinds comes back to the same behaviors and kinds", async () => {
  const cb = codebase("news-agent");
  const first = await describe(ANSWER, { cb, id: "first", mayRun: "no" });
  const keep = ANSWER.behaviors.slice(0, 4);
  const other = {
    ...ANSWER,
    behaviors: [
      keep[3], keep[1],
      { anchor: "scripts/stop.mjs#stoppedReply", kind: "compose", name: "Name the job", does: "Puts the job in the sentence.", evidence: [{ file: "scripts/stop.mjs", line: 10 }] },
      keep[2],
      { anchor: "scripts/read-news.mjs#parseArgs", kind: "parse", name: "Arguments", does: "Reads the flags.", evidence: [{ file: "scripts/read-news.mjs", line: 15, end_line: 23 }] },
      { kind: "summary", name: "Fallback text", does: "Uses the summary when there is no article.", evidence: [{ file: "scripts/read-news.mjs", line: 39 }] },
      keep[0],
    ].map((b, i) => ({ ...b, id: `B${i + 1}` })),
    tests: [],
  };
  const second = await describe(other, { cb, id: "second", mayRun: "no" });
  const shape = (j) => readPiece(j.jobDir, "behaviors.json").behaviors.map((b) => [b.id, b.kind, b.anchor, b.name]);
  assert.deepEqual(shape(second.j), shape(first.j));
  assert.deepEqual(readPiece(second.j.jobDir, "record.json").counts.behavior_kinds, readPiece(first.j.jobDir, "record.json").counts.behavior_kinds);
  assert.ok(pieceBytes(first.j.jobDir, "interfaces.json").equals(pieceBytes(second.j.jobDir, "interfaces.json")), "the interfaces read by rule do not move with the draft");
});

test("baseline: with no package.json the node:test files run, the record says it ran, and the import from outside is a gap", async () => {
  const { j, out } = await describe();
  const record = readPiece(j.jobDir, "record.json");
  assert.equal(record.read_mode, "read and run");
  assert.equal(out.read_mode, "read and run");
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  assert.equal(tg.test_command.command, "node --test test/read-news.test.mjs test/stop.test.mjs");
  assert.match(tg.test_command.found_by, /no package\.json/);
  assert.deepEqual([tg.baseline.ran, tg.baseline.passed, tg.baseline.failed], [true, 1, 1], tg.baseline.output_tail);
  const outside = tg.gaps.filter((g) => g.kind === "outside-the-codebase" && g.part === "dependencies");
  assert.deepEqual(outside.map((g) => [g.part, g.about, g.evidence]), [["dependencies", "test/read-news.test.mjs imports ../../shared/fake-feed.mjs", [{ file: "test/read-news.test.mjs", line: 3 }]]]);
  assert.match(outside[0].why, /depends on a file outside the codebase's folder/);
});

test("the draft is made in passes, each recorded, each shown the facts read by rule", async () => {
  const { j, model } = await describe(ANSWER, { mayRun: "no" });
  assert.deepEqual(model.prompts.map((p) => p.split("\n")[0]), ["Pass: architecture and interfaces", "Pass: behaviors 1 of 1", "Pass: what each test covers"]);
  assert.match(model.prompts[1], /- scripts\/stop\.mjs#stopNotice \(function, line 4: imported by scripts\/read-news\.mjs, test\/stop\.test\.mjs\)/);
  assert.match(model.prompts[1], /"text": "\/\^\\\\s\*halt/, "the pattern is shown as the code has it");
  assert.match(model.prompts[0], /"schema_read_by_rule"/);
  assert.match(model.prompts[2], /- B1 \[fetch\] Read the top items \(scripts\/read-news\.mjs#readTop\)/);
  const calls = JSON.parse(readFileSync(join(j.recordsDir, "calls.json"), "utf8"));
  assert.deepEqual(calls.passes.map((p) => [p.pass, p.ok, p.calls]), [["architecture and interfaces", true, 1], ["behaviors 1 of 1", true, 1], ["what each test covers", true, 1]]);
  assert.deepEqual(calls.each.map((e) => e.pass), ["architecture and interfaces", "behaviors 1 of 1", "what each test covers"]);
});

test("a pass that fails leaves its part as a gap and the other passes stand", async () => {
  const cb = codebase("news-agent");
  const j = job({ root: cb.root, codebase: cb.dir, commit: cb.commit });
  const call = async (prompt) => {
    if (prompt.startsWith("Pass: architecture")) throw new Error("the service answered 503");
    return { text: JSON.stringify(ANSWER), answered_by: "stand-in" };
  };
  const out = await runJob(j.argv, testEnv(), { call });
  assert.equal(out.code, 0, out.reply);
  assert.equal(readPiece(j.jobDir, "behaviors.json").behaviors.length, 4);
  const tg = readPiece(j.jobDir, "tests-and-gaps.json");
  assert.deepEqual(tg.gaps.filter((g) => g.kind === "not-drafted").map((g) => g.part), ["architecture as built", "interfaces"]);
  const ifs = readPiece(j.jobDir, "interfaces.json");
  assert.ok(ifs.interfaces.some((i) => i.kind === "file" && i.schema), "the interfaces read by rule are still delivered");
});
