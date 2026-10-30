// What the job did not have, and what it did anyway.
//   node --test test/went-without.test.mjs
//
// What is pinned: went-without.json path calculation; noting an absence
// records wanted and did, requiring both; duplicate notes for the same
// wanted item are updated in place; reading an absent or malformed record
// returns an empty list without throwing; and sentence formats zero, one,
// or multiple absences truthfully for the reply.
// Nothing here touches a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE, fileIn, note, paragraph, read, sentence } from "../scripts/went-without.mjs";

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-without-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

test("FILE is went-without.json and fileIn resolves under records", () => {
  assert.equal(FILE, "went-without.json");
  assert.equal(fileIn("/rec/dir"), join("/rec/dir", "went-without.json"));
});

test("note records an absence and enforces required fields", () => {
  folder((at) => {
    assert.throws(() => note(at, {}), /needs `wanted`/);
    assert.throws(() => note(at, { wanted: "the prototype" }), /needs `did`/);

    const entries = note(at, { wanted: "the prototype", did: "wrote stubs for every script" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].wanted, "the prototype");
    assert.equal(entries[0].did, "wrote stubs for every script");

    const onDisk = JSON.parse(readFileSync(fileIn(at), "utf8"));
    assert.equal(onDisk.went_without, "v1");
    assert.equal(onDisk.entries.length, 1);

    // Updating existing wanted item updates rather than appends
    note(at, { wanted: "the prototype", did: "wrote stubs from suite imports", why: "none was given" });
    const updated = read(at);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].did, "wrote stubs from suite imports");
    assert.equal(updated[0].why, "none was given");
  });
});

test("read returns empty array when file is absent or malformed", () => {
  folder((at) => {
    assert.deepEqual(read(at), []);
    writeFileSync(fileIn(at), "not json");
    assert.deepEqual(read(at), []);
  });
});

test("sentence formats zero, one, or multiple absences into a reply paragraph", () => {
  assert.equal(sentence([]), "");

  const one = sentence([{ wanted: "the prototype", did: "it wrote stubs from the suite" }]);
  assert.equal(one, "This job went ahead without the prototype: it wrote stubs from the suite.");

  const oneWithWhy = sentence([{ wanted: "the prototype", did: "wrote stubs", why: "first draft" }]);
  assert.equal(oneWithWhy, "This job went ahead without the prototype (first draft): it wrote stubs.");

  const two = sentence([
    { wanted: "the prototype", did: "wrote stubs" },
    { wanted: "the builder", did: "skipped package build check" },
  ]);
  assert.match(two, /^This job went ahead without two of the things it takes: the prototype and the builder\./);
  assert.match(two, /Without the prototype, it wrote stubs\./);
  assert.match(two, /Without the builder, it skipped package build check\./);
});

test("paragraph reads the records folder and formats the sentence in one step", () => {
  folder((at) => {
    assert.equal(paragraph(at), "");
    note(at, { wanted: "a style guide", did: "used the standard house stack rules" });
    assert.match(paragraph(at), /without a style guide: it used the standard house stack rules/);
  });
});
