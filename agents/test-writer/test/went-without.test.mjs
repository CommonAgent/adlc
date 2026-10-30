// What the job went without: records what was missing and what was done anyway.
//   node --test test/went-without.test.mjs
//
// What is pinned: went-without.json is placed in the records folder; reading
// an absent file returns an empty list without error; note appends an entry
// with wanted, did, and why and returns the list as kept; multiple notes
// accumulate in order; sentence and paragraph format the entries into words
// for the reply; and the file, the same in every package, has no main: run on
// its own it stops nothing and writes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  FILE, fileIn, note, paragraph, read, sentence,
} from "../scripts/went-without.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("filein points to went-without.json under the job records folder", () => {
  assert.equal(FILE, "went-without.json");
  assert.equal(fileIn("/var/records/job-1"), join("/var/records/job-1", "went-without.json"));
});

test("reading an absent records folder returns an empty list", () => {
  const at = mkdtempSync(join(tmpdir(), "ww-"));
  try {
    assert.deepEqual(read(join(at, "missing")), []);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

test("note appends an entry recording what was missing, what was done, and why", () => {
  const at = mkdtempSync(join(tmpdir(), "ww-"));
  try {
    const kept = note(at, { wanted: "reference", did: "proceeded without reference", why: "not attached" });
    assert.deepEqual(kept, [{ wanted: "reference", did: "proceeded without reference", why: "not attached" }], "note returns the list as kept");
    const entries = read(at);
    assert.deepEqual(entries, kept);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

test("multiple notes accumulate in order in the record file", () => {
  const at = mkdtempSync(join(tmpdir(), "ww-"));
  try {
    note(at, { wanted: "a", did: "did-a", why: "why-a" });
    note(at, { wanted: "b", did: "did-b", why: "why-b" });
    const entries = read(at);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].wanted, "a");
    assert.equal(entries[1].wanted, "b");
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

test("sentence formats entries into a human-readable line, or empty string when none", () => {
  assert.equal(sentence([]), "");
  const formatted = sentence([{ wanted: "the reference", did: "used defaults", why: "file missing" }]);
  assert.match(formatted, /the reference/);
});

test("paragraph reads from the records folder and formats the sentence", () => {
  const at = mkdtempSync(join(tmpdir(), "ww-"));
  try {
    assert.equal(paragraph(at), "");
    note(at, { wanted: "the reference", did: "used defaults", why: "file missing" });
    const p = paragraph(at);
    assert.match(p, /the reference/);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});

test("run on its own without records the shared file stops nothing and writes nothing, because it has no main", () => {
  const scriptPath = join(here, "..", "scripts", "went-without.mjs");
  const at = mkdtempSync(join(tmpdir(), "ww-"));
  try {
    const r = spawnSync(process.execPath, [scriptPath], {
      cwd: at,
      env: { ...process.env, RECORDS: "" },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, "nothing in this file refuses or stops anything");
    assert.equal(r.stdout, "");
    assert.deepEqual(readdirSync(at), [], "no record is written by running the file");
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
});
