// Binding: the organization's choice wherever it made one, a platform default
// for the rest, a question where neither can stand, and nothing the install
// needs copied out of the stack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindAll, bindOne, stackOf } from "../scripts/bind.mjs";
import { fixture, readJson } from "./helpers.mjs";

const HOUSE = readJson(fixture("../../references/house-stack.json"));
const vocabulary = HOUSE.systems;

const stack = (bindings, extra = {}) => ({ bindings, ...extra });
const mailProdOnly = stack([{ system: "mail", product: "resend", provided_by: "customer", environments: { production: { credential: "resend-prod", address: "https://api.resend.example" } }, since: "2026-10-01", by: "a@example.com" }]);

test("the organization's choice is the binding wherever it made one", () => {
  const b = bindOne("mail", "production", { stack: mailProdOnly, vocabulary });
  assert.equal(b.product, "resend");
  assert.equal(b.provided_by, "customer");
  assert.equal(b.from, "the organization's stack");
});

test("a binding carries no credential, address, setting, key store or person", () => {
  const b = bindOne("mail", "production", { stack: mailProdOnly, vocabulary });
  const text = JSON.stringify(b);
  for (const word of ["resend-prod", "https://", "a@example.com", "credential", "address", "key_store"]) assert.ok(!text.includes(word), `${word} is not in ${text}`);
});

test("a platform default fills a system the organization left open, marked as one", () => {
  const b = bindOne("text-reasoning", "test", { stack: mailProdOnly, vocabulary });
  assert.equal(b.product, "google-gemini");
  assert.equal(b.provided_by, "platform");
  assert.equal(b.from, "the House Stack");
});

test("where the organization bound a system elsewhere, the default stands and the decision says the deploy will want the organization's own", () => {
  const withMail = vocabulary.map((s) => (s.name === "mail" ? { ...s, house: { ...s.house, product: "platform-sender", label: "the platform's sender", covered: true } } : s));
  const out = bindAll({ systems: [{ name: "mail", access: "write" }], environments: ["dev", "test", "production"] }, { stack: mailProdOnly, vocabulary: withMail });
  const m = out.systems[0].bindings;
  assert.equal(m.production.provided_by, "customer");
  assert.equal(m.test.provided_by, "platform");
  assert.equal(m.dev.provided_by, "platform");
  assert.match(out.decisions[0].follows, /refuses test on the default today until the organization binds mail there too/);
  assert.deepEqual(out.questions, []);
});

test("production stands in only where the organization said it may", () => {
  const s = stack(mailProdOnly.bindings, { production_stands_in: true });
  const b = bindOne("mail", "test", { stack: s, vocabulary });
  assert.equal(b.product, "resend");
  assert.match(b.from, /stand in/);
  assert.equal(bindOne("mail", "test", { stack: mailProdOnly, vocabulary }).unbound, true, "the House Stack has no mail sender, so without stand-in it is asked");
});

test("a system nobody can stand behind is a question naming the system and the environment", () => {
  const b = bindOne("database", "production", { stack: null, vocabulary });
  assert.equal(b.unbound, true);
  assert.match(b.question, /database/);
  assert.match(b.question, /production/);
  const unknown = bindOne("telescope", "dev", { stack: null, vocabulary });
  assert.match(unknown.question, /not a system the platform reserves/);
});

test("a person's answer binds what the stacks left open, and the question goes", () => {
  const out = bindAll({ systems: [{ name: "database", access: "read" }] }, { vocabulary, answers: { "binding-database-dev": "supabase, the test project" } });
  assert.equal(out.systems[0].bindings.dev.product, "supabase");
  assert.equal(out.systems[0].bindings.dev.from, "the person's answer");
  assert.deepEqual(out.questions.map((q) => q.key), ["binding-database-test", "binding-database-production"]);
});

test("each bound system gets one decision with its reason, and a model system says the model is configuration", () => {
  const out = bindAll({ systems: [{ name: "text-reasoning", access: "trigger" }] }, { vocabulary });
  assert.equal(out.decisions.length, 1);
  assert.match(out.decisions[0].decided, /^Bind text-reasoning to google-gemini/);
  assert.ok(out.decisions[0].why.length > 20);
  for (const setting of ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL"]) assert.match(out.decisions[0].follows, new RegExp(setting));
  assert.doesNotMatch(out.decisions[0].follows, /TEXT_MODEL|AGENT_MODEL/);
});

test("a stack is read in either shape it travels in", () => {
  assert.equal(stackOf({ stack: { bindings: [{ system: "mail" }] } }).bindings.length, 1);
  assert.equal(stackOf({ bindings: [] }).bindings.length, 0);
  assert.equal(stackOf({ systems: [] }), null);
});

test("an answer that names no product the platform knows is asked again, never bound by its first word", () => {
  const out = bindAll({ systems: [{ name: "database", access: "read" }], environments: ["dev"] }, { vocabulary, answers: { "binding-database-dev": "our Postgres" } });
  assert.equal(out.systems[0].bindings.dev.unbound, true);
  assert.match(out.questions[0].question, /named no product the platform knows for database; it knows supabase and firestore/);
});

test("an organization row naming the House Stack's product where the House Stack covers nothing is asked", () => {
  const b = bindOne("mail", "production", { stack: { bindings: [{ system: "mail", product: "platform", provided_by: "platform", environments: { production: {} } }] }, vocabulary });
  assert.equal(b.unbound, true);
});
