// The build folder in workspace and check: unpacking an archive, checking the
// lockfile, binary fixtures, package prototype files, and the updated fence.
//   node --test test/build-workspace.test.mjs
//
// What is pinned: when the input is a build folder archive, workspace.mjs
// unpacks it, verifies every pinned file against build.lock.json, and refuses
// a changed pinned file naming it; binary fixtures survive byte for byte
// (technical debt 552); package prototype sample/ and data files are laid out
// read-only and pinned; and the fence allows new test files under test/ while
// refusing any changed or removed pinned test or agent file, sending the work
// back to the spec and test steps.
// Nothing here touches a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { digestOf, layOut, sortAttachments } from "../scripts/workspace.mjs";
import { fenceOf, verdict } from "../scripts/check.mjs";
import { pack } from "../scripts/archive.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const wsScript = join(here, "..", "scripts", "workspace.mjs");
const checkScript = join(here, "..", "scripts", "check.mjs");

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-bws-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const writable = (p) => { try { chmodSync(p, 0o644); } catch {} };

test("technical debt 552: a binary fixture comes through the workspace with the same digest", () => {
  folder((at) => {
    const ws = join(at, "ws");
    const spec = { name: "binapp", version: "1.0.0", jobs: [{ slug: "work", scripts: ["scripts/run.mjs"] }] };
    const binaryBytes = Buffer.from([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xca, 0xfe]);

    const suite = [
      { path: "test/run.test.mjs", text: 'import { test } from "node:test";\nimport { run } from "../scripts/run.mjs";\ntest("a", () => {});\n' },
      { path: "test/fixtures/image.png", text: binaryBytes },
    ];

    const out = layOut({ workspace: ws, spec, suite });
    const laidBack = readFileSync(join(ws, "test", "fixtures", "image.png"));
    assert.deepEqual(laidBack, binaryBytes);
    assert.equal(out.digests["test/fixtures/image.png"], digestOf(binaryBytes));
  });
});

test("when the prototype is a package, its sample and data files are laid out at their own paths, read-only and pinned", () => {
  folder((at) => {
    const ws = join(at, "ws");
    const spec = { name: "pkgapp", version: "1.0.0", jobs: [{ slug: "work", scripts: ["scripts/work.mjs"] }] };
    const suite = [{ path: "test/work.test.mjs", text: 'import { test } from "node:test";\nimport { work } from "../scripts/work.mjs";\ntest("a", () => {});\n' }];
    const code = [
      { path: "scripts/work.mjs", bytes: Buffer.from("export function work() {}\n") },
      { path: "sample/request.json", bytes: Buffer.from('{"sample": true}\n') },
      { path: "data/lookup.csv", bytes: Buffer.from("id,name\n1,one\n") },
    ];

    const out = layOut({ workspace: ws, spec, suite, code });

    assert.equal(readFileSync(join(ws, "sample", "request.json"), "utf8"), '{"sample": true}\n');
    assert.equal(readFileSync(join(ws, "data", "lookup.csv"), "utf8"), "id,name\n1,one\n");

    assert.ok("sample/request.json" in out.digests, "sample file must be pinned in digests");
    assert.ok("data/lookup.csv" in out.digests, "data file must be pinned in digests");
  });
});

test("a build folder archive with a changed pinned file is refused by workspace.mjs, naming it", () => {
  folder((at) => {
    const buildDir = join(at, "build");
    mkdirSync(join(buildDir, "test"), { recursive: true });
    mkdirSync(join(buildDir, "scripts"), { recursive: true });

    writeFileSync(join(buildDir, "agent-descriptor.json"), JSON.stringify({ format: "agent-descriptor-v1" }));
    writeFileSync(join(buildDir, "test", "app.test.mjs"), '// test\nimport { test } from "node:test";\n');
    writeFileSync(join(buildDir, "scripts", "app.mjs"), "// stub\n");

    const lock = {
      digests: {
        "agent-descriptor.json": digestOf(Buffer.from(JSON.stringify({ format: "agent-descriptor-v1" }))),
        "test/app.test.mjs": digestOf(Buffer.from("tampered content")), // Wrong digest!
      },
    };
    writeFileSync(join(buildDir, "build.lock.json"), JSON.stringify(lock));

    const archivePath = join(at, "bundle.tar.gz");
    pack(buildDir, archivePath);

    const ws = join(at, "ws");
    const records = join(at, "records");
    mkdirSync(records, { recursive: true });

    const r = spawnSync("node", [wsScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        WORKSPACE: ws,
        RECORDS: records,
        FILES: `${archivePath}::application/gzip`,
      },
    });

    assert.equal(r.status, 3, "differing pinned file must exit 3");
    const out = JSON.parse(r.stdout || "{}");
    assert.match(out.reply, /test\/app\.test\.mjs/);
  });
});

test("the fence allows a new test file under test/ and runs it with the suite", () => {
  folder((at) => {
    const ws = join(at, "ws");
    const records = join(at, "records");
    mkdirSync(join(ws, "test"), { recursive: true });
    mkdirSync(join(ws, "scripts"), { recursive: true });
    mkdirSync(records, { recursive: true });

    writeFileSync(join(ws, "scripts", "add.mjs"), "export const add = (a, b) => a + b;\n");
    writeFileSync(join(ws, "test", "add.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("base", () => { assert.equal(add(1, 1), 2); });\n');

    const rec = {
      workspace: "v1",
      folder: ws,
      digests: { "test/add.test.mjs": digestOf(readFileSync(join(ws, "test", "add.test.mjs"))) },
      listing: { "scripts/add.mjs": digestOf(readFileSync(join(ws, "scripts", "add.mjs"))), "test/add.test.mjs": digestOf(readFileSync(join(ws, "test", "add.test.mjs"))) },
    };
    writeFileSync(join(records, "workspace.json"), JSON.stringify(rec));

    // Add a brand-new test file under test/
    writeFileSync(join(ws, "test", "extra.test.mjs"), 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("extra", () => { assert.equal(add(2, 2), 4); });\n');

    const f = fenceOf(rec, ws);
    assert.equal(f.ok, true, "a new test file under test/ must be allowed by the fence");

    const r = spawnSync("node", [checkScript], {
      encoding: "utf8",
      env: { ...process.env, WORKSPACE: ws, RECORDS: records },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /the suite passes, 2 of 2/);
  });
});

test("the fence: a changed or removed pinned test or agent file is refused and sends work back to spec and test steps", () => {
  folder((at) => {
    const ws = join(at, "ws");
    const records = join(at, "records");
    mkdirSync(join(ws, "test"), { recursive: true });
    mkdirSync(records, { recursive: true });

    writeFileSync(join(ws, "agent-descriptor.json"), '{"name": "test"}');
    writeFileSync(join(ws, "test", "base.test.mjs"), '// test\n');

    const rec = {
      workspace: "v1",
      folder: ws,
      digests: {
        "agent-descriptor.json": digestOf(Buffer.from('{"name": "test"}')),
        "test/base.test.mjs": digestOf(Buffer.from("// test\n")),
      },
      listing: {
        "agent-descriptor.json": digestOf(Buffer.from('{"name": "test"}')),
        "test/base.test.mjs": digestOf(Buffer.from("// test\n")),
      },
    };
    writeFileSync(join(records, "workspace.json"), JSON.stringify(rec));

    // Modify a pinned test file
    writable(join(ws, "test", "base.test.mjs"));
    writeFileSync(join(ws, "test", "base.test.mjs"), "// altered test\n");

    const f = fenceOf(rec, ws);
    assert.equal(f.ok, false);

    const said = verdict({ stop: "fence", fence: f });
    assert.match(said, /test\/base\.test\.mjs/);
    assert.match(said, /spec and test steps/i);

    const r = spawnSync("node", [checkScript], {
      encoding: "utf8",
      env: { ...process.env, WORKSPACE: ws, RECORDS: records },
    });
    assert.equal(r.status, 3);
    assert.match(r.stdout, /spec and test steps/i);
    assert.match(r.stdout, /test\/base\.test\.mjs/);
  });
});
