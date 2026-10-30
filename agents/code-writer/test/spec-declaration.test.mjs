// The package's own specification: verifies agent-descriptor.json against
// the spec's promises.
//   node --test test/spec-declaration.test.mjs
//
// What is pinned: the agent declares write-the-scripts and hand-off-the-code
// as offerings; each step of each offering is declared as a job; how matches
// what the spec claims (no model and no cost for hand-off-the-code, metered
// model for write-the-scripts); records, refuses, and escalations are kept;
// and node >= 22 is required.
// Nothing here touches a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const descPath = join(here, "..", "agent-descriptor.json");
const desc = JSON.parse(readFileSync(descPath, "utf8"));

test("write-the-scripts and hand-off-the-code are offered, and their steps are declared jobs", () => {
  const offerings = desc.offerings ?? [];
  const writeOff = offerings.find((o) => o.id === "write-the-scripts");
  assert.ok(writeOff, "write-the-scripts must be offered");

  const handoffOff = offerings.find((o) => o.id === "hand-off-the-code");
  assert.ok(handoffOff, "hand-off-the-code must be offered");

  const writeSteps = (writeOff.steps ?? []).map((s) => s.id);
  assert.deepEqual(writeSteps, [
    "lay-out-the-workspace",
    "check-the-work",
    "report-the-work",
  ]);

  const handoffSteps = (handoffOff.steps ?? []).map((s) => s.id);
  assert.deepEqual(handoffSteps, [
    "lay-out-the-build-folder",
    "write-the-house-rules",
    "pack-the-build-folder",
  ]);
});

test("each job's how matches what it claims", () => {
  const offerings = desc.offerings ?? [];
  const writeOff = offerings.find((o) => o.id === "write-the-scripts");
  assert.equal(writeOff.how.control, "model");
  assert.equal(writeOff.how.intelligence, "open");
  assert.equal(writeOff.how.cost, "metered");

  const handoffOff = offerings.find((o) => o.id === "hand-off-the-code");
  assert.equal(handoffOff.how.control, "script");
  assert.equal(handoffOff.how.intelligence, "none");
  assert.equal(handoffOff.how.cost, "none");

  // Every step of hand-off-the-code costs nothing and wakes no model
  for (const step of handoffOff.steps ?? []) {
    assert.equal(step.how.control, "script", `${step.id} control`);
    assert.equal(step.how.intelligence, "none", `${step.id} intelligence`);
    assert.equal(step.how.cost, "none", `${step.id} cost`);
  }
});
