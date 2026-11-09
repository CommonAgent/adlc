// The spec (spec-v1): seeded from an as-built record, filled by the model by
// id, checked by rule, written out for a person, and revised only where the
// person's words name.
//   node --test test/spec.test.mjs
//
// No model and no network: every call is a stand-in that answers what a
// test hands it. The record is test/fixtures/as-built, a small tide reader
// written for these tests: a pattern and a reply quote, a limit and an order
// rule, a refusal and an error handling, an exported function and a command
// with flags, an output file with its JSON Schema, an address the code
// reaches and one it only writes down, and a run-config setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STAND_IN_NAME, approvedIn, leftOutIn, personSettled, recordOf, recordFixes, ruleValues, seedSpec, shallOf } from "../scripts/seed.mjs";
import { MD_HEADINGS, patternOf, specMarkdown, validateSpec } from "../scripts/spec-v1.mjs";
import { corpusOf, exactsOf, fitSpec, gherkinProblems, recordProblems, specProblems } from "../scripts/spec-check.mjs";
import { mergeFill, referenceParts, specCounts, writeTheSpec } from "../scripts/spec.mjs";
import { askedWith, fillFor } from "./as-built-fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAID = "Write a spec.\nwhat it should do: Rebuild the tide reader from its as-built record\nname: tide-reader\n";

test("the as-built record is read by its formats, and a cut part is read again whole from its path", () => {
  const asked = askedWith(SAID);
  const r = recordOf(asked);
  assert.ok(r.behaviors && r.interfaces && r.architecture && r.tests);
  assert.ok(r.schemas["I1.schema.json"]);
  const cut = { ...asked, attached: asked.attached.map((a) => (a.name === "behaviors.json" ? { ...a, text: a.text.slice(0, 50), cut: true } : a)) };
  assert.equal(recordOf(cut).behaviors.behaviors.length, 3);
  assert.equal(recordOf({ said: "x", attached: [] }), null);
});

test("each behavior is a feature, each quote, rule, refusal and error a requirement, with its words in exact", () => {
  const s = seedSpec(recordOf(askedWith(SAID)), { said: SAID });
  assert.equal(s.format, "spec-v1");
  assert.deepEqual(s.product, { name: "tide-reader", version: "0.1.0", kind: "agent" });
  assert.deepEqual(s.features.map((f) => [f.id, f.as_built]), [["F1", "B1"], ["F2", "B2"], ["F3", "B3"]]);
  const f1 = s.features[0];
  const byKind = (k) => f1.requirements.filter((r) => r.kind === k);
  assert.equal(byKind("behavior")[0].shall, "The agent shall read the tide table for a harbor from the tide service and writes the next tides as JSON.");
  assert.deepEqual(byKind("pattern")[0].exact, ["/^[A-Z]{4}$/"]);
  assert.deepEqual(byKind("wording")[0].exact, ["Read ${count} tides for ${harbor}."]);
  assert.deepEqual(byKind("limit")[0].exact, ["12"]);
  assert.deepEqual(byKind("order")[0].exact, ["local", "national"]);
  assert.deepEqual(byKind("refusal")[0].exact, ["I cannot read the tides for ${harbor}: the tide service did not answer. Nothing was written."]);
  assert.match(byKind("error")[0].shall, /^The agent shall return \{ reply: e\.message \}/);
  assert.deepEqual(byKind("interface")[0].exact, ["readTides"]);
  assert.deepEqual(byKind("pattern")[0].source, { behavior: "B1", evidence: [{ file: "scripts/tides.mjs", line: 8 }] });
  // MOST is 12, which the limit rule already fixes; it is not said twice.
  assert.ok(!f1.requirements.some((r) => /MOST/.test(r.shall)));
  for (const r of s.features.flatMap((f) => f.requirements)) assert.match(r.shall, /\bshall\b/);
  // The record's file is an output of the behavior that writes it, with its schema.
  assert.deepEqual(f1.outputs.find((o) => o.name === "out/tides.json").kind, "application/vnd.example.tides+json");
  assert.equal(f1.outputs.find((o) => o.name === "out/tides.json").schema.properties.format.const, "tides-v1");
});

test("the interfaces are kept, the addresses are systems, and the settings are the record's", () => {
  const s = seedSpec(recordOf(askedWith(SAID)), { said: SAID });
  assert.deepEqual(s.interfaces.map((i) => [i.id, i.kind, i.name, i.keep]), [["I1", "file", "out/tides.json", true], ["I2", "function", "readTides", true], ["I3", "function", "stopReply", true], ["I4", "command", "scripts/tides.mjs", true]]);
  assert.equal(s.interfaces[1].module, "scripts/tides.mjs");
  assert.equal(s.interfaces[1].signature, "async readTides(harbor, fetchImpl = fetch)");
  assert.deepEqual(s.interfaces[3].flags, ["--job", "--harbor"]);
  assert.equal(s.interfaces[0].schema.properties.chart.const, "https://charts.example.net/");
  assert.deepEqual(s.systems.map((x) => [x.name, x.reach, x.address]), [["Tide service", "read", "https://tides.example.org/api"], ["charts.example.net", "none", "https://charts.example.net/"]]);
  assert.match(s.systems[1].why, /writes this address down \(CHART/);
  assert.deepEqual(s.settings.map((x) => [x.name, x.kind, x.default]), [["harbor", "run-config", undefined], ["TIDE_SERVICE_ADDRESS", "address", "https://tides.example.org/api"]]);
  assert.ok(s.open.some((o) => o.key === "setting harbor"));
  assert.ok(s.open.some((o) => o.key === "price"), "a price nobody set is asked");
  assert.ok(!s.open.some((o) => o.key === "name"), "a name the person gave is not asked");
  // The runtime the code is written for, and the exported constant no behavior lists.
  assert.deepEqual(s.constraints.map((c) => [c.id, c.kind, c.exact]), [["C1", "runtime", ["node"]], ["C2", "wording", ["TIDES_KIND", "application/vnd.example.tides+json"]]]);
  assert.deepEqual(s.source, { kind: "as-built-record", repository: "https://github.com/example/tide-reader", commit: "0123456789abcdef0123456789abcdef01234567" });
  assert.deepEqual(s.record_gaps, [{ id: "G1", kind: "unclear", about: "what the banner is for" }]);
});

test("a behavior the person dropped or called a bug is no feature, and a feature keeps the id it was approved under", () => {
  const said = `${SAID}dropped: B3\n- F7 (offering read-the-tides): say the stop reply. Recognizes a stop notice.\n`;
  const s = seedSpec(recordOf(askedWith(said)), { said });
  assert.deepEqual(s.features.map((f) => [f.id, f.as_built]), [["F1", "B1"], ["F7", "B2"]]);
  assert.equal(s.features[1].offering, "read-the-tides");
  assert.deepEqual(s.left_out, [{ behavior: "B3", why: "dropped", name: "format the old banner" }]);
  assert.deepEqual([...leftOutIn("B2 is a bug\ndrop B4 and B5\nbugs: B6")].sort(), [["B2", "bug"], ["B4", "dropped"], ["B5", "dropped"], ["B6", "bug"]]);
  assert.equal(leftOutIn("It extracts text by dropping the tags (B9)").size, 0, "words that only mention dropping drop nothing");
  assert.equal(approvedIn("- F2 (offering not named): read it. Reads.\n").get("read it").offering, "");
});

test("the person's name, version and price are read from their keyed words, and a sentence becomes a shall line", () => {
  assert.deepEqual(personSettled(["name: tide-reader\nversion: 1.2.0\nprice: free"]), { name: "tide-reader", version: "1.2.0", price: "Free" });
  assert.deepEqual(personSettled(["changes: Price: free. Keep the rest."]), { name: null, version: null, price: "Free" });
  assert.deepEqual(personSettled(["Name every script the job runs."]), { name: null, version: null, price: null });
  assert.equal(shallOf("Caps the count at 30."), "The agent shall cap the count at 30.");
  assert.equal(shallOf("Fetches comments 20 at a time."), "The agent shall fetch comments 20 at a time.");
  assert.equal(shallOf("Applies the default"), "The agent shall apply the default.");
  assert.equal(shallOf("When asked, it answers."), "The agent shall do this: When asked, it answers.");
  assert.deepEqual(ruleValues({ rule: "Looks in <article>, then <main>, reading message.json, at most 200 characters.", quote: "/x/" }), ["/x/", "<article>", "<main>", "message.json", "200"]);
});

test("the schema check reads (?m) as JavaScript's m flag, and the seed is valid but for its scenarios", () => {
  assert.ok(patternOf("(?m)^\\s*Scenario:").test("Feature: x\n  Scenario: y"));
  const s = seedSpec(recordOf(askedWith(SAID)), { said: SAID });
  assert.deepEqual(validateSpec(s), s.features.map((_, i) => `spec.features[${i}].acceptance: has 0 items, fewer than 1`));
  assert.ok(validateSpec({ ...s, format: "spec-v2" }).some((p) => /format: is "spec-v2"/.test(p)));
  assert.ok(validateSpec({ ...s, product: { ...s.product, version: "one" } }).some((p) => /version: is "one"/.test(p)));
});

test("a fill is merged by id: the model's shall lines and scenarios go in, and every value code seeded stays", () => {
  const seed = seedSpec(recordOf(askedWith(SAID)), { said: SAID });
  const fill = fillFor(seed);
  // A model that tries to rewrite an exact value, or adds one nobody gave.
  fill.features.F1.exact = ["/^[a-z]+$/"];
  fill.features.F1.add = [{ shall: "The agent shall answer within 5 seconds.", kind: "performance", exact: ["5 seconds"] }];
  const m = mergeFill(seed, fill);
  assert.equal(m.purpose, "Reads the next tides for a harbor, for a sailor planning a day.");
  assert.equal(m.features[0].requirements[0].shall.startsWith("The agent shall always"), true);
  assert.deepEqual(m.features[0].requirements[1].exact, ["/^[A-Z]{4}$/"], "the record's pattern is the record's");
  assert.equal(m.features[0].acceptance[0].id, "F1.A1");
  const added = m.features[0].requirements.at(-1);
  assert.equal(added.id, `F1.R${m.features[0].requirements.length}`);
  // The check finds the invented value, and the fit asks it instead.
  const asked = askedWith(SAID);
  const corpus = corpusOf(asked, null, { record: recordOf(asked) });
  assert.ok(specProblems(m, { record: recordOf(asked), corpus, person: { name: "tide-reader" } }).some((p) => /fixes "5 seconds", which nothing given states/.test(p)));
  const fit = fitSpec(m, { person: { name: "tide-reader" }, corpus });
  assert.equal(fit.spec.features[0].requirements.at(-1).exact, undefined);
  assert.ok(fit.spec.open.some((o) => o.key === `value in ${added.id}`));
});

test("seeded and filled, the spec carries every quote, rule value, refusal and interface of the record, and nothing is found", async () => {
  const asked = askedWith(SAID);
  const prompts = [];
  const call = async (req) => { const p = req.body.contents[0].parts[0].text; prompts.push(p); return { text: JSON.stringify(fillFor(seedSpec(recordOf(asked), { said: SAID }))) }; };
  const out = await writeTheSpec({ asked, call, reference: "# What a good spec carries\nthe spec part\n# The agent's own files, made from the spec\nthe design part" });
  assert.equal(out.mode, "seeded");
  assert.equal(out.calls, 1);
  assert.deepEqual(out.findings, []);
  assert.deepEqual(validateSpec(out.spec), []);
  assert.match(prompts[0], /THE SPEC SO FAR/);
  assert.match(prompts[0], /the spec part/);
  assert.doesNotMatch(prompts[0], /the design part/, "the spec is written from the spec part of the reference only");
  const record = recordOf(asked);
  const exacts = exactsOf(out.spec);
  for (const fix of recordFixes(record, out.spec)) {
    if (fix.where === "exact") assert.ok(exacts.some((e) => e.includes(fix.value)), fix.value);
    else assert.ok(out.spec.interfaces.some((i) => i.name === fix.value), fix.value);
  }
  assert.deepEqual(specCounts(out.spec).interfaces_kept, 4);
  assert.deepEqual(recordProblems(out.spec, record), []);
});

test("what the check finds goes back once, and a feature still without a scenario gets one code writes", async () => {
  const asked = askedWith(SAID);
  const seed = seedSpec(recordOf(asked), { said: SAID });
  const prompts = [];
  const call = async (req) => { prompts.push(req.body.contents[0].parts[0].text); return { text: JSON.stringify(fillFor(seed, { skip: ["F2"] })) }; };
  const out = await writeTheSpec({ asked, call });
  assert.equal(out.calls, 2);
  assert.match(prompts[1], /WHAT WAS WRONG WITH YOUR LAST ANSWER[\s\S]*feature F2 has no acceptance scenario/);
  assert.deepEqual(out.findings, []);
  const f2 = out.spec.features.find((f) => f.id === "F2");
  assert.deepEqual(gherkinProblems(f2.acceptance[0].gherkin), []);
  assert.deepEqual(f2.acceptance[0].checks, f2.requirements.map((r) => r.id));
  assert.match(out.notes, /Code wrote the acceptance scenario of F2/);
});

test("an answer that is not JSON is asked for once more, and no answer at all ends the step in words", async () => {
  const asked = askedWith(SAID);
  const seed = seedSpec(recordOf(asked), { said: SAID });
  let n = 0;
  const call = async () => { n += 1; return { text: n === 1 ? "I could not." : JSON.stringify(fillFor(seed)) }; };
  const out = await writeTheSpec({ asked, call });
  assert.equal(out.calls, 2);
  assert.deepEqual(out.findings, []);
  const { NoSpec } = await import("../scripts/spec.mjs");
  await assert.rejects(writeTheSpec({ asked, call: async () => { throw new Error("the service is down"); } }), (e) => e instanceof NoSpec && /the service is down/.test(e.message));
});

test("a scenario that is not Gherkin, or checks no requirement, is a finding", () => {
  assert.deepEqual(gherkinProblems("Scenario: x\n  Given a\n  When b\n  Then c"), []);
  assert.deepEqual(gherkinProblems("Given a\nThen c"), ["has no Scenario: line", "has no When step"]);
  const seed = seedSpec(recordOf(askedWith(SAID)), { said: SAID });
  const m = mergeFill(seed, fillFor(seed));
  m.features[0].acceptance[0].gherkin = "Scenario: x\n  Given a";
  m.features[1].acceptance[0].checks = ["F9.R1"];
  const p = specProblems(m, { person: { name: "tide-reader" } });
  assert.ok(p.some((x) => /scenario F1\.A1 has no When step/.test(x)));
  assert.ok(p.some((x) => /scenario F2\.A1 checks F9\.R1, which is no requirement of the spec/.test(x)));
});

test("a quote the spec lost is found, by the behavior it belongs to", () => {
  const asked = askedWith(SAID);
  const seed = seedSpec(recordOf(asked), { said: SAID });
  const m = mergeFill(seed, fillFor(seed));
  m.features[1].requirements = m.features[1].requirements.filter((r) => r.kind !== "pattern");
  m.interfaces = m.interfaces.filter((i) => i.id !== "I3");
  const p = recordProblems(m, recordOf(asked));
  assert.ok(p.some((x) => x.includes("fixes these for B2") && x.includes(JSON.stringify("^\\s*stop that\\b"))));
  assert.ok(p.some((x) => /function interface I3, stopReply, is not in the spec's interfaces/.test(x)));
});

test("without a record the model drafts the whole spec, and the name, the price and a system nobody gave go to open", async () => {
  const asked = { said: "Write a spec.\nwhat it should do: say hello to whoever writes, in their language\n", attached: [] };
  const doc = {
    spec: {
      format: "spec-v1", product: { name: "greeter", version: "0.2.0", kind: "agent" }, purpose: "Says hello.",
      features: [{ id: "F1", name: "say hello", does: "Says hello in the writer's language.",
        requirements: [{ id: "F1.R1", shall: "The agent shall say hello in the writer's language.", kind: "behavior", verify: "test" }],
        acceptance: [{ id: "F1.A1", gherkin: "Scenario: hello\n  Given a message in French\n  When the agent answers\n  Then it says bonjour", checks: ["F1.R1"] }] }],
      systems: [{ name: "Translation cloud", reach: "read", why: "translates" }],
      price: "$1 a job", open: [],
    },
    notes: "drafted",
  };
  const out = await writeTheSpec({ asked, call: async () => ({ text: JSON.stringify(doc) }) });
  assert.equal(out.mode, "drafted");
  assert.equal(out.spec.product.name, STAND_IN_NAME);
  assert.equal(out.spec.price, undefined);
  assert.deepEqual(out.spec.systems, []);
  assert.deepEqual(out.spec.open.map((o) => o.key).sort(), ["name", "price", "systems"]);
  assert.deepEqual(out.spec.source, { kind: "account" });
  assert.deepEqual(validateSpec(out.spec), []);
});

test("the spec as Markdown carries every heading, each shall line, each exact value and each scenario", async () => {
  const asked = askedWith(SAID);
  const seed = seedSpec(recordOf(asked), { said: SAID });
  const out = await writeTheSpec({ asked, call: async () => ({ text: JSON.stringify(fillFor(seed)) }) });
  const md = specMarkdown(out.spec);
  assert.match(md, /^# tide-reader 0\.1\.0\n/);
  for (const h of MD_HEADINGS) assert.ok(md.includes(`\n${h}\n`), h);
  assert.match(md, /### F1 read the tide table/);
  assert.ok(md.includes("~~~\n  /^[A-Z]{4}$/\n  ~~~"));
  assert.ok(md.includes("~~~gherkin\nScenario: read the tide table"));
  assert.match(md, /`setting harbor`: The as-built record names the setting harbor/);
  assert.match(md, /charts\.example\.net: named, never reached/);
});

test("the reference has a part for the spec and a part for the agent's own files", () => {
  const ref = readFileSync(join(HERE, "..", "references", "what-a-good-spec-carries.md"), "utf8");
  const parts = referenceParts(ref);
  assert.ok(parts.spec.length > 1000 && parts.design.length > 1000);
  assert.match(parts.spec, /Gherkin/);
  assert.match(parts.design, /^# The agent's own files/);
  assert.doesNotMatch(parts.spec, /## The four sentences on every job/);
});
