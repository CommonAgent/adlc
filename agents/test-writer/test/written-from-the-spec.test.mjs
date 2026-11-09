// The job finds the spec (spec-v1) among what came, and the writing step
// writes the suite from it (test-writer 0.9.0).
//   node --test test/written-from-the-spec.test.mjs
//
// What is worth pinning. A round trip on 2026-11-09 attached the as-built
// record's files beside the agent's own, and the job dropped every one of
// them without a word: it picked out the agent's files, test files and
// scripts, and nothing else. So:
// - the spec is found by content under the name a hop gave it, laid out by
//   its bytes beside the work folder, and handed to the writing step alone as
//   SPEC_V1; it is never taken for a suite or a file the change depends on;
// - the agent's own files still come and are still the folder every step
//   reads; a spec with no agent's files is refused in words;
// - run as it runs on a host, against a stand-in model server on this
//   machine, the writing step sends the spec whole, sends back the scenario
//   the first answer missed, adds test/kept-interfaces.test.mjs made from the
//   spec, says what it could not test, and records the spec it wrote from;
//   with no spec it says it went without one.
//
// Nothing here reaches a real network or a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runJob } from "../scripts/job.mjs";
import { declaredOf } from "../scripts/declared.mjs";
import { specOfFolder } from "../scripts/agent-folder.mjs";
import { keptInterfacesTest } from "../scripts/kept-interfaces.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "spec-v1");
const AGENT = join(FIXTURE, "points-reader");
const SPEC_PATH = join(FIXTURE, "points-reader.spec.json");
const SPEC_TEXT = readFileSync(SPEC_PATH, "utf8");
const ANSWER = readFileSync(join(FIXTURE, "answer-read.test.txt"), "utf8");
const MASTER = readFileSync(join(HERE, "..", "references", "kept-interfaces.test.mjs"), "utf8");

const folders = async (fn) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-from-spec-"));
  try { return await fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

/** The agent's files and the spec, as attachments named the way pieces arrive. */
function attachments(dir) {
  const files = [];
  const put = (from, sent) => { const at = join(dir, `${files.length}-Ab12cdEF-${sent}`); cpSync(from, at); files.push({ path: at }); };
  put(SPEC_PATH, "spec");
  for (const f of ["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json"]) put(join(AGENT, f), f);
  put(join(AGENT, "skills", "read-points", "SKILL.md"), "read-points.SKILL.md");
  return files;
}

function fakeSpawn(ran) {
  return (bin, argv, opts) => {
    ran.push({ script: basename(argv[0]), env: opts.env });
    const a = basename(argv[0]) === "reply.mjs" ? { ok: true, code: 0, reply: "done" } : { ok: true, code: 0 };
    return { status: 0, stdout: `${JSON.stringify(a)}\n`, stderr: "" };
  };
}

test("the spec is found by content, laid out by its bytes beside the work folder, and handed to the writing step alone", async () => {
  await folders(async (dir) => {
    const ran = [];
    const out = runJob({ job: join(dir, "job-1"), records: join(dir, "records"), work: join(dir, "work"), files: attachments(dir), spawn: fakeSpawn(ran) });
    assert.equal(out.ok, true, out.reply);
    const write = ran.find((r) => r.script === "write-suite.mjs");
    assert.equal(write.env.SPEC_V1, `${join(dir, "work", "job-1")}.spec.json`);
    assert.equal(readFileSync(write.env.SPEC_V1, "utf8"), SPEC_TEXT, "the same bytes as came");
    assert.equal(write.env.SPEC, join(dir, "records", "job-1", "agent"), "the agent's files are still the folder every step reads");
    assert.equal(write.env.EXISTING, undefined, "the spec is not a suite");
    assert.equal(write.env.DEPENDS, undefined, "nor a file the change depends on");
    for (const r of ran.filter((x) => x.script !== "write-suite.mjs")) assert.equal(r.env.SPEC_V1, undefined, r.script);
  });
});

test("a spec with no agent's files is refused in words, and nothing runs", async () => {
  await folders(async (dir) => {
    const at = join(dir, "0-Ab12cdEF-spec");
    cpSync(SPEC_PATH, at);
    const ran = [];
    const out = runJob({ job: join(dir, "j"), records: join(dir, "r"), work: join(dir, "w"), files: [{ path: at }], spawn: fakeSpawn(ran) });
    assert.equal(out.ok, false);
    assert.equal(out.code, 3);
    assert.match(out.reply, /^The spec came and the agent's own files did not/);
    assert.equal(ran.length, 0);
  });
});

/** A stand-in model server on this machine, speaking openai-chat as a
 *  stream: each answer in turn, and every prompt it was sent. */
function standIn(answers) {
  const prompts = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const doc = JSON.parse(body);
        prompts.push(doc.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join(""))).join("\n"));
        const text = answers[Math.min(prompts.length, answers.length) - 1];
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`data: ${JSON.stringify({ model: "stand-in", choices: [{ index: 0, delta: { content: text } }] })}\n\n`
          + `data: ${JSON.stringify({ model: "stand-in", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ endpoint: `http://127.0.0.1:${server.address().port}`, prompts, close: () => new Promise((r) => server.close(r)) }));
  });
}

/** The writing step, run as job.mjs runs it, with the model settings
 *  pointing at the stand-in. */
function writeSuite(env) {
  return new Promise((resolve) => {
    const clean = { ...process.env };
    for (const k of Object.keys(clean)) if (k.startsWith("NODE_TEST_") || k.startsWith("MODEL_")) delete clean[k];
    const child = spawn(process.execPath, [join(HERE, "..", "scripts", "write-suite.mjs")], { env: { ...clean, ...env } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const block = (text) => `<<<FILE test/read.test.mjs>>>\n${text}<<<END>>>\n<<<NOTES>>>\nNo worked values: every expectation is a fixed word, a pattern or the spec's own limit.\n<<<END>>>`;

test("run against a stand-in model, the step sends the spec whole, sends back the scenario it missed, and adds the kept-interfaces check made from the spec", { timeout: 300000 }, async () => {
  await folders(async (dir) => {
    const records = join(dir, "records", "job-1");
    const work = join(dir, "work", "job-1");
    mkdirSync(records, { recursive: true });
    writeFileSync(join(records, "declared.json"), JSON.stringify(declaredOf(specOfFolder(AGENT))));
    const first = ANSWER.replace(/\ntest\("\[F1\.A2\][\s\S]*?\n\}\);\n/, "\n");
    assert.notEqual(first, ANSWER);
    const model = await standIn([block(first), block(ANSWER)]);
    try {
      const r = await writeSuite({
        DECLARED: join(records, "declared.json"), SPEC: AGENT, RECORDS: records, WORK: work, SPEC_V1: SPEC_PATH,
        MODEL_NAME: "stand-in", MODEL_ENDPOINT: model.endpoint, MODEL_PROTOCOL: "openai-chat", MODEL_KEY: "",
      });
      assert.equal(r.code, 0, r.stderr);
      // What the model saw.
      assert.equal(model.prompts.length, 2);
      const [p1, p2] = model.prompts;
      assert.ok(p1.includes(`--- THE SPEC ---\nThis is the spec (spec-v1), given whole`));
      assert.ok(p1.includes(JSON.stringify(JSON.parse(SPEC_TEXT), null, 2)), "the spec whole");
      assert.ok(p1.indexOf("--- THE SPEC ---") < p1.indexOf("--- WHAT THE AGENT'S FILES DECLARE ---"));
      assert.ok(p1.includes("--- THE AGENT'S OWN FILES ---"));
      assert.doesNotMatch(p1, /WHAT WAS WRONG/);
      assert.match(p2, /WHAT WAS WRONG WITH YOUR LAST SUITE[\s\S]*no test is named for the acceptance scenario F1\.A2 \("a list longer than the limit"\)/);
      // What was written.
      const kept = keptInterfacesTest(JSON.parse(SPEC_TEXT), MASTER);
      assert.equal(readFileSync(join(work, "test", "kept-interfaces.test.mjs"), "utf8"), kept.text);
      assert.deepEqual(readdirSync(join(work, "test")).sort(), ["delivered-formats.test.mjs", "kept-interfaces.test.mjs", "printed-reply.test.mjs", "read.test.mjs", "records-per-job.test.mjs", "worked-values.test.mjs"]);
      const suite = JSON.parse(readFileSync(join(records, "suite.json"), "utf8"));
      assert.deepEqual(suite.findings, []);
      assert.equal(suite.stand_ins.fails, true, "the suite fails against empty stand-ins");
      assert.deepEqual(suite.spec.scenarios, ["F1.A1", "F1.A2", "F2.A1"]);
      assert.deepEqual(suite.spec.kept, ["I1", "I2", "I3", "I4"]);
      assert.deepEqual(suite.spec.kept_tests, kept.tests);
      assert.ok(suite.generated.includes("test/kept-interfaces.test.mjs"));
      assert.ok(suite.could_not.some((c) => /I4/.test(c.what)), "what the kept check cannot hold is said beside the suite");
      const ww = existsSync(join(records, "went-without.json")) ? readFileSync(join(records, "went-without.json"), "utf8") : "[]";
      assert.doesNotMatch(ww, /spec-v1/);
    } finally { await model.close(); }
  });
});

test("with no spec, the step writes from the agent's files alone and says it went without the spec", { timeout: 300000 }, async () => {
  await folders(async (dir) => {
    const records = join(dir, "records", "job-1");
    const work = join(dir, "work", "job-1");
    mkdirSync(records, { recursive: true });
    writeFileSync(join(records, "declared.json"), JSON.stringify(declaredOf(specOfFolder(AGENT))));
    const model = await standIn([block(ANSWER)]);
    try {
      const r = await writeSuite({
        DECLARED: join(records, "declared.json"), SPEC: AGENT, RECORDS: records, WORK: work,
        MODEL_NAME: "stand-in", MODEL_ENDPOINT: model.endpoint, MODEL_PROTOCOL: "openai-chat", MODEL_KEY: "",
      });
      assert.equal(r.code, 0, r.stderr);
      assert.doesNotMatch(model.prompts[0], /This is the spec \(spec-v1\), given whole|--- WHAT THE AGENT'S FILES DECLARE ---/);
      assert.match(model.prompts[0], /--- THE SPEC ---\n\{/, "the reading of the agent's files is the spec, as before");
      assert.equal(existsSync(join(work, "test", "kept-interfaces.test.mjs")), false);
      assert.match(readFileSync(join(records, "went-without.json"), "utf8"), /the spec \(spec-v1\), which Requirements hands back/);
      assert.equal(JSON.parse(readFileSync(join(records, "suite.json"), "utf8")).spec, undefined);
    } finally { await model.close(); }
  });
});
