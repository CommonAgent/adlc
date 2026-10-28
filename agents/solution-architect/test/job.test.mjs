// Whole jobs, the way a harness runs them: the five commands and the pieces,
// with the model's answers replayed. Includes the role's own check (Agent
// Roles, the solution architect, section 4) and the delivered formats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseRecord, questionsIn } from "../scripts/architecture-record.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { KEY_POINTS, answerFile, fixture, readJson, runJob, workspace } from "./helpers.mjs";

const keyPoints = fixture("key-points.answer.json");

test("the key points agent: text reasoning bound by capability in each environment, Markdown out, every decision with its reason", () => {
  const ws = workspace();
  const r = runJob({ ws, text: KEY_POINTS, answers: [keyPoints] });
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps));
  const h = parseRecord(r.record);
  assert.deepEqual(h.systems, ["text-reasoning"]);
  for (const env of ["dev", "test", "production"]) assert.deepEqual(h.bindings["text-reasoning"][env], { product: "google-gemini", provided_by: "platform" });
  assert.match(r.record, /^- `text-reasoning` \(text reasoning\), trigger, for text/m);
  assert.match(r.record, /hands back the key points as `text\/markdown`/);
  for (const why of r.record.matchAll(/^Why: (.*)$/gm)) assert.ok(why[1].length > 10);
  assert.equal(h.done, false);
  assert.deepEqual(questionsIn(r.record).map((q) => q.key).sort(), ["egress-1", "limit-cost"]);
  assert.match(r.reply, /Two things are still open/);
  assert.match(r.reply, /without two of the things it takes: the organization's stack and the platform's defaults/);
  assert.deepEqual(checkDelivered(r.job), []);
  const pieces = readJson(join(r.job, "pieces.json")).map((p) => p.name);
  assert.deepEqual(pieces, ["the architecture record", "what is still open"]);
});

test("answering the questions finishes the record, and what changed lists the lines and the reasons", () => {
  const ws = workspace();
  const first = runJob({ ws, name: "a", text: KEY_POINTS, answers: [keyPoints] });
  const second = runJob({ ws, name: "b", text: "limit-cost: at most 2 USD a day\negress-1: yes", files: [[join(first.job, "out", "architecture-record.md"), "text/markdown"]], answers: [keyPoints] });
  assert.equal(second.steps.check.status, 0, JSON.stringify(second.steps));
  const h = parseRecord(second.record);
  assert.equal(h.done, true);
  assert.match(second.record, /\*\*Cost\*\*: at most 2 USD a day/);
  assert.match(second.record, /\(granted by the person\)/);
  const changed = readFileSync(join(second.job, "out", "what-changed.md"), "utf8");
  assert.match(changed, /## Changed lines[\s\S]*now: - \*\*Cost\*\*: at most 2 USD a day/);
  assert.match(changed, /## Why[\s\S]*Limit what the agent spends/);
  assert.deepEqual(checkDelivered(second.job), []);
  assert.match(second.reply, /The record is finished/);
});

test("a revision with no record anywhere is refused before any model is woken", () => {
  const ws = workspace();
  const r = runJob({ ws, text: "revise: limit-cost: 2 USD a day" });
  assert.equal(r.steps.asked.status, 3);
  assert.match(r.steps.asked.out.reply, /revises an architecture record I do not have/);
});

test("nothing to write from, and a request for the statement, stop with a reply and no model", () => {
  const ws = workspace();
  const empty = runJob({ ws, name: "e", text: "" });
  assert.equal(empty.steps.asked.status, 3);
  assert.match(empty.steps.asked.out.reply, /nothing here to write an architecture from/);
  const statement = runJob({ ws, name: "s", text: "Write the statement for an agent that reads web pages." });
  assert.equal(statement.steps.asked.status, 3);
  assert.match(statement.steps.asked.out.reply, /I do not write the statement/);
  assert.ok(!existsSync(join(statement.records, "named.json")));
});

// The role's check, as Agent Roles section 4 states it.
const ROLE_STATEMENT = "An agent that reads a customer list and sends email. It will run in dev, test and production.";
const roleAnswer = {
  title: "customer emails",
  environments: ["dev", "test", "production"],
  systems: [
    { name: "database", plain: "the customer list", access: "read", why: "The customer list is kept there.", called_for: "reads a customer list" },
    { name: "mail", plain: "a mail sender", access: "write", why: "It sends email.", called_for: "sends email" },
  ],
  kind: { kind: "plugin-on-harness", why: "A short program; nothing needs its own network code." },
  dependencies: [], limits: { cost: null }, egress: [], formats: [], settings: [],
  decisions: [{ decided: "Read the list, never write it", why: "The statement only reads it." }],
  questions: [],
};
const roleDefaults = (drop = null) => {
  const h = readJson(fixture("../../references/house-stack.json"));
  return {
    systems: h.systems.map((s) => (["database", "mail"].includes(s.name) ? { ...s, house: { ...s.house, product: `platform-${s.name}`, label: `the platform's ${s.name}`, covered: true } } : s)),
    targets: h.targets,
    drop,
  };
};
const roleStack = { bindings: [{ system: "mail", product: "resend", provided_by: "customer", environments: { production: { credential: "mail-prod" } }, since: "2026-10-27", by: "owner@example.com" }] };

test("the role's check: two systems, bound everywhere, the organization's email product in production, every other binding a default, every decision with its reason", () => {
  const ws = workspace();
  const stackFile = answerFile(ws, "stack", roleStack);
  const defaultsFile = answerFile(ws, "defaults", roleDefaults());
  const r = runJob({ ws, text: ROLE_STATEMENT, files: [[stackFile, "application/vnd.agentmesh.stack+json"], [defaultsFile, "application/vnd.agentmesh.stack-vocabulary+json"]], answers: [answerFile(ws, "role", roleAnswer)] });
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps));
  const h = parseRecord(r.record);
  assert.deepEqual(h.systems, ["database", "mail"]);
  assert.deepEqual(h.bindings.mail.production, { product: "resend", provided_by: "customer" });
  for (const [s, envs] of Object.entries(h.bindings)) for (const [e, b] of Object.entries(envs)) {
    if (s === "mail" && e === "production") continue;
    assert.equal(b.provided_by, "platform", `${s} in ${e} is a platform default`);
  }
  for (const why of r.record.matchAll(/^Why: (.*)$/gm)) assert.ok(why[1].trim().length > 5);
  assert.ok(!/mail-prod|owner@example\.com/.test(r.record), "no credential name or person is copied into the record");
});

test("the role's check: a default removed in test is raised as a question and left unfilled", () => {
  const ws = workspace();
  const d = roleDefaults();
  d.systems = d.systems.map((s) => (s.name === "database" ? { ...s, house: { ...s.house, covered: false, product: "none" } } : s));
  const stackFile = answerFile(ws, "stack", { bindings: [...roleStack.bindings, { system: "database", product: "supabase", provided_by: "customer", environments: { production: {}, development: {} } }] });
  const r = runJob({ ws, text: ROLE_STATEMENT, files: [[stackFile, "application/vnd.agentmesh.stack+json"], [answerFile(ws, "defaults", d), "application/vnd.agentmesh.stack-vocabulary+json"]], answers: [answerFile(ws, "role", roleAnswer)] });
  const h = parseRecord(r.record);
  assert.deepEqual(h.bindings.database.test, { unbound: true });
  assert.ok(questionsIn(r.record).some((q) => q.key === "binding-database-test"));
  assert.equal(h.done, false);
});

test("the role's check: a design step with a third system comes back as a question, not an added system", () => {
  const ws = workspace();
  const stackFile = answerFile(ws, "stack", roleStack);
  const defaultsFile = answerFile(ws, "defaults", roleDefaults());
  const first = runJob({ ws, name: "a", text: ROLE_STATEMENT, files: [[stackFile, "application/vnd.agentmesh.stack+json"], [defaultsFile, "application/vnd.agentmesh.stack-vocabulary+json"]], answers: [answerFile(ws, "role", roleAnswer)] });
  const third = { ...roleAnswer, systems: [...roleAnswer.systems, { name: "files", access: "write", why: "the design's archive step keeps a copy of each email", called_for: "the archive step keeps a copy of each email" }] };
  const r = runJob({ ws, name: "b", text: "Revise: the design's archive step keeps a copy of each email in files.", files: [[join(first.job, "out", "architecture-record.md"), "text/markdown"], [stackFile, "application/vnd.agentmesh.stack+json"], [defaultsFile, "application/vnd.agentmesh.stack-vocabulary+json"]], answers: [answerFile(ws, "third", third)] });
  const h = parseRecord(r.record);
  assert.deepEqual(h.systems, ["database", "mail"]);
  assert.ok(questionsIn(r.record).some((q) => q.key === "system-files"));
});

test("the role's check: asked to write the statement, it declines", () => {
  const ws = workspace();
  const r = runJob({ ws, text: "Write the statement of the job for an agent that reads a customer list and sends email." });
  assert.equal(r.steps.asked.status, 3);
  assert.match(r.steps.asked.out.reply, /I do not write the statement/);
});

test("a record changed after the check wrote it is not delivered", async () => {
  const ws = workspace();
  const r = runJob({ ws, text: KEY_POINTS, answers: [keyPoints] });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(r.records, "record.md"), r.record.replace("done: no", "done: yes"));
  const { recordChanged } = await import("../scripts/pieces.mjs");
  assert.match(recordChanged(r.records), /changed after the check wrote it/);
});

test("the package declares the format rules' kinds, given_by on every input, and no bare application/json", () => {
  const d = readJson(join(fixture(".."), "..", "agent-descriptor.json"));
  for (const o of d.offerings) {
    for (const i of o.inputs) {
      assert.ok(["person", "agent", "either"].includes(i.given_by), `${o.id}: ${i.name}`);
      assert.notEqual(i.kind, "application/json");
    }
    for (const out of o.outputs) assert.notEqual(out.kind, "application/json");
  }
});

test("an address, a model's name or a credential in the statement is left out of the quoted statement, and the record still goes", () => {
  const ws = workspace();
  const r = runJob({ ws, text: `${KEY_POINTS}, starting with https://example.com/news, using gemini-3.8-flash`, answers: [keyPoints] });
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps.check));
  assert.ok(!r.record.includes("https://example.com"));
  assert.ok(!r.record.includes("gemini-3.8"));
  assert.match(r.record, /\(an address, supplied at Deploy\)/);
});

test("a third round with only a change keeps what the second settled, and stays finished", () => {
  const ws = workspace();
  const a = runJob({ ws, name: "a", text: KEY_POINTS, answers: [keyPoints] });
  const b = runJob({ ws, name: "b", text: "limit-cost: at most 2 USD a day\negress-1: yes", files: [[join(a.job, "out", "architecture-record.md"), "text/markdown"]], answers: [keyPoints] });
  const c = runJob({ ws, name: "c", text: "Revise: the key points should be at most five.", files: [[join(b.job, "out", "architecture-record.md"), "text/markdown"]], answers: [keyPoints] });
  const h = parseRecord(c.record);
  assert.equal(h.done, true, c.record);
  assert.match(c.record, /\*\*Cost\*\*: at most 2 USD a day/);
  assert.match(c.record, /\(granted by the person\)/);
});
