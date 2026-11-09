// A revision of the spec is a set of edits code applies where the person's
// words name, and everything else stays byte for byte.
//   node --test test/revise.test.mjs
//
// No model and no network. In the round trip of 2026-11-09 the old spec
// writer redrafted the whole spec on every Ask for changes and ignored the
// words that did name a change five times; these tests pin that a revision
// cannot do that now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordOf, seedSpec } from "../scripts/seed.mjs";
import { mergeFill, writeTheSpec } from "../scripts/spec.mjs";
import { applyEdits, keyedEdits, namedTargets, personWords, unchangedProblems } from "../scripts/revise.mjs";
import { validateSpec } from "../scripts/spec-v1.mjs";
import { askedWith, fillFor } from "./as-built-fixture.mjs";

const SAID = "Write a spec.\nname: tide-reader\n";
const earlierSpec = () => { const seed = seedSpec(recordOf(askedWith(SAID)), { said: SAID }); return mergeFill(seed, fillFor(seed)); };
const revision = (words, spec = earlierSpec()) => ({
  said: words, revision: { how: "sent back with changes", answers: { said: words } },
  attached: [...askedWith(SAID).attached, { name: "spec.json", kind: "the spec", media_type: "application/vnd.agentmesh.spec+json", text: JSON.stringify(spec, null, 2) }],
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test("the person's words are read without the lines the runner adds around them", () => {
  const text = "changes: Price: free.\n\nfeatures: the owner approved these; keep each one in the spec, by its id and in its offering:\n- F1 (offering not named): read the tide table. Reads.\n\n[write-the-suite] features: the owner approved these:\nas built elsewhere: this agent is built again\n- B1 read the tide table: Reads. (scripts/tides.mjs:30)\n";
  assert.equal(personWords(text), "changes: Price: free.");
});

test("the words name ids, the name, the price, settings, systems, interfaces and open questions", () => {
  const spec = earlierSpec();
  const t = namedTargets("Change F2.R3 and C1. The pattern of B1 is wrong. Price: free. The setting harbor defaults to BRST. out/tides.json keeps its schema. Answer setting harbor.", spec);
  for (const x of ["F2.R3", "C1", "F1", "price", "setting:harbor", "I1", "open:setting harbor"]) assert.ok(t.has(x), x);
  assert.ok(!t.has("product.name"), "words that name nothing about the name do not open it");
  assert.equal(namedTargets("Name every script the job runs.", spec).size, 0, "a Design change names nothing in the spec");
});

test("an edit to what the words do not name is dropped and said, and the rest is applied", () => {
  const spec = earlierSpec();
  const targets = namedTargets("F2 says the stop reply wrong.", spec);
  const r = applyEdits(spec, [
    { set: "F2.R1", value: { shall: "The agent shall say the stop reply.", kind: "behavior", verify: "test" } },
    { set: "F1.R2", value: { shall: "The agent shall accept any harbor.", kind: "pattern", exact: [".*"], verify: "test" } },
    { remove: "I1" },
    { add: "F2.acceptance", value: { gherkin: "Scenario: s\n  Given a\n  When b\n  Then c", checks: ["F2.R1"] } },
  ], targets);
  assert.deepEqual(r.applied, ["set F2.R1", "added F2.A2"]);
  assert.deepEqual(r.dropped.map((d) => d.why), ["F1.R2 is not something your words name", "I1 is not something your words name"]);
  assert.equal(r.spec.features[1].requirements[0].id, "F2.R1", "an item keeps its id whatever the edit wrote");
  assert.deepEqual(unchangedProblems(spec, r.spec, targets), []);
  assert.ok(same(r.spec.features[0], spec.features[0]), "F1 is byte for byte as it was");
  // And a change made behind the words' back is found.
  const sneaky = structuredClone(r.spec);
  sneaky.features[0].requirements[1].exact = [".*"];
  assert.deepEqual(unchangedProblems(spec, sneaky, targets), ["F1.R2 changed, and your words do not name it; it stays as it was"]);
});

test("a keyed name, version or price is set by code and its open question goes", () => {
  const spec = earlierSpec();
  assert.ok(spec.open.some((o) => o.key === "price"));
  const r = keyedEdits(spec, "changes: price: free\nversion: 0.2.0");
  assert.equal(r.spec.price, "Free");
  assert.equal(r.spec.product.version, "0.2.0");
  assert.ok(!r.spec.open.some((o) => o.key === "price"));
  assert.deepEqual(r.applied, ["set product.version", "set price"]);
});

test("a revision whose words only key the price calls no model, and changes nothing else", async () => {
  const spec = earlierSpec();
  let calls = 0;
  const out = await writeTheSpec({ asked: revision("changes: price: free", spec), call: async () => { calls += 1; return { text: "{}" }; } });
  assert.equal(calls, 0);
  assert.equal(out.mode, "revision");
  assert.equal(out.spec.price, "Free");
  assert.deepEqual(out.revised.changed, ["price", "open"]);
  assert.deepEqual(out.findings, []);
  for (const f of spec.features) assert.ok(same(out.spec.features.find((x) => x.id === f.id), f), f.id);
});

test("a revision whose words name nothing in the spec leaves it byte for byte and says the words go to the files", async () => {
  const spec = earlierSpec();
  const out = await writeTheSpec({ asked: revision("changes: Name every script the job runs. Change nothing else.", spec), call: async () => { throw new Error("no call expected"); } });
  assert.equal(JSON.stringify(out.spec), JSON.stringify(spec));
  assert.match(out.notes, /Your words name nothing in the spec/);
});

test("a revision asks the model for edits to what the words name, applies those, and keeps the rest byte for byte", async () => {
  const spec = earlierSpec();
  const prompts = [];
  const answer = { edits: [
    { set: "F2.R3", value: { shall: "The agent shall answer the stop notice with exactly the words given.", kind: "wording", exact: ["Nothing was in progress, so nothing was done."], verify: "test" } },
    { set: "F1.R1", value: { shall: "The agent shall do something else.", kind: "behavior", verify: "test" } },
    { set: "purpose", value: "A different purpose." },
  ], notes: "rewrote F2.R3" };
  const out = await writeTheSpec({ asked: revision("changes: F2.R3 should say it answers the stop notice.", spec), call: async (req) => { prompts.push(req.body.contents[0].parts[0].text); return { text: JSON.stringify(answer) }; } });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /WHAT THEIR WORDS NAME ---\nF2\.R3\nOnly these may change/);
  assert.match(prompts[0], /THE SPEC AS IT STANDS/);
  const r = out.spec.features[1].requirements.find((x) => x.id === "F2.R3");
  assert.equal(r.shall, "The agent shall answer the stop notice with exactly the words given.");
  assert.ok(same(out.spec.features[0], spec.features[0]), "F1 is as it was");
  assert.equal(out.spec.purpose, spec.purpose, "the purpose is as it was");
  assert.deepEqual(out.revised.changed, ["F2.R3"]);
  assert.match(out.notes, /An edit was not applied, because F1\.R1 is not something your words name/);
  assert.deepEqual(out.findings, []);
  assert.deepEqual(validateSpec(out.spec), []);
});

test("an edit that loses what the record fixes is found and goes back once", async () => {
  const spec = earlierSpec();
  const prompts = [];
  const answers = [
    { edits: [{ set: "F2.R2", value: { shall: "The agent shall recognize a stop notice.", kind: "pattern", verify: "test" } }] },
    { edits: [{ set: "F2.R2", value: { shall: "The agent shall recognize a stop notice with exactly the pattern given.", kind: "pattern", exact: ["^\\s*stop that\\b"], verify: "test" } }] },
  ];
  const out = await writeTheSpec({ asked: revision("changes: F2.R2 reads badly.", spec), call: async (req) => { prompts.push(req.body.contents[0].parts[0].text); return { text: JSON.stringify(answers[prompts.length - 1]) }; } });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /the as-built record fixes these for B2/);
  assert.deepEqual(out.findings, []);
  assert.deepEqual(out.spec.features[1].requirements.find((x) => x.id === "F2.R2").exact, ["^\\s*stop that\\b"]);
});

test("with no spec attached, a revision takes the newest one an earlier job of this agent wrote", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-revise-"));
  try {
    const spec = earlierSpec();
    mkdirSync(join(dir, "r1"), { recursive: true });
    writeFileSync(join(dir, "r1", "spec.json"), JSON.stringify(spec, null, 2));
    const asked = { said: "changes: price: free", revision: { how: "sent back with changes", answers: {} }, attached: [] };
    const out = await writeTheSpec({ asked, call: async () => ({ text: "{}" }), recordsRoot: dir });
    assert.equal(out.mode, "revision");
    assert.equal(out.revised.from, join(dir, "r1", "spec.json"));
    assert.equal(out.spec.price, "Free");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
