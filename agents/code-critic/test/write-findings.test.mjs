// The findings document, the answers, and the reply.
//   node --test test/write-findings.test.mjs
//
// What is worth pinning: the document carries the header fields and the
// headings its declared convention names, one section per finding with a
// place, a claim, a consequence and an Answer that starts as open; it parses
// as Markdown and never as JSON; an earlier review comes back and each of its
// findings is said to be answered by a reason (and the reason carried), by a
// change (no longer found), or still open; open is 0 only when every finding
// is answered; and the reply leads with the count, names places, and says
// plainly that this role does not make the change it was asked to make.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerAgainst, earlierFindings, findingsDocument, replyText } from "../scripts/write-findings.mjs";
import { entryFor, PIECE } from "../scripts/pieces.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const descriptor = JSON.parse(readFileSync(join(HERE, "..", "agent-descriptor.json"), "utf8"));
const output = descriptor.offerings[0].outputs.find((o) => o.name === "the findings");
const read = { package: { name: "bad", version: "0.1.0" }, change: { scope: "package", files: [] }, files: [{ path: "scripts/make.mjs", role: "script" }], notes: [] };
const f = (file, line, rule, claim) => ({ source: "house rule", rule, place: { file, line }, claim, consequence: "Somebody is hurt." });

/** The fields and headings an about sketches, read the way the test writer's delivered-formats check reads them. */
function convention(about) {
  const ticks = [...about.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
  const fm = /(?:header|front matter)[^`]{0,40}`([^`#]+)`/i.exec(about);
  return { headings: ticks.filter((t) => /^#{1,6} \S/.test(t)), header: fm ? fm[1].split(",").map((s) => s.trim()) : [] };
}

test("the document carries the convention its declared kind sketches", () => {
  const doc = findingsDocument({ read, findings: [f("scripts/make.mjs", 4, "model-in-code", "make.mjs names a model.")], now: "2026-10-27T00:00:00Z", version: "0.1.0" });
  assert.equal(output.kind, "text/markdown");
  assert.equal(PIECE.media_type, output.kind);
  const c = convention(output.about);
  assert.deepEqual(c.header, ["package", "change", "findings", "open", "reviewed_by", "reviewed_at"]);
  const top = doc.split(/^## /m)[0];
  for (const h of c.header) assert.match(top, new RegExp(`^- ${h}:`, "m"), h);
  for (const h of c.headings.filter((x) => !/Outside|Answers/.test(x))) assert.match(doc, new RegExp(`^${h}\\s*$`, "m"), h);
  assert.throws(() => JSON.parse(doc));
  assert.match(doc, /### F1\. make\.mjs names a model\./);
  assert.match(doc, /- Place: `scripts\/make\.mjs:4`/);
  assert.match(doc, /- Answer: open/);
  assert.match(doc, /- open: 1/);
  assert.match(entryFor(doc).about, /1 findings, 1 open/);
});

test("an earlier review comes back answered by a reason, by a change, or still open", () => {
  const earlier = findingsDocument({ read, findings: [
    f("scripts/make.mjs", 4, "model-in-code", "make.mjs names a model."),
    f("scripts/make.mjs", 5, "hard-coded-address", "make.mjs writes an address."),
    f("scripts/pieces.mjs", 4, "undeclared-output", "a surprise is sent."),
  ] }).replace(/(### F2[\s\S]*?- Answer: )open/, "$1The address is the public site, kept on purpose.");
  const parsed = earlierFindings(earlier);
  assert.deepEqual(parsed.map((e) => [e.id, e.rule, e.answer ? "reason" : ""]), [["F1", "model-in-code", ""], ["F2", "hard-coded-address", "reason"], ["F3", "undeclared-output", ""]]);
  // Now: F1 still found two lines lower, F2 found again, F3 gone.
  const { findings, earlier: outcome } = answerAgainst([
    f("scripts/make.mjs", 6, "model-in-code", "make.mjs names a model."),
    f("scripts/make.mjs", 5, "hard-coded-address", "make.mjs writes an address."),
  ], parsed);
  assert.deepEqual(outcome.map((e) => [e.id, e.outcome]), [["F1", "open"], ["F2", "reason"], ["F3", "change"]]);
  const doc = findingsDocument({ read, findings, earlier: outcome });
  assert.match(doc, /- open: 1/);
  assert.match(doc, /The address is the public site, kept on purpose\. \(carried from the earlier review\)/);
  assert.match(doc, /## Answers to the earlier review/);
  assert.match(doc, /F3 at `scripts\/pieces\.mjs:4`: answered by a change; it no longer holds\./);
  assert.match(doc, /F2 at `scripts\/make\.mjs:5`: answered by a reason/);
});

test("open is 0 only when every finding is answered", () => {
  const all = answerAgainst([f("a.mjs", 1, "general", "x.")], [{ id: "F1", place: { file: "a.mjs", line: 1 }, rule: "general", answer: "on purpose" }]);
  assert.match(findingsDocument({ read, findings: all.findings }), /- open: 0/);
  assert.match(replyText({ read, findings: all.findings }), /Every finding is answered\./);
  assert.match(findingsDocument({ read, findings: [] }), /- open: 0\n[\s\S]*## Findings\n\nNone\./);
});

test("the reply leads with the count, names places, and declines to make the change", () => {
  const findings = [1, 2, 3, 4].map((n) => f("scripts/make.mjs", n, "general", `Problem number ${n} is here.`));
  const r = replyText({ read: { ...read, asked: "Please fix the model name and open a PR." }, findings });
  assert.match(r, /^Reviewed the whole package of bad 0\.1\.0: 4 findings, 4 open\./);
  assert.match(r, /F1 at scripts\/make\.mjs:1: Problem number 1 is here\./);
  assert.match(r, /The other 1 finding is in the document\./);
  assert.match(r, /This role does not make one/);
  assert.doesNotMatch(replyText({ read: { ...read, asked: "review at commit abc123" }, findings }), /does not make one/);
});

test("with a diff the document says what was outside the change", () => {
  const doc = findingsDocument({ read: { ...read, change: { scope: "diff", diff: "change.diff", files: [{ path: "a" }] } }, findings: [], outside: [f("b.mjs", 3, "general", "Old problem.")] });
  assert.match(doc, /- change: the diff change\.diff \(1 file\)/);
  assert.match(doc, /## Outside the change\n\n- `b\.mjs:3` \(general\): Old problem\./);
});
