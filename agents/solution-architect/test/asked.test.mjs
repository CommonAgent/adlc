// Reading what was asked: telling the pieces apart by what they are, a
// revision from a request, and a request this role does not do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { answersIn, declineOf, kindOf, readingOf, wentWithoutOf } from "../scripts/asked.mjs";
import { KEY_POINTS, fixture, readJson, workspace } from "./helpers.mjs";

test("attachments are told apart by what is in them", () => {
  assert.equal(kindOf(JSON.stringify(readJson(fixture("reminders.stack.json")))), "a stack");
  assert.equal(kindOf(JSON.stringify({ systems: readJson(fixture("../../references/house-stack.json")).systems })), "the platform's defaults");
  assert.equal(kindOf("---\nrecord: architecture-record-v1\nsystems: none\n---\n# x"), "an architecture record");
  assert.equal(kindOf("The agent should also skip paywalled pages."), "part of the statement");
  assert.equal(kindOf('{"something": 1}'), "something else");
});

test("a request for the statement, the design or an agent choice is declined; an architecture request is not", () => {
  assert.match(declineOf("Write the agent's statement for an agent that reads web pages"), /I do not write the statement/);
  assert.match(declineOf("Please write the spec for this agent"), /I do not design the steps/);
  assert.match(declineOf("Choose the agent that does the fetch step"), /I do not choose the agent/);
  assert.equal(declineOf(KEY_POINTS), null);
  assert.equal(declineOf("Write the architecture for an agent that writes the statement of account"), null);
});

test("a revision's answers are lines under the keys the record asked; the rest is the change", () => {
  const { answers, change } = answersIn("limit-cost: 2 USD a day\n- egress-1: yes\nanswer: binding-database-dev: supabase\nAlso it should skip paywalled pages.", ["limit-cost", "egress-1"]);
  assert.deepEqual(answers, { "limit-cost": "2 USD a day", "egress-1": "yes", "binding-database-dev": "supabase" });
  assert.equal(change, "Also it should skip paywalled pages.");
});

test("a new request reads the statement from the words and any text attached; the defaults come from this package's copy", () => {
  const ws = workspace();
  const extra = join(ws.root, "notes.md");
  writeFileSync(extra, "It should skip paywalled pages.");
  const r = readingOf({ text: KEY_POINTS, files: [{ path: extra, media_type: "text/markdown" }] });
  assert.ok(r.statement.startsWith(KEY_POINTS));
  assert.match(r.statement, /paywalled/);
  assert.equal(r.revision, undefined);
  assert.equal(r.defaults_from, "this package's copy");
  assert.deepEqual(wentWithoutOf(r).map((w) => w.wanted), ["the organization's stack", "the platform's defaults"]);
});

test("a stack attached is read as the stack, and its credentials go no further than asked.json's copy of it", () => {
  const r = readingOf({ text: KEY_POINTS, files: [{ path: fixture("reminders.stack.json"), media_type: "application/vnd.agentmesh.stack+json" }] });
  assert.equal(r.stack.bindings.length, 2);
  assert.equal(r.stack_from, "reminders.stack.json");
});

test("a statement that opens with the word answers is a request, and a message of answers alone is a revision", async () => {
  const { REVISE_RE, onlyAnswers } = await import("../scripts/asked.mjs");
  const isRevision = (t) => REVISE_RE.test(t) || onlyAnswers(t);
  assert.equal(isRevision("Answers questions from customers about their orders"), false);
  assert.equal(isRevision("limit-cost: 2 USD a day\negress-1: yes"), true);
  assert.equal(isRevision("Revise: the archive step keeps a copy"), true);
});

test("the request for the job and a harness's shell escapes are not part of the statement", async () => {
  const { requestWords } = await import("../scripts/asked.mjs");
  assert.equal(requestWords("Write\ the\ architecture\,\ with\ the\ statement\ of\ the\ job\ attached."), "");
  assert.equal(requestWords("Write the architecture for an agent that reads a web page"), "an agent that reads a web page");
  assert.equal(requestWords(KEY_POINTS), KEY_POINTS);
});

test("the words are read from the inbox entry the host gives, exactly as sent, before a harness's own file", async () => {
  const { messageOf } = await import("../scripts/asked.mjs");
  const ws = workspace();
  const entry = join(ws.root, "message.json");
  const rec = join(ws.root, "r.md");
  writeFileSync(rec, "x");
  writeFileSync(entry, JSON.stringify({ id: "m1", text: "Revise the architecture:\nlimit-cost: 1 USD a day", files: [{ path: rec, media_type: "text/markdown" }] }));
  const escaped = join(ws.root, "t.txt");
  writeFileSync(escaped, "Revise\ the\ architecture");
  const m = messageOf({ textFile: escaped, files: "", messageFile: entry });
  assert.equal(m.text, "Revise the architecture:\nlimit-cost: 1 USD a day");
  assert.deepEqual(m.files, [{ path: rec, media_type: "text/markdown" }]);
  assert.equal(messageOf({ textFile: escaped }).text, "Revise\ the\ architecture");
});
