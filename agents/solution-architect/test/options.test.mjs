// The record makes the split the design keeps: inputs are only the material
// the job is about, an option is a setting declared in full, and brand or
// palette material is a standing asset (the architecture standard, section 5;
// the audit checklist's options-are-settings and settings-declared-fully).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findingsOf } from "../scripts/standard.mjs";
import { renderRecord } from "../scripts/architecture-record.mjs";
import { INSTRUCTION } from "../scripts/name.mjs";
import { ROOT } from "./helpers.mjs";

const arch = (over = {}) => ({
  systems: [], kind: { kind: "plugin-on-harness", why: "default" },
  formats: [{ piece: "brief", direction: "in", kind: "text/markdown", convention: "a header `product`", given_by: "person", why: "the facts" }],
  settings: [], decisions: [{ decided: "x", why: "y" }], ...over,
});
const input = (piece, kind) => ({ piece, direction: "in", kind, given_by: "person", why: "w" });

test("a voice, a length or how it sounds taken as an input is a finding: it is a setting", () => {
  for (const [piece, kind] of [["voice", "identifier"], ["target length", "text"], ["how it sounds", "text"]]) {
    const f = findingsOf(arch({ formats: [input(piece, kind)] }));
    assert.ok(f.some((x) => x.startsWith(`${piece} only shapes how the job runs, so it is a setting`)), piece);
  }
});

test("a palette taken as an input is a finding: it is a standing asset", () => {
  const f = findingsOf(arch({ formats: [input("palette", "identifier")] }));
  assert.ok(f.some((x) => /palette is brand or library material, so it is a standing asset/.test(x)));
});

test("a setting that leaves its choices open is a finding; one declared in full is not", () => {
  const open = findingsOf(arch({ settings: [{ name: "tone", kind: "preference", default: "warm", job_may_set: true, why: "w" }] }));
  assert.ok(open.some((x) => /the setting tone does not declare label, about, allowed/.test(x)));
  const full = findingsOf(arch({ settings: [{ name: "tone", kind: "preference", label: "Tone", about: "How it sounds.", default: "warm",
    allowed: ["warm", "plain"], value_labels: { warm: "Warm", plain: "Plain" }, job_may_set: true, why: "w" }] }));
  assert.deepEqual(full.filter((x) => /setting tone/.test(x)), []);
});

test("the record writes a setting's label, choices and their labels, and a number's range", () => {
  const text = renderRecord({ title: "t", statement: "s", environments: [], systems: [], decisions: [], questions: [], kind: { kind: "k", why: "w" },
    settings: [
      { name: "tone", kind: "preference", label: "Tone", about: "How the announcement sounds.", default: "warm", allowed: ["warm", "plain"], value_labels: { warm: "Warm", plain: "Plain" }, job_may_set: true, why: "a person chooses" },
      { name: "most-points", kind: "preference", label: "Most points", about: "x", default: 7, min: 3, max: 12, step: 1, why: "a page" },
    ] });
  assert.match(text, /`tone` \("Tone"\), a preference with the default "warm", one of "warm" \(Warm\), "plain" \(Plain\), which a sender may set for one job: How the announcement sounds\. A person chooses\./);
  assert.match(text, /`most-points` \("Most points"\), a preference with the default 7, from 3 to 12 in steps of 1/);
});

test("the model is told the split and the setting's shape", () => {
  assert.match(INSTRUCTION, /Inputs are only the material the job is about/);
  assert.match(INSTRUCTION, /"value_labels"/);
});

test("this copy of options.mjs is the spec writer's, byte for byte", () => {
  let theirs = null;
  try { theirs = readFileSync(join(ROOT, "..", "spec-writer", "scripts", "options.mjs"), "utf8"); } catch { return; }
  assert.equal(readFileSync(join(ROOT, "scripts", "options.mjs"), "utf8"), theirs);
});
