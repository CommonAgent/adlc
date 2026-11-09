// This agent reads the repository's standards/ at the version it pins: every
// standards file its package carries is pinned in standards-pins.json, and
// each pin is the digest of the file as it is now. A standard changed without
// re-pinning fails here, so a new version is adopted on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STANDARDS = join(ROOT, "..", "..", "standards");
const pins = JSON.parse(readFileSync(join(ROOT, "standards-pins.json"), "utf8"));
const digest = (p) => `sha256:${createHash("sha256").update(readFileSync(p)).digest("hex")}`;

test("each pinned standard is the version in standards/", () => {
  assert.equal(pins.standards_pins, "v1");
  assert.ok(Object.keys(pins.pins).length);
  for (const [name, pin] of Object.entries(pins.pins)) {
    assert.equal(digest(join(STANDARDS, name)), pin, `standards/${name} changed: re-pin it in standards-pins.json, run the tests, and release`);
  }
});

test("every standard the package carries is pinned, and read from standards/", () => {
  const plugin = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  const carried = new Set();
  for (const s of Object.values(skills)) {
    for (const r of s.references ?? []) {
      if (r.startsWith("../../standards/")) carried.add(basename(r));
      else assert.ok(!Object.hasOwn(pins.pins, basename(r)), `${r}: a pinned standard is read from ../../standards/, not a copy`);
    }
  }
  assert.deepEqual([...carried].sort(), Object.keys(pins.pins).sort());
});
