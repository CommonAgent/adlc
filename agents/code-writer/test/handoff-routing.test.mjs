// Routing in handoff: escalating messages that do not ask for hand-off.
//
// What is pinned: the hand-off command receives --message <file>; when the
// message's first line begins with "Hand off the code" (any case), hand-off
// proceeds as before, laying out the build folder and filing the archive; for
// any other message, handoff lays nothing out, files no pieces (no pieces.json),
// and prints one JSON object with "escalate": true, exiting 0; tested through
// handoff() and through the command.
// Nothing here touches a network or a real model.
// Run: node --test test/handoff-routing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ARCHIVE_NAME, fromArgv, handoff } from "../scripts/handoff.mjs";
import { pack, unpack } from "../scripts/archive.mjs";
import { DESCRIPTOR_FILE, MANIFEST_FILE, RUNTIME_FILE, readAgentFolder, specOfFolder } from "../scripts/agent-folder.mjs";
import { LOCK_FILE, digestOf, listing, sortAttachments } from "../scripts/workspace.mjs";
import { blankRuns, runSuite, suitePaths } from "../scripts/check.mjs";
import { STEP_OF, aboutOf, fill, plan } from "../scripts/pieces.mjs";
import { FILE, fileIn, note, read, sentence, paragraph } from "../scripts/went-without.mjs";
import * as reportModule from "../scripts/report.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "handoff.mjs");

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-routing-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const AGENT_FILES = {
  [DESCRIPTOR_FILE]: JSON.stringify({
    format: "agent-descriptor-v1",
    agent_version: "0.1.0",
    name: "calculator",
    offerings: [{ id: "calc", name: "Calculate", steps: [] }],
  }),
  [RUNTIME_FILE]: JSON.stringify({
    format: "agent-runtime-requirements-v1",
    runtimes: [{ name: "node", version: ">=22" }],
  }),
  [MANIFEST_FILE]: JSON.stringify({
    name: "calculator",
    version: "0.1.0",
    extensions: {
      "net.agentdoc.package": {
        build: { skills: { calc: { scripts: ["scripts/calc.mjs"] } } },
      },
    },
  }),
  "skills/calc/SKILL.md": "---\nname: calc\n---\n## When to use this\nAlways.\n## What a good result looks like\nGood.\n## When it comes back empty\nEmpty.\n## How to do it\nRun node scripts/calc.mjs\n",
};

const SUITE_FILES = {
  "test/calc.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { calc } from "../scripts/calc.mjs";\ntest("calc", () => { assert.equal(calc(2), 2); });\n',
};

function stageInputs(at) {
  const inDir = join(at, "in");
  mkdirSync(inDir, { recursive: true });
  const fileArgs = [];
  for (const [k, v] of Object.entries(AGENT_FILES)) {
    const p = join(inDir, k.replace(/\//g, "-"));
    writeFileSync(p, v);
    fileArgs.push(`${p}::application/json`);
  }
  const suiteSrc = join(at, "suite-src");
  for (const [rel, text] of Object.entries(SUITE_FILES)) {
    const p = join(suiteSrc, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  const suiteArchive = join(inDir, "suite.tar.gz");
  pack(suiteSrc, suiteArchive);
  fileArgs.push(`${suiteArchive}::application/gzip`);
  return fileArgs;
}

test("fromargv parses the message option as a file path", () => {
  const parsed = fromArgv([
    "--job", "/job/dir",
    "--records", "/records/dir",
    "--work", "/work/dir",
    "--message", "/job/dir/message.txt",
  ]);
  assert.equal(parsed.job, "/job/dir");
  assert.equal(parsed.records, "/records/dir");
  assert.equal(parsed.work, "/work/dir");
  assert.equal(parsed.message ?? parsed.messageFile, "/job/dir/message.txt");

  const parsedEq = fromArgv([
    "--job=/job/dir",
    "--records=/records/dir",
    "--work=/work/dir",
    "--message=/job/dir/message.txt",
  ]);
  assert.equal(parsedEq.message ?? parsedEq.messageFile, "/job/dir/message.txt");
});

test("a message not starting with hand off the code escalates through handoff", () => {
  folder((at) => {
    const jobDir = join(at, "job");
    const recordsDir = join(at, "records");
    const workDir = join(at, "work");
    mkdirSync(jobDir, { recursive: true });
    mkdirSync(recordsDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    const fileArgs = stageInputs(at);
    const files = fileArgs.map((f) => {
      const [path, declared] = f.split("::");
      return { path, declared };
    });

    for (const text of [
      "Please write the scripts for this package.",
      "Fix the failing test in scripts/calc.mjs",
      "hand off is requested soon",
      "",
    ]) {
      const msgFile = join(at, "msg.txt");
      writeFileSync(msgFile, text);

      const res = handoff({
        jobDir,
        recordsDir,
        workDir,
        files,
        message: msgFile,
        messageFile: msgFile,
      });

      assert.equal(res.escalate, true);
      assert.equal(existsSync(join(jobDir, "pieces.json")), false, "no pieces filed on escalation");
      assert.equal(existsSync(join(workDir, "build")), false, "nothing laid out in work on escalation");
    }
  });
});

test("a message starting with hand off the code in any case proceeds through handoff", () => {
  folder((at) => {
    const jobDir = join(at, "job");
    const recordsDir = join(at, "records");
    const workDir = join(at, "work");
    mkdirSync(jobDir, { recursive: true });
    mkdirSync(recordsDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    const fileArgs = stageInputs(at);
    const files = fileArgs.map((f) => {
      const [path, declared] = f.split("::");
      return { path, declared };
    });

    for (const firstLine of [
      "Hand off the code",
      "hand off the code please",
      "HAND OFF THE CODE",
      "Hand off the code, thanks!\nHere are some extra notes.",
    ]) {
      rmSync(join(jobDir, "pieces.json"), { force: true });
      rmSync(join(workDir, "build"), { recursive: true, force: true });

      const msgFile = join(at, "msg.txt");
      writeFileSync(msgFile, `${firstLine}\n`);

      const res = handoff({
        jobDir,
        recordsDir,
        workDir,
        files,
        message: msgFile,
        messageFile: msgFile,
      });

      assert.equal(res.ok, true, res.reply);
      assert.notEqual(res.escalate, true);
      assert.ok(existsSync(join(jobDir, "pieces.json")), "pieces.json written when hand-off proceeds");
      assert.deepEqual(checkDelivered(jobDir), []);
    }
  });
});

test("a message that does not ask for hand-off escalates with exit 0 and files no pieces through the command", () => {
  folder((at) => {
    const jobDir = join(at, "job");
    const recordsDir = join(at, "records");
    const workDir = join(at, "work");
    mkdirSync(jobDir, { recursive: true });
    mkdirSync(recordsDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    const fileArgs = stageInputs(at);
    const msgFile = join(jobDir, "message.txt");
    writeFileSync(msgFile, "Write the scripts in the stack.\n");

    const cliArgs = [
      script,
      "--job", jobDir,
      "--records", recordsDir,
      "--work", workDir,
      "--message", msgFile,
      ...fileArgs.flatMap((f) => ["--file", f]),
    ];

    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];

    const r = spawnSync(process.execPath, cliArgs, { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const doc = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    assert.equal(doc.escalate, true);
    assert.equal(existsSync(join(jobDir, "pieces.json")), false);
  });
});

test("a message that asks for hand-off proceeds with exit 0 and files the build folder through the command", () => {
  folder((at) => {
    const jobDir = join(at, "job");
    const recordsDir = join(at, "records");
    const workDir = join(at, "work");
    mkdirSync(jobDir, { recursive: true });
    mkdirSync(recordsDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    const fileArgs = stageInputs(at);
    const msgFile = join(jobDir, "message.txt");
    writeFileSync(msgFile, "Hand off the code to the coding agent.\n");

    const cliArgs = [
      script,
      "--job", jobDir,
      "--records", recordsDir,
      "--work", workDir,
      "--message", msgFile,
      ...fileArgs.flatMap((f) => ["--file", f]),
    ];

    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];

    const r = spawnSync(process.execPath, cliArgs, { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const doc = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    assert.equal(doc.ok, true);
    assert.ok(existsSync(join(jobDir, "pieces.json")));
    assert.deepEqual(checkDelivered(jobDir), []);
  });
});
