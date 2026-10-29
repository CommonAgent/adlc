// Tracking what the job went without: records missing materials and defaults
// used instead, for the reply and standing records.
//
// What is worth pinning: went-without.json is written under the records
// directory; missing files read as empty lists; entries are appended and
// read back in order; sentences and paragraphs format missing items into plain
// words; and missing stack or defaults are noted.
//
// Nothing here touches a network or a model: all operations run on local
// temp directories cleaned after each test.
// Run: node --test test/went-without.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE, fileIn, note, paragraph, read, sentence } from "../scripts/went-without.mjs";

function withTempRecords(body) {
  const at = mkdtempSync(join(tmpdir(), "solution-architect-went-without-"));
  try {
    return body(at);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

test("file and filein point to went-without.json under the records folder", () => {
  assert.equal(FILE, "went-without.json");
  assert.equal(fileIn("/records/job-1"), "/records/job-1/went-without.json");
});

test("reading a missing went-without file yields an empty array", () => {
  withTempRecords((records) => {
    assert.deepEqual(read(records), []);
    assert.equal(existsSync(fileIn(records)), false);
  });
});

test("noting an omitted item records wanted, did, and why and returns the entry", () => {
  withTempRecords((records) => {
    const entry = {
      wanted: "the organization's stack",
      did: "every binding will be a default",
      why: "no stack was attached to the message",
    };
    const noted = note(records, entry);
    assert.deepEqual(noted, entry);
    assert.ok(existsSync(fileIn(records)));

    const entries = read(records);
    assert.deepEqual(entries, [entry]);
  });
});

test("multiple omitted items are appended in order", () => {
  withTempRecords((records) => {
    note(records, {
      wanted: "the organization's stack",
      did: "default bindings",
      why: "not given",
    });
    note(records, {
      wanted: "the platform's defaults",
      did: "used this package's copy",
      why: "none attached",
    });

    const entries = read(records);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].wanted, "the organization's stack");
    assert.equal(entries[1].wanted, "the platform's defaults");
  });
});

test("sentence formats entries into words and returns empty string for none", () => {
  assert.equal(sentence([]), "");

  const single = sentence([
    { wanted: "the organization's stack", did: "every binding will be a default", why: "not given" },
  ]);
  assert.match(single, /without the organization's stack/);

  const multiple = sentence([
    { wanted: "the organization's stack", did: "default bindings", why: "not given" },
    { wanted: "the platform's defaults", did: "used package copy", why: "none attached" },
  ]);
  assert.match(multiple, /without two of the things it takes/);
  assert.match(multiple, /the organization's stack/);
  assert.match(multiple, /the platform's defaults/);
});

test("paragraph reads from the records folder and formats the sentence", () => {
  withTempRecords((records) => {
    assert.equal(paragraph(records), "");

    note(records, {
      wanted: "the organization's stack",
      did: "every binding will be a default",
      why: "none attached",
    });

    const text = paragraph(records);
    assert.match(text, /the organization's stack/);
  });
});
