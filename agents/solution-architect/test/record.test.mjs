// The record's form: the header the next stage reads the bindings from, the
// fixed headings, and reading both back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HEADER_FIELDS, HEADINGS, RECORD, bodyOf, parseRecord, questionsIn, renderRecord, statementIn } from "../scripts/architecture-record.mjs";
import { ROOT } from "./helpers.mjs";

const rec = (over = {}) => ({
  title: "key points from a web page",
  statement: "an agent that reads a web page\nand writes the key points",
  environments: ["dev", "test", "production"],
  systems: [{
    name: "text-reasoning", plain: "text reasoning", capability: "text", access: "trigger", why: "a judgment",
    bindings: { dev: { product: "google-gemini", provided_by: "platform" }, test: { unbound: true }, production: { product: "anthropic", provided_by: "customer" } },
  }],
  kind: { kind: "plugin-on-harness", why: "the house default" },
  decisions: [{ decided: "Hand back Markdown", why: "a person reads it" }],
  questions: [{ key: "binding-text-reasoning-test", question: "Which product in test?" }],
  done: false,
  ...over,
});

test("the header carries every field the standard names, in order, and reads back", () => {
  const text = renderRecord(rec());
  const head = /^---\n([\s\S]*?)\n---/.exec(text)[1];
  const fields = head.split("\n").filter((l) => /^[a-z]/.test(l)).map((l) => l.split(":")[0]);
  assert.deepEqual(fields, HEADER_FIELDS);
  const back = parseRecord(text);
  assert.equal(back.record, RECORD);
  assert.deepEqual(back.environments, ["dev", "test", "production"]);
  assert.deepEqual(back.systems, ["text-reasoning"]);
  assert.equal(back.done, false);
  assert.equal(back.questions, 1);
  assert.deepEqual(back.bindings["text-reasoning"], {
    dev: { product: "google-gemini", provided_by: "platform" },
    test: { unbound: true },
    production: { product: "anthropic", provided_by: "customer" },
  });
});

test("the body carries the fixed headings in the standard's order", () => {
  const body = bodyOf(renderRecord(rec()));
  const found = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(found, HEADINGS);
});

test("the standard and the descriptor name the same headings and header fields as the code", () => {
  const standard = readFileSync(join(ROOT, "references", "architecture-standard.md"), "utf8");
  for (const h of HEADINGS) assert.ok(standard.includes(`\`## ${h}\``), `the standard names ## ${h}`);
  for (const f of HEADER_FIELDS) assert.ok(standard.includes(`\`${f}\``), `the standard names the header field ${f}`);
  const desc = JSON.parse(readFileSync(join(ROOT, "agent-descriptor.json"), "utf8"));
  const out = desc.offerings[0].outputs.find((o) => o.name === "the architecture record");
  for (const h of HEADINGS) assert.ok(out.about.includes(`\`## ${h}\``), `the output's about names ## ${h}`);
  assert.ok(out.about.includes(`\`${HEADER_FIELDS.join(", ")}\``));
});

test("the statement and the open questions read back from the body", () => {
  const text = renderRecord(rec());
  assert.equal(statementIn(text), "an agent that reads a web page\nand writes the key points");
  assert.deepEqual(questionsIn(text), [{ key: "binding-text-reasoning-test", question: "Which product in test?" }]);
});

test("a record says plainly whether it is finished", () => {
  assert.match(renderRecord(rec()), /This record is not finished: one question is still open/);
  const done = renderRecord(rec({ questions: [], done: true }));
  assert.match(done, /^done: yes$/m);
  assert.match(done, /This record is finished/);
});

test("text that is not a record is not read as one", () => {
  assert.equal(parseRecord("# just notes"), null);
  assert.equal(parseRecord("---\nrecord: something-else\n---\n"), null);
});

test("the spec writer's copy of the record reader is this one, byte for byte", () => {
  const theirs = join(ROOT, "..", "spec-writer", "scripts", "architecture-record.mjs");
  let other = null;
  try { other = readFileSync(theirs, "utf8"); } catch { return; }
  assert.equal(other, readFileSync(join(ROOT, "scripts", "architecture-record.mjs"), "utf8"));
});

test("a header a person writes by hand in plain YAML reads the same", () => {
  const text = `---
record: 'architecture-record-v1'
statement: "Watch: the inbox"
environments:
  - dev
  - production
kind: plugin-on-harness
done: no
questions: 0
systems:
  - mail
bindings:
  mail:
    dev: resend (customer)
    production: resend (customer)
---
# x
`;
  const h = parseRecord(text);
  assert.equal(h.statement, "Watch: the inbox");
  assert.deepEqual(h.environments, ["dev", "production"]);
  assert.deepEqual(h.systems, ["mail"]);
  assert.deepEqual(h.bindings.mail.dev, { product: "resend", provided_by: "customer" });
  assert.deepEqual(parseRecord(renderRecord(rec({ statement: "Watch: the inbox # daily" }))).statement, "Watch: the inbox # daily");
});
