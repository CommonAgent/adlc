// Each difference and its answer, as references/how-each-change-is-answered.md lists them.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDeclarations, compareRuntimes, contractChanged, unseenChange } from "../scripts/compare.mjs";
import { bareKind, refines, satisfies } from "../scripts/kinds.mjs";
import { descriptor } from "./helpers.mjs";

const one = (before, after, change) => {
  const got = compareDeclarations(before, after).filter((d) => d.change === change);
  assert.equal(got.length, 1, `expected one ${change} in ${JSON.stringify(compareDeclarations(before, after).map((d) => d.change))}`);
  return got[0];
};
const off = (d) => d.offerings[0];

test("kinds are read the way a canvas reads them (ports.ts)", () => {
  assert.equal(bareKind("Text/Markdown; charset=utf-8"), "text/markdown");
  assert.equal(bareKind(""), null);
  assert.ok(satisfies("application/vnd.agentmesh.site-read+json", "application/json"));
  assert.ok(!satisfies("application/json", "application/vnd.agentmesh.site-read+json"));
  assert.ok(satisfies("text/markdown", "text/*"));
  assert.ok(satisfies("image/png", "*/*"));
  assert.ok(!satisfies("application/json", "application/pdf"));
  assert.ok(satisfies("application/x+xml", "application/xml"));
  assert.ok(!satisfies(null, "application/json"));
  assert.ok(refines("application/vnd.agentmesh.site-read+json", "application/json"));
  assert.ok(!refines("text/markdown", "application/json"));
});

test("offerings: removed is breaking, added compatible, a new name words only", () => {
  const base = descriptor();
  assert.equal(one(base, descriptor("2", (d) => { d.offerings = []; return d; }), "offering-removed").effect, "breaking");
  assert.equal(one(base, descriptor("2", (d) => { d.offerings.push({ id: "rewrite", name: "Rewrite", inputs: [], outputs: [] }); return d; }), "offering-added").effect, "compatible");
  assert.equal(one(base, descriptor("2", (d) => { off(d).name = "Tone check"; return d; }), "offering-name").effect, "words");
});

test("inputs: required added breaks, optional added does not, removed and narrowed break, widened does not", () => {
  const base = descriptor();
  assert.equal(one(base, descriptor("2", (d) => { off(d).inputs.push({ name: "x", kind: "text", required: true }); return d; }), "input-added-required").effect, "breaking");
  assert.equal(one(base, descriptor("2", (d) => { off(d).inputs.push({ name: "x", kind: "text" }); return d; }), "input-added-optional").effect, "compatible");
  assert.equal(one(base, descriptor("2", (d) => { off(d).inputs = []; return d; }), "input-removed").effect, "breaking");
  const opt = descriptor("1", (d) => { off(d).inputs[0].required = false; return d; });
  assert.equal(one(opt, base, "input-now-required").effect, "breaking");
  assert.equal(one(base, opt, "input-now-optional").effect, "compatible");
  assert.equal(one(base, descriptor("2", (d) => { off(d).inputs[0].kind = "text/*"; return d; }), "input-kind-wider").effect, "compatible");
  assert.equal(one(base, descriptor("2", (d) => { off(d).inputs[0].kind = "application/pdf"; return d; }), "input-kind-changed").effect, "breaking");
  const lim = (n) => descriptor("1", (d) => { off(d).inputs[0].max_bytes = n; return d; });
  assert.equal(one(lim(1000), lim(500), "input-limit-narrower").effect, "breaking");
  assert.equal(one(lim(500), lim(1000), "input-limit-wider").effect, "compatible");
  assert.equal(one(base, lim(500), "input-limit-narrower").effect, "breaking");
  assert.deepEqual(compareDeclarations(base, descriptor("1", (d) => { off(d).inputs[0].about = "The text to check."; off(d).inputs[0].given_by = "person"; return d; })), []);
  assert.equal(one(base, descriptor("1", (d) => { off(d).inputs[0].accepts = ["text/plain"]; return d; }), "input-other").effect, "breaking");
});

test("outputs: removed breaks, added is compatible, a changed kind is answered for each reader", () => {
  const base = descriptor();
  assert.equal(one(base, descriptor("2", (d) => { off(d).outputs.pop(); return d; }), "output-removed").effect, "breaking");
  assert.equal(one(base, descriptor("2", (d) => { off(d).outputs.push({ name: "score", kind: "text" }); return d; }), "output-added").effect, "compatible");
  const k = one(descriptor("1", (d) => { off(d).outputs[0].kind = "application/json"; return d; }), base, "output-kind-changed");
  assert.equal(k.effect, "kind");
  assert.equal(k.before, "application/json");
  assert.equal(k.after, "application/vnd.example.verdict+json");
  assert.equal(k.refines, true);
  assert.equal(one(base, descriptor("2", (d) => { off(d).outputs[1].when = "standing"; return d; }), "output-when-changed").effect, "breaking");
});

test("how it is done: spending more breaks, spending less does not, a new way of working is a change of behavior", () => {
  const base = descriptor();
  assert.equal(one(base, descriptor("2", (d) => { off(d).how.cost = "unbounded"; return d; }), "spend-higher").effect, "breaking");
  assert.equal(one(base, descriptor("2", (d) => { off(d).how.cost = "none"; return d; }), "spend-lower").effect, "compatible");
  assert.equal(one(base, descriptor("2", (d) => { off(d).how.intelligence = "in-control"; return d; }), "how-intelligence").effect, "behaviour");
  assert.equal(one(base, descriptor("2", (d) => { off(d).steps = [{ id: "a", name: "A" }]; return d; }), "steps-changed").effect, "behaviour");
});

test("the agent as a whole: refusals, systems and records break; escalation is a change of behavior; its words are words", () => {
  const base = descriptor();
  const r = compareDeclarations(base, descriptor("2", (d) => { d.refusals = "Rewriting the text. It changes nothing.\nReading private messages."; return d; }));
  assert.deepEqual(r.map((x) => [x.change, x.effect]), [["refusal-removed", "breaking"], ["refusal-added", "breaking"], ["refusal-added", "breaking"]]);
  assert.equal(one(base, descriptor("2", (d) => { d.systems.push({ name: "mail", access: "write" }); return d; }), "system-added").effect, "breaking");
  assert.equal(one(base, descriptor("2", (d) => { d.systems[0].access = "write"; return d; }), "system-access").effect, "breaking");
  assert.equal(one(base, descriptor("2", (d) => { d.records = []; return d; }), "records-changed").effect, "breaking");
  assert.equal(one(base, descriptor("2", (d) => { d.escalates = ["A rude word."]; return d; }), "escalates-changed").effect, "behaviour");
  assert.equal(one(base, descriptor("2", (d) => { d.does = "Checks tone."; return d; }), "does-changed").effect, "words");
  assert.equal(one(base, descriptor("2", (d) => { d.subcontracting = { allowed: true }; return d; }), "other-changed").effect, "breaking");
});

test("key order and the version alone are not differences in the declaration; the version is a change of behavior", () => {
  const a = descriptor("1.0.0");
  const b = Object.fromEntries(Object.entries(a).reverse());
  assert.deepEqual(compareDeclarations(a, b), []);
  const diffs = compareDeclarations(a, descriptor("1.0.1"));
  assert.deepEqual(diffs, []);
  assert.equal(contractChanged(diffs), false);
  const u = unseenChange({ before: a, after: descriptor("1.0.1"), contractChanged: false });
  assert.equal(u[0].change, "version-only");
  assert.equal(u[0].effect, "behaviour");
  assert.deepEqual(unseenChange({ before: a, after: a, contractChanged: false }), []);
  assert.deepEqual(unseenChange({ before: a, after: descriptor("2"), contractChanged: true }), []);
});

test("runtime requirements: a higher price and a shorter job break, a lower price and a longer job do not, a model setting is a change of behavior", () => {
  const rt = (over = {}) => ({ format: "agent-runtime-requirements-v1", job_seconds: 300, ceilings: [], systems: [], price: { sku: "default", covers: { agent: true }, price: { model: "flat", amount_micro: 500000, currency: "USD" } }, ...over });
  const flat = (n) => ({ sku: "default", covers: { agent: true }, price: { model: "flat", amount_micro: n, currency: "USD" } });
  const ch = (a, b) => compareRuntimes(a, b).map((x) => [x.change, x.effect]);
  assert.deepEqual(ch(rt(), rt({ price: flat(900000) })), [["price-changed", "breaking"]]);
  assert.deepEqual(ch(rt(), rt({ price: flat(100000) })), [["price-lower", "compatible"]]);
  assert.deepEqual(ch(rt(), rt({ price: { sku: "default", covers: { agent: true }, price: { model: "free" } } })), [["price-lower", "compatible"]]);
  assert.deepEqual(ch(rt(), rt({ job_seconds: 60 })), [["job-limit-narrower", "breaking"]]);
  assert.deepEqual(ch(rt(), rt({ job_seconds: 900 })), [["job-limit-wider", "compatible"]]);
  assert.deepEqual(ch(rt(), rt({ ceilings: [{ system: "text-reasoning", per: "task", suggested: 10 }] })), [["ceiling-added", "breaking"]]);
  const set = (p) => rt({ systems: [{ name: "text-reasoning", settings: [{ env: "TEXT_MODEL", purpose: p }] }] });
  assert.deepEqual(ch(set("a"), set("b")), [["model-setting-changed", "behaviour"]]);
  assert.deepEqual(ch(rt(), rt({ binaries: [{ name: "chromium" }] })), [["binaries-changed", "behaviour"]]);
  assert.deepEqual(compareRuntimes(rt(), null), []);
});
