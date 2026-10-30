// The delivery check: verifying a build folder delivery from hand-off-the-code.
//   node --test test/verify-build-folder.test.mjs
//
// What is pinned: a job folder whose delivery is a build folder
// (out/build-folder.tar.gz filed in pieces.json as "the build folder",
// application/gzip, and no out/scripts) is accepted when the archive reads,
// holds the agent's files and at least one test/<name>.test.mjs, and every
// file build.lock.json pins is in the archive with that digest; such a
// delivery is refused, naming the file, when a pinned file's digest differs
// from build.lock.json or a pinned file is missing, and refused when the
// archive cannot be read. The process contract is verified via JOB_DIR.
// Nothing here touches a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verify } from "../scripts/verify.mjs";
import { pack } from "../scripts/archive.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "verify.mjs");

const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-verify-build-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const AGENT_FILES = {
  "agent-descriptor.json": JSON.stringify({
    format: "agent-descriptor-v1",
    agent_version: "0.1.0",
    name: "counter",
    offerings: [{ id: "count", name: "Count", steps: [] }],
  }),
  "agent-runtime-requirements.json": JSON.stringify({
    format: "agent-runtime-requirements-v1",
    runtimes: [{ name: "node", version: ">=22" }],
  }),
  "plugin.json": JSON.stringify({
    name: "counter",
    version: "0.1.0",
    extensions: {
      "net.agentdoc.package": {
        build: { skills: { count: { scripts: ["scripts/count.mjs"] } } },
      },
    },
  }),
  "skills/count/SKILL.md": "---\nname: count\n---\n## When to use this\nAlways.\n## What a good result looks like\nGood.\n## When it comes back empty\nEmpty.\n## How to do it\nRun node scripts/count.mjs\n",
};

const SUITE_FILES = {
  "test/count.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { count } from "../scripts/count.mjs";\ntest("count", () => { assert.equal(count([1, 2]), 2); });\n',
};

const OTHER_FILES = {
  "AGENTS.md": "# House Rules\nWrite only under scripts/.\n",
  "CLAUDE.md": "Read AGENTS.md first.\n",
  ".adlc/check.mjs": "export function check() {}\n",
  "scripts/count.mjs": "export function count(xs) { return xs.length; }\n",
};

function makeBuildFolder(dir, { alter = {} } = {}) {
  const files = { ...AGENT_FILES, ...SUITE_FILES, ...OTHER_FILES, ...alter };
  const digests = {};
  for (const [rel, content] of Object.entries(files)) {
    const at = join(dir, rel);
    mkdirSync(dirname(at), { recursive: true });
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    writeFileSync(at, bytes);
    if (!rel.startsWith("scripts/") && rel !== "build.lock.json") {
      digests[rel] = sha(bytes);
    }
  }
  return digests;
}

function makeDeliveryJob(at, { buildAlter = {}, lockAlter = null, corrupt = false } = {}) {
  const jobDir = join(at, "job");
  const buildSrc = join(at, "build-src");
  mkdirSync(join(jobDir, "out"), { recursive: true });

  const calculatedDigests = makeBuildFolder(buildSrc, { alter: buildAlter });
  const lock = {
    build_lock: "v1",
    digests: lockAlter ? lockAlter(calculatedDigests) : calculatedDigests,
  };
  writeFileSync(join(buildSrc, "build.lock.json"), JSON.stringify(lock, null, 2) + "\n");

  const archivePath = join(jobDir, "out", "build-folder.tar.gz");
  if (corrupt) {
    writeFileSync(archivePath, Buffer.from("not-a-valid-gzip-tar-archive\n"));
  } else {
    pack(buildSrc, archivePath);
  }

  const pieces = [
    {
      name: "the build folder",
      step: "pack-the-build-folder",
      path: "out/build-folder.tar.gz",
      media_type: "application/gzip",
      about: "One gzip tar archive holding the build folder: the agent's files, `test/`, `scripts/`, the released package files, `AGENTS.md`, `CLAUDE.md`, `.adlc/` and `build.lock.json`.",
    },
  ];
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify(pieces, null, 2) + "\n");
  return jobDir;
}

test("a delivery of a valid build folder archive is accepted when it holds agent files, tests and matching digests", () => {
  folder((at) => {
    const jobDir = makeDeliveryJob(at);
    const v = verify(jobDir);
    assert.equal(v.ok, true, v.said);
    assert.deepEqual(checkDelivered(jobDir), []);
  });
});

test("a build folder delivery with a pinned file whose digest differs is refused, naming the file", () => {
  folder((at) => {
    const jobDir = makeDeliveryJob(at, {
      lockAlter: (digests) => ({
        ...digests,
        "test/count.test.mjs": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
    });
    const v = verify(jobDir);
    assert.equal(v.ok, false);
    assert.match(v.said, /test\/count\.test\.mjs/);
  });
});

test("a build folder delivery missing a pinned file is refused, naming the file", () => {
  folder((at) => {
    const jobDir = makeDeliveryJob(at, {
      lockAlter: (digests) => ({
        ...digests,
        "sample/data.json": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      }),
    });
    const v = verify(jobDir);
    assert.equal(v.ok, false);
    assert.match(v.said, /sample\/data\.json/);
  });
});

test("a build folder delivery whose archive cannot be read is refused", () => {
  folder((at) => {
    const jobDir = makeDeliveryJob(at, { corrupt: true });
    const v = verify(jobDir);
    assert.equal(v.ok, false);
    assert.match(v.said, /archive|gzip|tar/i);
  });
});

test("the host command accepts a valid build folder delivery with exit 0 and rejects a broken one with exit 1", () => {
  folder((at) => {
    const goodJob = makeDeliveryJob(join(at, "good"));
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

    const badJob = makeDeliveryJob(join(at, "bad"), { corrupt: true });
    const rBad = spawnSync(process.execPath, [script], {
      env: { ...env, JOB_DIR: badJob },
      encoding: "utf8",
    });
    assert.equal(rBad.status, 1);
    const badDoc = JSON.parse(rBad.stdout.trim().split(/\r?\n/).pop());
    assert.equal(badDoc.ok, false);
  });
});
