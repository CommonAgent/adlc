// The coverage check for a process's test cases (scripts/check-cases.mjs):
// Agent Processes 0.9.0 §21 test cases read against the document they test.
//
// What is worth pinning: the test writer's rule for a suite of test cases,
// that every phase a person signs (automation: never or supervised) has each
// of its answers, approve, changes and reject, exercised at least once across
// the suite, and every deviation (way back) is taken at least once. A suite
// that misses one is refused, naming what it missed. A test case is also
// refused when it was written for another document or another digest (a
// runtime refuses it, §21.1), names a phase or an item the document does not
// have, leaves out an item the trigger requires, or sends work back without
// saying which way back when the phase has more than one.
//
// Nothing here touches a network or a model.
//   node --test test/check-cases.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseCase, checkCases, needsOf } from "../scripts/check-cases.mjs";
import { parseDocument } from "../scripts/process-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "..", "scripts", "check-cases.mjs");
const FIX = join(HERE, "fixtures", "cases");
const DOC = readFileSync(join(FIX, "explore.process.txt"), "utf8");
const SUITE_DIR = join(FIX, "suite");
const suite = () => readdirSync(SUITE_DIR).filter((f) => f.endsWith(".test.txt")).sort().map((f) => ({ file: f, text: readFileSync(join(SUITE_DIR, f), "utf8") }));
const without = (name) => suite().filter((c) => !c.file.startsWith(name));
const edit = (name, from, to) => suite().map((c) => (c.file.startsWith(name) ? { ...c, text: c.text.replace(from, to) } : c));

test("a test case is read line by line: its name, the document and digest, carried, answer, stand-in and expect", () => {
  const c = parseCase(readFileSync(join(SUITE_DIR, "wrong-angles.test.txt"), "utf8"));
  assert.deepEqual(c.problems, []);
  assert.equal(c.name, "wrong-angles");
  assert.equal(c.for, "research/explore-a-topic");
  assert.match(c.digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(c.carried, [{ item: "topic", value: "heat pumps" }]);
  assert.deepEqual(c.answers.map((a) => [a.phase, a.answer]), [["plan-the-angles", "approve"], ["approve-the-cards", "changes"], ["plan-the-angles", "approve"], ["approve-the-cards", "approve"]]);
  assert.equal(c.answers[1].deviation, "wrong-angles");
  assert.equal(c.answers[1].words, "the angles miss installation costs");
  assert.deepEqual(c.standIns.map((s) => s.phase), ["publish-the-cards"]);
  assert.equal(c.expect.goal, true);
  assert.deepEqual(c.expect.ran.slice(0, 4), ["plan-the-angles", "write-the-cards", "approve-the-cards", "plan-the-angles"]);
});

test("what a suite must cover is read from the document: the phases a person signs, and every way back", () => {
  const n = needsOf(parseDocument(DOC));
  assert.deepEqual(n.signed.map((s) => s.phase), ["plan-the-angles", "approve-the-cards"]);
  assert.deepEqual(n.deviations.map((d) => d.key), ["changes", "wrong-angles", "no-sources"]);
  assert.deepEqual(n.required, ["topic"]);
});

test("the suite that covers every answer at every signed phase and takes every way back passes", () => {
  const r = checkCases(DOC, suite());
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.missing, []);
  assert.equal(r.ok, true);
  assert.equal(r.cases, 6);
  assert.deepEqual(r.covered.signed["approve-the-cards"].sort(), ["approve", "changes", "reject"]);
  assert.deepEqual(r.covered.deviations.sort(), ["changes", "no-sources", "wrong-angles"]);
});

test("a signed phase whose answer no case gives is refused, by phase and answer", () => {
  const r = checkCases(DOC, without("cards-rejected"));
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /approve-the-cards/.test(m) && /reject/.test(m)), JSON.stringify(r.missing));
  const s = checkCases(DOC, without("angles-rejected"));
  assert.ok(s.missing.some((m) => /plan-the-angles/.test(m) && /reject/.test(m)), JSON.stringify(s.missing));
});

test("a way back no case takes is refused, by its key", () => {
  const r = checkCases(DOC, without("no-sources"));
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => /no-sources/.test(m)), JSON.stringify(r.missing));
  // changes: without a key takes the way back keyed changes from that phase.
  const t = checkCases(DOC, without("revise-the-cards"));
  assert.ok(t.missing.some((m) => /\[changes\]/.test(m)), JSON.stringify(t.missing));
});

test("a case written for another digest, or another document, is refused", () => {
  const r = checkCases(DOC, edit("approve-first-time", /sha256:[0-9a-f]{64}/, `sha256:${"0".repeat(64)}`));
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /approve-first-time/.test(p) && /digest/.test(p)), JSON.stringify(r.problems));
  const s = checkCases(DOC, edit("approve-first-time", "for: research/explore-a-topic", "for: research/another"));
  assert.ok(s.problems.some((p) => /research\/another/.test(p)));
});

test("a phase, an item or a way back the document does not have is refused", () => {
  assert.ok(checkCases(DOC, edit("approve-first-time", "answer: approve-the-cards = approve", "answer: approve-the-card = approve")).problems.some((p) => /approve-the-card\b/.test(p)));
  assert.ok(checkCases(DOC, edit("approve-first-time", "stand-in: publish-the-cards", "stand-in: publish-cards")).problems.some((p) => /publish-cards/.test(p)));
  assert.ok(checkCases(DOC, edit("approve-first-time", "carried: topic =", "carried: subject =")).problems.some((p) => /subject/.test(p)));
  assert.ok(checkCases(DOC, edit("wrong-angles", "[wrong-angles]", "[wrong-way]")).problems.some((p) => /wrong-way/.test(p)));
  assert.ok(checkCases(DOC, edit("approve-first-time", "expect: ran plan-the-angles", "expect: ran plan-the-angle")).problems.some((p) => /plan-the-angle\b/.test(p)));
});

test("a case that leaves out an item the trigger requires is refused", () => {
  const r = checkCases(DOC, edit("angles-rejected", "carried: topic = everything\n", ""));
  assert.ok(r.problems.some((p) => /angles-rejected/.test(p) && /topic/.test(p) && /required/.test(p)), JSON.stringify(r.problems));
});

test("sending work back without saying which way, at a phase with more than one, is refused", () => {
  // write-the-cards has one way back (no-sources), so a bare changes: there is that one.
  const ok = checkCases(DOC, edit("no-sources", "changes: [no-sources] the fifth", "changes: the fifth"));
  assert.deepEqual(ok.problems, []);
  // approve-the-cards has three; a bare changes: is the one keyed changes, and a key that leaves another phase is wrong.
  const bad = checkCases(DOC, edit("wrong-angles", "[wrong-angles]", "[no-sources]"));
  assert.ok(bad.problems.some((p) => /no-sources/.test(p) && /approve-the-cards/.test(p)), JSON.stringify(bad.problems));
});

test("an answer at a phase nobody signs and no way back leaves is refused", () => {
  const r = checkCases(DOC, edit("approve-first-time", "answer: plan-the-angles = approve", "answer: plan-the-angles = approve\nanswer: publish-the-cards = approve"));
  assert.ok(r.problems.some((p) => /publish-the-cards/.test(p)), JSON.stringify(r.problems));
});

test("an answer is approve, changes: with words, or reject: with a reason", () => {
  assert.ok(parseCase("TEST: x   for: a/b\n  digest: sha256:00\nanswer: p = maybe\nexpect: goal reached\n").problems.some((p) => /maybe/.test(p)));
  assert.ok(parseCase("TEST: x   for: a/b\n  digest: sha256:00\nanswer: p = changes:\nexpect: goal reached\n").problems.some((p) => /words/.test(p)));
  assert.ok(parseCase("TEST: x   for: a/b\n  digest: sha256:00\nanswer: p = approve\n").problems.some((p) => /expect/.test(p)));
  assert.ok(parseCase("not a test case").problems.some((p) => /TEST:/.test(p)));
});

test("two cases with one name are refused", () => {
  const twice = suite().concat([{ file: "copy.test.txt", text: suite()[0].text }]);
  assert.ok(checkCases(DOC, twice).problems.some((p) => /twice|two/.test(p)));
});

test("the command line: exit 0 for a covering suite, 1 with what is missing, 3 with no cases, 2 without the document", () => {
  const ok = spawnSync(process.execPath, [CHECK, "--process", join(FIX, "explore.process.txt"), SUITE_DIR], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout.trim().split("\n").pop()).ok, true);
  const dir = mkdtempSync(join(tmpdir(), "check-cases-"));
  for (const c of without("no-sources")) writeFileSync(join(dir, c.file), c.text);
  const bad = spawnSync(process.execPath, [CHECK, "--process", join(FIX, "explore.process.txt"), dir], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(JSON.parse(bad.stdout.trim().split("\n").pop()).reply, /no-sources/);
  const empty = mkdtempSync(join(tmpdir(), "check-cases-empty-"));
  assert.equal(spawnSync(process.execPath, [CHECK, "--process", join(FIX, "explore.process.txt"), empty], { encoding: "utf8" }).status, 3);
  assert.equal(spawnSync(process.execPath, [CHECK, SUITE_DIR], { encoding: "utf8" }).status, 2);
  // With RECORDS, the reading is kept.
  const rec = mkdtempSync(join(tmpdir(), "check-cases-rec-"));
  spawnSync(process.execPath, [CHECK, "--process", join(FIX, "explore.process.txt"), SUITE_DIR], { encoding: "utf8", env: { ...process.env, RECORDS: rec } });
  assert.equal(JSON.parse(readFileSync(join(rec, "cases-checked.json"), "utf8")).ok, true);
  mkdirSync(join(rec, "x"), { recursive: true });
});
