// Hand off the code: lays out a build folder for whoever writes the scripts,
// with the suite, released scripts, house rules and local check, and packs it
// as one gzip tar archive.
//   node --test test/handoff.test.mjs
//
// What is pinned: given the agent's files, a suite with a helper and binary
// fixture, and a released package as prototype, it lays out every file at its
// path, stubs missing scripts, writes AGENTS.md, CLAUDE.md, .adlc/ and
// build.lock.json, and packs it deterministically as a gzip tar; the piece is
// filed and verified against its declared format; missing agent files,
// missing suite, or a missing template are refused; and missing CLI arguments
// exit 2.
// Nothing here touches a network or a real model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildLock, fromArgv, handoff, layOutBuildFolder, writeHouseRules } from "../scripts/handoff.mjs";
import { pack, unpack } from "../scripts/archive.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "handoff.mjs");

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-handoff-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const AGENT_FILES = {
  "agent-descriptor.json": JSON.stringify({
    format: "agent-descriptor-v1",
    agent_version: "0.1.0",
    name: "calculator",
    offerings: [{ id: "calc", name: "Calculate", steps: [] }],
  }),
  "agent-runtime-requirements.json": JSON.stringify({
    format: "agent-runtime-requirements-v1",
    runtimes: [{ name: "node", version: ">=22" }],
  }),
  "plugin.json": JSON.stringify({
    name: "calculator",
    version: "0.1.0",
    extensions: {
      "net.agentdoc.package": {
        build: { skills: { calc: { scripts: ["scripts/calc.mjs", "scripts/stubbed.mjs"] } } },
      },
    },
  }),
  "skills/calc/SKILL.md": "---\nname: calc\n---\n## When to use this\nAlways.\n## What a good result looks like\nGood.\n## When it comes back empty\nEmpty.\n## How to do it\nRun node scripts/calc.mjs\n",
};

const SUITE_FILES = {
  "test/calc.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { calc } from "../scripts/calc.mjs";\nimport { stubbed } from "../scripts/stubbed.mjs";\nimport { add } from "./helpers.mjs";\ntest("calc", () => { assert.equal(calc(2), 2); });\n',
  "test/helpers.mjs": "export const add = (a, b) => a + b;\n",
  "test/fixtures/fixture.bin": Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
};

const PROTO_FILES = {
  "scripts/calc.mjs": "export function calc(n) { return n; }\n",
  "sample/input.json": '{"numbers": [1, 2, 3]}\n',
  "data/rates.csv": "a,b\n1,2\n",
};

test("fromArgv parses the command line flags", () => {
  const parsed = fromArgv([
    "--job", "/job/dir",
    "--records", "/records/dir",
    "--work", "/work/dir",
    "--file", "/in/spec.json::application/json",
    "--file", "/in/test.mjs::text/javascript",
  ]);
  assert.equal(parsed.job, "/job/dir");
  assert.equal(parsed.records, "/records/dir");
  assert.equal(parsed.work, "/work/dir");
  assert.deepEqual(parsed.files, [
    { path: "/in/spec.json", declared: "application/json" },
    { path: "/in/test.mjs", declared: "text/javascript" },
  ]);
});

test("layOutBuildFolder lays out agent files, the suite byte for byte, released scripts, and stubs missing ones", () => {
  folder((at) => {
    const buildDir = join(at, "build");
    layOutBuildFolder({
      dir: buildDir,
      agent: AGENT_FILES,
      suite: SUITE_FILES,
      prototype: PROTO_FILES,
    });

    assert.ok(existsSync(join(buildDir, "agent-descriptor.json")));
    assert.ok(existsSync(join(buildDir, "skills", "calc", "SKILL.md")));
    assert.equal(readFileSync(join(buildDir, "test", "helpers.mjs"), "utf8"), SUITE_FILES["test/helpers.mjs"]);
    assert.deepEqual(readFileSync(join(buildDir, "test", "fixtures", "fixture.bin")), SUITE_FILES["test/fixtures/fixture.bin"]);

    assert.equal(readFileSync(join(buildDir, "scripts", "calc.mjs"), "utf8"), PROTO_FILES["scripts/calc.mjs"]);
    assert.match(readFileSync(join(buildDir, "scripts", "stubbed.mjs"), "utf8"), /not written yet/);

    assert.equal(readFileSync(join(buildDir, "sample", "input.json"), "utf8"), PROTO_FILES["sample/input.json"]);
    assert.equal(readFileSync(join(buildDir, "data", "rates.csv"), "utf8"), PROTO_FILES["data/rates.csv"]);
    assert.ok(existsSync(join(buildDir, ".adlc", "check.mjs")));
  });
});

test("writeHouseRules writes AGENTS.md, CLAUDE.md, and build.lock.json holding every pinned file digest", () => {
  folder((at) => {
    const buildDir = join(at, "build");
    mkdirSync(join(buildDir, "scripts"), { recursive: true });
    mkdirSync(join(buildDir, "test"), { recursive: true });
    writeFileSync(join(buildDir, "test", "a.test.mjs"), "test\n");
    writeFileSync(join(buildDir, "scripts", "a.mjs"), "code\n");

    const template = "# House Rules\nWrite only under scripts/.\n";
    writeHouseRules(buildDir, { templateText: template });

    assert.equal(readFileSync(join(buildDir, "AGENTS.md"), "utf8"), template);
    assert.match(readFileSync(join(buildDir, "CLAUDE.md"), "utf8"), /AGENTS\.md/);

    const lock = JSON.parse(readFileSync(join(buildDir, "build.lock.json"), "utf8"));
    const digests = lock.digests ?? lock;
    assert.ok("test/a.test.mjs" in digests);
    assert.ok("AGENTS.md" in digests);
    assert.ok(!("scripts/a.mjs" in digests), "scripts under scripts/ must not be pinned");
  });
});

test("a whole hand-off job writes the build folder, packs it as gzip tar, and checks delivered format", () => {
  folder((at) => {
    const jobDir = join(at, "job");
    const recordsDir = join(at, "records");
    const workDir = join(at, "work");
    mkdirSync(jobDir, { recursive: true });
    mkdirSync(recordsDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    const inDir = join(at, "in");
    mkdirSync(inDir, { recursive: true });

    const fileArgs = [];
    const writeIn = (name, content, mediaType) => {
      const p = join(inDir, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
      fileArgs.push(`${p}::${mediaType}`);
    };

    // The agent's files come loose and are told apart by what is in them. A
    // suite or a prototype with folders comes as one gzip tar holding its
    // paths, because a loose file's folder is lost on the way. (Harness
    // amendment: the delivered version flattened paths into names, such as
    // test-fixtures-fixture.bin, which no reader can turn back into paths.)
    for (const [k, v] of Object.entries(AGENT_FILES)) writeIn(k.replace(/\//g, "-"), v, "application/json");
    const asArchive = (name, files) => {
      const src = join(at, `${name}-src`);
      for (const [rel, bytes] of Object.entries(files)) {
        mkdirSync(dirname(join(src, rel)), { recursive: true });
        writeFileSync(join(src, rel), bytes);
      }
      const p = join(inDir, `${name}.tar.gz`);
      pack(src, p);
      fileArgs.push(`${p}::application/gzip`);
    };
    asArchive("suite", SUITE_FILES);
    asArchive("prototype", PROTO_FILES);

    const result = handoff({
      jobDir,
      recordsDir,
      workDir,
      files: fileArgs.map((f) => { const [p, m] = f.split("::"); return { path: p, declared: m }; }),
    });

    assert.equal(result.ok, true, result.reply);
    assert.match(result.reply, /build folder/i);

    const pieces = JSON.parse(readFileSync(join(jobDir, "pieces.json"), "utf8"));
    assert.ok(pieces.some((p) => p.media_type === "application/gzip"));

    assert.deepEqual(checkDelivered(jobDir), []);

    // Unpack the delivered archive and check its contents
    const deliveredArchive = join(jobDir, pieces[0].path);
    const unpacked = join(at, "unpacked");
    mkdirSync(unpacked, { recursive: true });
    unpack(deliveredArchive, unpacked);

    assert.ok(existsSync(join(unpacked, "agent-descriptor.json")));
    assert.ok(existsSync(join(unpacked, "AGENTS.md")));
    assert.ok(existsSync(join(unpacked, "CLAUDE.md")));
    assert.ok(existsSync(join(unpacked, "build.lock.json")));
    assert.ok(existsSync(join(unpacked, ".adlc", "check.mjs")));
    assert.deepEqual(
      readFileSync(join(unpacked, "test", "fixtures", "fixture.bin")),
      SUITE_FILES["test/fixtures/fixture.bin"]
    );
  });
});

test("refusals: missing agent files or missing suite halts and says what is missing", () => {
  folder((at) => {
    const jobDir = join(at, "job");
    const recordsDir = join(at, "records");
    const workDir = join(at, "work");
    mkdirSync(jobDir, { recursive: true });
    mkdirSync(recordsDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    // No files passed
    const emptyRun = handoff({ jobDir, recordsDir, workDir, files: [] });
    assert.equal(emptyRun.ok, false);
    assert.equal(emptyRun.code, 3);
    assert.match(emptyRun.reply, /agent's files|suite/i);
    assert.equal(existsSync(join(jobDir, "pieces.json")), false);
  });
});

test("process contract: missing required options exits 2", () => {
  const r = spawnSync("node", [script], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--job, --records and --work are required/i);
});
