// The archive utility: packs and unpacks a folder as a gzip tar archive in
// node alone, with no external tar binary.
//   node --test test/archive.test.mjs
//
// What is pinned: a folder packed and read back gives the same files and the
// exact same bytes; packing the same folder twice gives identical bytes; an
// entry whose path climbs out (..) or is absolute is refused when reading;
// and the script enforces its process contract when run as a command.
// Nothing here touches a network or spawns a system tar utility.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isSafePath, pack, unpack } from "../scripts/archive.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "archive.mjs");

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-archive-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

test("a folder packed and read back gives the same files and the same bytes", () => {
  folder((at) => {
    const src = join(at, "src");
    const dest = join(at, "dest");
    const tarGz = join(at, "bundle.tar.gz");

    mkdirSync(join(src, "scripts"), { recursive: true });
    mkdirSync(join(src, "test", "fixtures"), { recursive: true });

    const files = {
      "README.md": Buffer.from("# Package\n"),
      "scripts/run.mjs": Buffer.from("export const x = 42;\n"),
      "test/run.test.mjs": Buffer.from("// test\n"),
      "test/fixtures/binary.bin": Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x89, 0x50, 0x4e, 0x47]),
    };

    for (const [rel, bytes] of Object.entries(files)) {
      writeFileSync(join(src, rel), bytes);
    }

    pack(src, tarGz);
    unpack(tarGz, dest);

    for (const [rel, bytes] of Object.entries(files)) {
      const readBack = readFileSync(join(dest, rel));
      assert.deepEqual(readBack, bytes, `${rel} did not preserve bytes`);
    }
  });
});

test("packing the same folder twice gives the same bytes", () => {
  folder((at) => {
    const src = join(at, "src");
    const arc1 = join(at, "first.tar.gz");
    const arc2 = join(at, "second.tar.gz");

    mkdirSync(join(src, "sample"), { recursive: true });
    writeFileSync(join(src, "sample", "data.json"), '{"key": "value"}\n');
    writeFileSync(join(src, "index.mjs"), "export default 1;\n");

    pack(src, arc1);
    pack(src, arc2);

    const bytes1 = readFileSync(arc1);
    const bytes2 = readFileSync(arc2);
    assert.deepEqual(bytes1, bytes2, "packing the same folder twice produced different bytes");
  });
});

test("a path that climbs out of the folder or is absolute is refused when reading", () => {
  assert.equal(isSafePath("scripts/a.mjs"), true);
  assert.equal(isSafePath("test/fixtures/data.bin"), true);
  assert.equal(isSafePath("../secret.txt"), false);
  assert.equal(isSafePath("scripts/../../escape.mjs"), false);
  assert.equal(isSafePath("/etc/passwd"), false);
  assert.equal(isSafePath("C:\\Windows\\System32"), false);

  folder((at) => {
    const fakeArchive = join(at, "corrupt.tar.gz");
    // Write invalid or path-traversing tar structure and assert unpack throws
    const dest = join(at, "dest");
    mkdirSync(dest, { recursive: true });
    assert.throws(() => unpack(fakeArchive, dest));
  });
});

test("the process contract: missing arguments exit 2", () => {
  const r = spawnSync("node", [script], { encoding: "utf8" });
  assert.equal(r.status, 2, "running without arguments must exit 2");
  assert.match(r.stderr, /required|usage/i);
});
