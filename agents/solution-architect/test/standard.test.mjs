// The standard as checks: what the model's answer is sent back for, and what
// code puts right whatever the model said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findingsOf, repaired, MODEL_NAME_RE } from "../scripts/standard.mjs";
import { fixture, readJson } from "./helpers.mjs";

const vocabulary = readJson(fixture("../../references/house-stack.json")).systems;
const good = () => readJson(fixture("key-points.answer.json"));
const ctx = { statement: "an agent that reads a web page and writes the key points for a person to review", vocabulary };

test("a sound answer has no findings", () => {
  assert.deepEqual(findingsOf(good(), ctx), []);
});

test("a system named by its product is a finding that names the system it should be", () => {
  const a = good();
  a.systems.push({ name: "supabase", access: "read", why: "x" });
  assert.ok(findingsOf(a, ctx).some((f) => /supabase is named by its product; name the system \(database\)/.test(f)));
});

test("a model system says its capability and is reached with access trigger", () => {
  const a = good();
  a.systems[0].access = "read";
  delete a.systems[0].capability;
  const f = findingsOf(a, ctx);
  assert.ok(f.some((x) => /is a model, reached with access trigger/.test(x)));
  assert.ok(f.some((x) => /capability the work needs/.test(x)));
});

test("formats: no bare application/json, a convention on Markdown, and who gives each input", () => {
  const a = good();
  a.formats.push({ piece: "the scores", direction: "out", kind: "application/json", why: "x" });
  a.formats.push({ piece: "the summary", direction: "out", kind: "text/markdown", why: "x" });
  a.formats.push({ piece: "the page list", direction: "in", kind: "text", why: "x" });
  const f = findingsOf(a, ctx);
  assert.ok(f.some((x) => /the scores is bare application\/json/.test(x)));
  assert.ok(f.some((x) => /the summary is Markdown with no convention/.test(x)));
  assert.ok(f.some((x) => /the page list does not say who gives it/.test(x)));
});

test("a model's name, an address and an address as a setting are findings", () => {
  const a = good();
  a.systems[0].why = "it runs on gemini-3.8-flash";
  a.decisions.push({ decided: "Read https://example.com/feed", why: "x" });
  a.settings.push({ name: "api-base", kind: "rule", default: "https://example.com", job_may_set: false, why: "x" });
  const f = findingsOf(a, ctx);
  assert.ok(f.some((x) => /names the model gemini-3\.8-flash/.test(x)));
  assert.ok(f.some((x) => /carries the address https:\/\/example\.com\/feed/.test(x)));
  assert.ok(f.some((x) => /api-base is an address, and addresses are never settings/.test(x)));
});

test("a decision without a reason is a finding", () => {
  const a = good();
  a.decisions.push({ decided: "Use plugin-on-harness" });
  assert.ok(findingsOf(a, ctx).some((f) => /has no reason/.test(f)));
});

test("repairs: model names, addresses and credentials are taken out of every string", () => {
  const a = good();
  a.systems[0].why = "google-vertex-anthropic/claude-sonnet-5-5 is good at this";
  a.limits.trust.limit = "calls https://evil.example.com with AIzaSyA0000000000000000000000000000000";
  const { arch, notes } = repaired(a, ctx);
  const text = JSON.stringify(arch);
  assert.equal([...text.matchAll(MODEL_NAME_RE)].length, 0);
  assert.ok(!text.includes("https://"));
  assert.ok(!text.includes("AIza"));
  assert.equal(notes.length, 1);
});

test("a spending limit the statement did not state is taken out and asked; one it stated stays", () => {
  const a = good();
  a.limits.cost = { limit: "at most 3 USD a day", why: "seems fair" };
  const r1 = repaired(a, ctx);
  assert.equal(r1.arch.limits.cost, null);
  assert.ok(r1.questions.some((q) => q.key === "limit-cost"));
  const r2 = repaired(a, { ...ctx, statement: `${ctx.statement}. It may spend 3 USD a day.` });
  assert.equal(r2.arch.limits.cost.limit, "at most 3 USD a day");
  assert.ok(!r2.questions.some((q) => q.key === "limit-cost"));
  const r3 = repaired(good(), { ...ctx, answers: { "limit-cost": "1 USD per job" } });
  assert.equal(r3.arch.limits.cost.limit, "1 USD per job");
  assert.ok(r3.arch.decisions.some((d) => /Limit what the agent spends to 1 USD per job/.test(d.decided)));
});

test("every destination beyond the derived set is asked, until a person answers it", () => {
  const r1 = repaired(good(), ctx);
  const q = r1.questions.find((x) => x.key === "egress-1");
  assert.match(q.question, /reaches-network/);
  assert.equal(r1.arch.egress[0].granted, false);
  // The next round reads which destination egress-1 asked about from the record.
  const carried = { asked_egress: [{ key: "egress-1", destination: "public web pages at the addresses its callers give" }] };
  const yes = repaired(good(), { ...ctx, carried, answers: { "egress-1": "yes, any public page" } });
  assert.equal(yes.arch.egress[0].granted, true);
  assert.ok(!yes.questions.some((x) => x.key === "egress-1"));
  const no = repaired(good(), { ...ctx, carried, answers: { "egress-1": "no" } });
  assert.equal(no.arch.egress.length, 0);
  assert.ok(no.arch.decisions.some((d) => /does not reach/.test(d.decided)));
  const unsure = repaired(good(), { ...ctx, carried, answers: { "egress-1": "maybe later" } });
  assert.match(unsure.questions.find((x) => x.key === "egress-1").question, /did not say which/);
});

test("an answer goes to the destination it was asked about, not to whatever stands first now", () => {
  const two = good();
  two.egress = [{ destination: "a news site", why: "headlines" }];
  const carried = { asked_egress: [{ key: "egress-1", destination: "a weather service" }, { key: "egress-2", destination: "a news site" }] };
  const r = repaired(two, { ...ctx, carried, answers: { "egress-1": "no", "egress-2": "yes" } });
  assert.equal(r.arch.egress[0].granted, true);
  assert.ok(r.arch.decisions.some((d) => /may reach a news site/.test(d.decided)));
});

test("what an earlier round settled stays settled: a granted destination and a set limit", () => {
  const carried = { cost: "at most 2 USD a day", granted: ["public web pages at the addresses its callers give"] };
  const r = repaired(good(), { ...ctx, carried });
  assert.equal(r.arch.limits.cost.limit, "at most 2 USD a day");
  assert.equal(r.arch.egress[0].granted, true);
  assert.deepEqual(r.questions, []);
});

test("a number in the statement is not a budget unless the sentence speaks of money", () => {
  const a = good();
  a.limits.cost = { limit: "3 dollars per job", why: "x" };
  const r = repaired(a, { ...ctx, statement: "Summarize the 3 reports each morning" });
  assert.equal(r.arch.limits.cost, null);
  assert.ok(r.questions.some((x) => x.key === "limit-cost"));
});

test("a system named by its product is renamed to its system in code", () => {
  const a = good();
  a.systems = [{ name: "supabase", access: "read", why: "the list" }];
  const { arch } = repaired(a, ctx);
  assert.equal(arch.systems[0].name, "database");
});
