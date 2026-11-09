// The original's own tests travel through the whole job (test-writer 0.10.0).
//   node --test test/carried-suite.test.mjs
//
// What is pinned, with the points-reader spec and agent's files of
// test/fixtures/spec-v1/ and the echo write-up of test/fixtures/carried/:
// - the job command finds the carried manifest among the attachments, places
//   the tests and their support files by code beside the work folder, hands
//   them to the writing step as CARRIED, and reads none of them as a suite
//   to add to, a dependency or a spec;
// - run against a stand-in model, the writing step gives the model the
//   original's tests whole, sends back an answer that takes one of their
//   names or uses __dirname in an ES module, never delivers a file under a
//   carried name, and puts the carried tests, the support files and their
//   record in the work folder beside the suite; the pieces deliver them, the
//   support files keeping their layout;
// - in a revision the record finds them again: a revision naming only a
//   carried test is refused in words, and one that drops a carried test,
//   as the person names it, asks no model and delivers the record with the
//   drop in it.
//
// Nothing here reaches a network or a model service: the model is a stand-in
// server on this machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runJob } from "../scripts/job.mjs";
import { declaredOf } from "../scripts/declared.mjs";
import { specOfFolder } from "../scripts/agent-folder.mjs";
import { sha256 } from "../scripts/carried.mjs";
import { CARRIED_INSTRUCTION } from "../scripts/write-suite.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(HERE, "fixtures", "spec-v1");
const AGENT = join(SPEC_DIR, "points-reader");
const SPEC_PATH = join(SPEC_DIR, "points-reader.spec.json");
const ANSWER = readFileSync(join(SPEC_DIR, "answer-read.test.txt"), "utf8");
const WRITE_UP = join(HERE, "fixtures", "carried", "write-up");
const SUPPORT = ["support/lib/match-reply.mjs", "support/lib/plan.mjs", "support/lib/agreements.mjs", "support/lib/words/table.mjs"];
const ORIGINAL = readFileSync(join(WRITE_UP, "tests", "test", "echo.test.mjs"), "utf8");
const PLACED = ORIGINAL.replace('"../../../lib/match-reply.mjs"', '"./support/lib/match-reply.mjs"');

const folders = async (fn) => {
  const at = mkdtempSync(join(tmpdir(), "test-writer-carried-suite-"));
  try { return await fn(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const MANIFEST = {
  carried_tests: "v1",
  tests: [{ file: "test/echo.test.mjs", at: "tests/test/echo.test.mjs", sha256: sha256(readFileSync(join(WRITE_UP, "tests", "test", "echo.test.mjs"))), imports: [{ from: "../../../lib/match-reply.mjs", support: "support/lib/match-reply.mjs" }] }],
  support: SUPPORT.map((p) => ({ path: p, sha256: sha256(readFileSync(join(WRITE_UP, p))) })),
};

/** Files as attachments, named the way pieces arrive. */
function attacher(dir) {
  const files = [];
  const put = (from, sent, text) => {
    const at = join(dir, `${files.length}-Ab12cdEF-${sent}`);
    if (text !== undefined) writeFileSync(at, text); else cpSync(from, at);
    files.push({ path: at });
  };
  put(SPEC_PATH, "spec");
  for (const f of ["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json"]) put(join(AGENT, f), f);
  put(join(AGENT, "skills", "read-points", "SKILL.md"), "read-points.SKILL.md");
  return { files, put };
}

function fakeSpawn(ran) {
  return (bin, argv, opts) => {
    ran.push({ script: basename(argv[0]), env: opts.env });
    const a = basename(argv[0]) === "reply.mjs" ? { ok: true, code: 0, reply: "done" } : { ok: true, code: 0 };
    return { status: 0, stdout: `${JSON.stringify(a)}\n`, stderr: "" };
  };
}

test("the job finds the manifest, places the original's tests and support files by code, and hands them over as CARRIED, never as a suite or a dependency", async () => {
  await folders(async (dir) => {
    const { files, put } = attacher(dir);
    put(null, "carried", JSON.stringify(MANIFEST));
    put(join(WRITE_UP, "tests", "test", "echo.test.mjs"), "echo.test.mjs");
    for (const p of SUPPORT) put(join(WRITE_UP, p), p.split("/").pop());
    const ran = [];
    const out = runJob({ job: join(dir, "job-1"), records: join(dir, "records"), work: join(dir, "work"), files, spawn: fakeSpawn(ran) });
    assert.equal(out.ok, true, out.reply);
    const write = ran.find((r) => r.script === "write-suite.mjs");
    assert.equal(write.env.CARRIED, `${join(dir, "work", "job-1")}.carried`);
    assert.equal(write.env.EXISTING, undefined, "the original's test is not a suite being added to");
    assert.equal(write.env.DEPENDS, undefined, "a support file is not a file the change depends on");
    assert.ok(write.env.SPEC_V1, "the spec is still found");
    const c = write.env.CARRIED;
    assert.equal(readFileSync(join(c, "test", "echo.test.mjs"), "utf8"), PLACED);
    for (const p of SUPPORT) assert.ok(readFileSync(join(c, "test", p)).equals(readFileSync(join(WRITE_UP, p))), p);
    const record = JSON.parse(readFileSync(join(c, "test", "carried-tests.json"), "utf8"));
    assert.deepEqual(record.placed.map((x) => x.test), ["test/echo.test.mjs"]);
    assert.deepEqual(JSON.parse(readFileSync(join(c, "carried.json"), "utf8")).from, "manifest");
  });
});

/** A stand-in model server speaking openai-chat as a stream. */
function standIn(answers) {
  const prompts = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (x) => { body += x; });
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

function writeSuite(env) {
  return new Promise((resolve) => {
    const clean = { ...process.env };
    for (const k of Object.keys(clean)) if (k.startsWith("NODE_TEST_") || k.startsWith("MODEL_")) delete clean[k];
    const child = spawn(process.execPath, [join(HERE, "..", "scripts", "write-suite.mjs")], { env: { ...clean, ...env } });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (x) => { stdout += x; });
    child.stderr.on("data", (x) => { stderr += x; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const NOTES = "<<<NOTES>>>\nNo worked values: every expectation is a fixed word, a pattern or the spec's own limit.\n<<<END>>>";
const block = (files) => `${files.map(([p, t]) => `<<<FILE ${p}>>>\n${t}<<<END>>>`).join("\n")}\n${NOTES}`;

/** The CARRIED folder job.mjs makes, from the manifest. */
function carriedFolder(dir) {
  const { files, put } = attacher(join(dir));
  put(null, "carried", JSON.stringify(MANIFEST));
  put(join(WRITE_UP, "tests", "test", "echo.test.mjs"), "echo.test.mjs");
  for (const p of SUPPORT) put(join(WRITE_UP, p), p.split("/").pop());
  const ran = [];
  runJob({ job: join(dir, "job-0"), records: join(dir, "records0"), work: join(dir, "work0"), files, spawn: fakeSpawn(ran) });
  return ran.find((r) => r.script === "write-suite.mjs").env.CARRIED;
}

test("run against a stand-in model, the carried tests go to the model whole, keep their name, and are delivered with their support files and record", { timeout: 300000 }, async () => {
  await folders(async (dir) => {
    const records = join(dir, "records", "job-1");
    const work = join(dir, "work", "job-1");
    mkdirSync(records, { recursive: true });
    writeFileSync(join(records, "declared.json"), JSON.stringify(declaredOf(specOfFolder(AGENT))));
    const CARRIED = carriedFolder(dir);
    // The first answer takes the carried test's name and uses __dirname.
    const dirnameUse = ANSWER.replace('const POINTS_LINE', 'const HERE = __dirname;\nconst POINTS_LINE');
    const model = await standIn([block([["test/read.test.mjs", dirnameUse], ["test/echo.test.mjs", "// mine\nimport { test } from \"node:test\";\n"]]), block([["test/read.test.mjs", ANSWER]])]);
    try {
      const r = await writeSuite({
        DECLARED: join(records, "declared.json"), SPEC: AGENT, RECORDS: records, WORK: work, SPEC_V1: SPEC_PATH, CARRIED,
        MODEL_NAME: "stand-in", MODEL_ENDPOINT: model.endpoint, MODEL_PROTOCOL: "openai-chat", MODEL_KEY: "",
      });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(model.prompts.length, 2);
      const [p1, p2] = model.prompts;
      assert.ok(p1.includes(`--- THE ORIGINAL'S OWN TESTS ---\n${CARRIED_INSTRUCTION}`));
      assert.ok(p1.includes(`<<<FILE test/echo.test.mjs>>>\n${PLACED}<<<END>>>`), "the carried test whole, as placed");
      assert.match(p2, /test\/echo\.test\.mjs is one of the original's own tests, carried unchanged and locked/);
      assert.match(p2, /test\/read\.test\.mjs:\d+ uses __dirname, which an ES module does not have/);
      // The work folder holds the suite as it will stand.
      assert.equal(readFileSync(join(work, "test", "echo.test.mjs"), "utf8"), PLACED, "the carried test keeps its name and its bytes");
      for (const p of SUPPORT) assert.ok(readFileSync(join(work, "test", p)).equals(readFileSync(join(WRITE_UP, p))), p);
      assert.ok(existsSync(join(work, "test", "carried-tests.json")));
      const suite = JSON.parse(readFileSync(join(records, "suite.json"), "utf8"));
      assert.deepEqual(suite.findings, []);
      assert.ok(!suite.files.some((f) => f.path === "test/echo.test.mjs"), "the model's files never take a carried name");
      assert.deepEqual(suite.carried.tests.map((t) => [t.path, t.file, t.names]), [["test/echo.test.mjs", "test/echo.test.mjs", ["an echo is matched to the greeting it answers", "an echo of nothing matches nothing"]]]);
      assert.deepEqual(suite.carried.delivered, ["test/echo.test.mjs", ...SUPPORT.map((p) => `test/${p}`).sort(), "test/carried-tests.json"]);
      assert.match(suite.carried.words, /^Carried 1 of the original's own tests unchanged but for their import specifiers \(echo\.test\.mjs\), with the 4 files they import, under test\/support\/; they are locked/);
      // The pieces deliver them, the support files keeping their layout.
      const job = join(dir, "job-1");
      mkdirSync(job, { recursive: true });
      const p = spawnSync(process.execPath, [join(HERE, "..", "scripts", "pieces.mjs")], { env: { ...process.env, JOB_DIR: job, RECORDS: records }, encoding: "utf8" });
      assert.equal(p.status, 0, p.stderr);
      const pieces = JSON.parse(readFileSync(join(job, "pieces.json"), "utf8"));
      for (const want of ["out/test/echo.test.mjs", "out/test/support/lib/words/table.mjs", "out/test/carried-tests.json", "out/test/read.test.mjs"]) {
        assert.ok(pieces.some((x) => x.path === want), want);
        assert.ok(existsSync(join(job, want)), want);
      }
      assert.equal(new Set(pieces.map((x) => x.name)).size, pieces.length, "every piece has a name of its own");
      // The reply says what was carried.
      const reply = spawnSync(process.execPath, [join(HERE, "..", "scripts", "reply.mjs")], { env: { ...process.env, RECORDS: records }, encoding: "utf8" });
      assert.match(JSON.parse(reply.stdout).reply, /Carried 1 of the original's own tests unchanged/);
    } finally { await model.close(); }
  });
});

test("in a revision the record finds the carried tests: naming only one is refused in words, and a drop the person names asks no model and delivers the record", { timeout: 300000 }, async () => {
  await folders(async (dir) => {
    const first = carriedFolder(dir);
    // The suite as delivered, flattened, with a test of the writer's own.
    const { files, put } = attacher(dir);
    put(join(first, "test", "carried-tests.json"), "carried-tests.json");
    put(join(first, "test", "echo.test.mjs"), "echo.test.mjs");
    for (const p of SUPPORT) put(join(first, "test", p), p.split("/").pop());
    put(null, "read.test.mjs", ANSWER);
    const asked = join(dir, "asked.txt");
    writeFileSync(asked, "Revise the suite.\n\nDrop the original test echo.test.mjs: it reads a matcher we no longer keep.\n");
    const ran = [];
    runJob({ job: join(dir, "job-2"), records: join(dir, "records"), work: join(dir, "work"), files, textFile: asked, spawn: fakeSpawn(ran) });
    const env = ran.find((r) => r.script === "write-suite.mjs").env;
    assert.equal(env.REVISE, "1");
    assert.equal(env.DEPENDS, undefined, "no support file is a dependency");
    assert.deepEqual(readdirSync(join(env.EXISTING, "test")), ["read.test.mjs"], "the carried test is not a file a revision may change");
    const meta = JSON.parse(readFileSync(join(env.CARRIED, "carried.json"), "utf8"));
    assert.equal(meta.from, "record");
    assert.deepEqual(meta.dropped.map((d) => d.file), ["test/echo.test.mjs"]);
    // The writing step: no model is reached (the endpoint answers nothing).
    const records = join(dir, "records", "job-2");
    writeFileSync(join(records, "declared.json"), JSON.stringify(declaredOf(specOfFolder(AGENT))));
    const settings = { MODEL_NAME: "stand-in", MODEL_ENDPOINT: "http://127.0.0.1:9", MODEL_PROTOCOL: "openai-chat", MODEL_KEY: "" };
    const r = await writeSuite({ DECLARED: join(records, "declared.json"), SPEC: AGENT, RECORDS: records, WORK: env.WORK, SPEC_V1: env.SPEC_V1, EXISTING: env.EXISTING, CARRIED: env.CARRIED, REVISE: "1", ASKED_TEXT: asked, ...settings });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout.trim().split("\n").at(-1)).calls, 0);
    const suite = JSON.parse(readFileSync(join(records, "suite.json"), "utf8"));
    assert.deepEqual(suite.files, []);
    assert.deepEqual(suite.carried.delivered, ["test/carried-tests.json"]);
    const record = JSON.parse(readFileSync(join(env.WORK, "test", "carried-tests.json"), "utf8"));
    assert.deepEqual(record.placed, []);
    assert.deepEqual(record.dropped.map((d) => [d.file, d.by]), [["test/echo.test.mjs", "the person, by naming it"]]);
    // Naming the carried test, without dropping it, is refused in words.
    const asked2 = join(dir, "asked2.txt");
    writeFileSync(asked2, "Revise the suite.\n\necho.test.mjs is wrong about the greeting.\n");
    const ran2 = [];
    runJob({ job: join(dir, "job-3"), records: join(dir, "records"), work: join(dir, "work"), files, textFile: asked2, spawn: fakeSpawn(ran2) });
    const env2 = ran2.find((x) => x.script === "write-suite.mjs").env;
    const records2 = join(dir, "records", "job-3");
    writeFileSync(join(records2, "declared.json"), JSON.stringify(declaredOf(specOfFolder(AGENT))));
    const r2 = await writeSuite({ DECLARED: join(records2, "declared.json"), SPEC: AGENT, RECORDS: records2, WORK: env2.WORK, SPEC_V1: env2.SPEC_V1, EXISTING: env2.EXISTING, CARRIED: env2.CARRIED, REVISE: "1", ASKED_TEXT: asked2, ...settings });
    const said = JSON.parse(r2.stdout.trim().split("\n").at(-1));
    assert.equal(said.code, 3);
    assert.match(said.reply, /^Nothing was revised: echo\.test\.mjs is one of the original's own tests, carried unchanged, and a revision never changes one\. To take it out of the suite, say "drop the original test echo\.test\.mjs" and ask again\.$/);
  });
});
