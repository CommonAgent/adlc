// The delivery check: verifying a write-the-scripts job from a build folder archive.
//
// What is pinned: when a write-the-scripts job's only input under in/ is
// build-folder.tar.gz (a gzip tar archive packed with archive.mjs holding
// build.lock.json, the agent's files and the suite under test/), verify(jobDir)
// reads the agent's files and the suite from inside that archive, accepts
// delivered scripts under out/scripts that pass the suite, and refuses delivered
// scripts that fail the suite; tested through verify() and through the CLI.
// Nothing here touches a network.
// Run: node --test test/verify-build-archive.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { bareName, looksLikeTest, verify, whatCameIn, whatWentOut } from "../scripts/verify.mjs";
import { entriesIn, isSafePath, pack, packBytes, unpack } from "../scripts/archive.mjs";
import { DESCRIPTOR_FILE, MANIFEST_FILE, RUNTIME_FILE, isAgentFolder, layOutAgentFiles, readAgentFolder, specOfFolder } from "../scripts/agent-folder.mjs";
import { LOCK_FILE, digestOf, listing, lockedDigests, lockProblems, scriptsOf, sortAttachments } from "../scripts/workspace.mjs";
import { blankRuns, runSuite, suitePaths } from "../scripts/check.mjs";
import { STEP_OF, aboutOf, fill, plan } from "../scripts/pieces.mjs";
import { FILE, fileIn, note, paragraph, read, sentence } from "../scripts/went-without.mjs";
import * as reportModule from "../scripts/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "verify.mjs");

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-verify-archive-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const AGENT_FILES = {
  [DESCRIPTOR_FILE]: JSON.stringify({
    format: "agent-descriptor-v1",
    agent_version: "0.1.0",
    name: "summer",
    offerings: [{ id: "sum", name: "Sum", steps: [] }],
  }),
  [RUNTIME_FILE]: JSON.stringify({
    format: "agent-runtime-requirements-v1",
    runtimes: [{ name: "node", version: ">=22" }],
  }),
  [MANIFEST_FILE]: JSON.stringify({
    name: "summer",
    version: "0.1.0",
    extensions: {
      "net.agentdoc.package": {
        build: { skills: { sum: { scripts: ["scripts/sum.mjs"] } } },
      },
    },
  }),
  "skills/sum/SKILL.md": "---\nname: sum\n---\n## When to use this\nWhen summing numbers.\n## What a good result looks like\nThe sum.\n## When it comes back empty\nEmpty.\n## How to do it\nRun node scripts/sum.mjs\n",
};

const SUITE_FILES = {
  "test/sum.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "../scripts/sum.mjs";\ntest("adds two numbers", () => { assert.equal(sum(2, 3), 5); });\n',
};

const PASSING_SCRIPT = "export function sum(a, b) { return a + b; }\n";
const FAILING_SCRIPT = "export function sum(a, b) { return a - b; }\n";

function buildArchive(dir, { agent = AGENT_FILES, suite = SUITE_FILES } = {}) {
  const src = join(dir, "archive-src");
  mkdirSync(src, { recursive: true });
  const allFiles = { ...agent, ...suite, "AGENTS.md": "# Rules\n", "CLAUDE.md": "Read AGENTS.md\n" };
  const digests = {};
  for (const [rel, content] of Object.entries(allFiles)) {
    const at = join(src, rel);
    mkdirSync(dirname(at), { recursive: true });
    const bytes = Buffer.from(content, "utf8");
    writeFileSync(at, bytes);
    digests[rel] = digestOf(bytes);
  }
  const lock = { build_lock: "v1", digests };
  writeFileSync(join(src, LOCK_FILE), JSON.stringify(lock, null, 2) + "\n");
  const archivePath = join(dir, "build-folder.tar.gz");
  pack(src, archivePath);
  return archivePath;
}

function makeJob(at, { archiveName = "build-folder.tar.gz", scriptContent = PASSING_SCRIPT } = {}) {
  const jobDir = join(at, "job");
  mkdirSync(join(jobDir, "in"), { recursive: true });
  mkdirSync(join(jobDir, "out", "scripts"), { recursive: true });

  const archive = buildArchive(at);
  const targetArchive = join(jobDir, "in", archiveName);
  writeFileSync(targetArchive, readFileSync(archive));

  writeFileSync(join(jobDir, "out", "scripts", "sum.mjs"), scriptContent);
  return jobDir;
}

test("a write-the-scripts delivery whose only input is a build folder archive is accepted when the scripts pass", () => {
  folder((at) => {
    const jobDir = makeJob(at, { scriptContent: PASSING_SCRIPT });
    const v = verify(jobDir);
    assert.equal(v.ok, true, v.said);
    assert.equal(v.pass, 1);
    assert.match(v.said, /passes against the delivered scripts, 1 of 1/);
  });
});

test("a delivery from a build folder archive with an inbound prefix on its name is accepted when the scripts pass", () => {
  folder((at) => {
    const jobDir = makeJob(at, {
      archiveName: "0-Ab3dEf9h-build-folder.tar.gz",
      scriptContent: PASSING_SCRIPT,
    });
    const v = verify(jobDir);
    assert.equal(v.ok, true, v.said);
    assert.equal(v.pass, 1);
  });
});

test("a write-the-scripts delivery from a build folder archive is refused when the scripts fail the suite", () => {
  folder((at) => {
    const jobDir = makeJob(at, { scriptContent: FAILING_SCRIPT });
    const v = verify(jobDir);
    assert.equal(v.ok, false);
    assert.match(v.said, /fails against the delivered scripts, 1 of 1: adds two numbers/);
  });
});

test("the host command accepts a valid build folder delivery with exit 0 and rejects a failing one with exit 1", () => {
  folder((at) => {
    const goodJob = makeJob(join(at, "good"), { scriptContent: PASSING_SCRIPT });
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
    delete env.JOB_DIR;

    const rGood = spawnSync(process.execPath, [script], {
      env: { ...env, JOB_DIR: goodJob },
      encoding: "utf8",
    });
    assert.equal(rGood.status, 0, rGood.stdout + rGood.stderr);
    const goodDoc = JSON.parse(rGood.stdout.trim().split(/\r?\n/).pop());
    assert.equal(goodDoc.ok, true);

    const badJob = makeJob(join(at, "bad"), { scriptContent: FAILING_SCRIPT });
    const rBad = spawnSync(process.execPath, [script], {
      env: { ...env, JOB_DIR: badJob },
      encoding: "utf8",
    });
    assert.equal(rBad.status, 1);
    const badDoc = JSON.parse(rBad.stdout.trim().split(/\r?\n/).pop());
    assert.equal(badDoc.ok, false);
    assert.match(badDoc.said, /fails against the delivered scripts/);
  });
});
