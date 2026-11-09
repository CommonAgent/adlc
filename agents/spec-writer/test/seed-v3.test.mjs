// The new facts of the reverse engineer 0.3.0, carried into the spec by code.
//   node --test test/seed-v3.test.mjs
//
// No model and no network. The record is test/fixtures/as-built-v3: the tide
// reader of test/fixtures/as-built with interfaces of kind constant and
// declaration, a command's required flags, a file's allowed values, and
// strings.json, the inventory of every string a person reads and every
// pattern. What is pinned: each lands in the spec where spec-v1 1.1.0 says
// it goes, with its value byte for byte; every string lands in some
// requirement's exact, under the feature whose behavior's evidence covers
// its line, else the one anchored to its file, else as a constraint; and the
// check finds any of them lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordOf, seedSpec, stringsOf, behaviorOfString } from "../scripts/seed.mjs";
import { mergeFill } from "../scripts/spec.mjs";
import { recordProblems, specProblems, corpusOf } from "../scripts/spec-check.mjs";
import { specMarkdown, validateSpec } from "../scripts/spec-v1.mjs";
import { askedWithV3, fillFor } from "./as-built-fixture.mjs";

const SAID = "Write a spec.\nname: tide-reader\nprice: free\n";
const asked = askedWithV3(SAID);
const record = recordOf(asked);
const seeded = (said = SAID) => seedSpec(recordOf(askedWithV3(said)), { said });
const requirementWith = (spec, text) => [...spec.features.flatMap((f) => f.requirements.map((r) => ({ ...r, feature: f.id }))), ...spec.constraints.map((r) => ({ ...r, feature: null }))].find((r) => (r.exact ?? []).includes(text));

test("the inventory of strings is read by its format", () => {
  assert.ok(record.strings, "strings.json is read as part of the record");
  assert.equal(stringsOf(record).length, 7);
  assert.deepEqual(stringsOf(record)[2], { file: "scripts/tides.mjs", line: 8, kind: "pattern", text: "/^[A-Z]{4}$/" });
});

test("constants and declarations are kept interfaces with their values, and a command's required flags and a file's allowed values are carried", () => {
  const s = seeded();
  const byName = (kind, name) => s.interfaces.find((i) => i.kind === kind && i.name === name);
  assert.deepEqual(byName("constant", "MOST"), { id: "I6", kind: "constant", name: "MOST", keep: true, module: "scripts/tides.mjs", value: 12, about: "The constant MOST, exported by scripts/tides.mjs, kept with its value." });
  const out = s.interfaces.find((i) => i.kind === "declaration" && i.declared_in === "agent-descriptor.json offerings[0].outputs[0].name");
  assert.deepEqual({ id: out.id, value: out.value, keep: out.keep }, { id: "I14", value: "tides", keep: true });
  assert.deepEqual(s.interfaces.find((i) => i.id === "I23").value, ["node", "{home}/{package}/skills/read-the-tides/scripts/tides.mjs", "--job", "{job_dir}", "--records", "{records}"]);
  assert.deepEqual(byName("command", "scripts/tides.mjs").required_flags, ["--job"]);
  assert.deepEqual(byName("command", "scripts/tides.mjs").flags, ["--job", "--harbor", "--records"]);
  assert.deepEqual(byName("file", "out/tides.json").values, { "/tides/*/kind": ["high", "low"], "/format": ["tides-v1"] });
  assert.deepEqual(byName("file", "out/tides.json").schema.properties.tides.items.properties.kind.enum, ["high", "low"], "the schema's enum is carried with it");
  assert.equal(s.interfaces.filter((i) => i.kind === "declaration").length, 18);
});

test("a run-config setting takes the default and range the agent declares, and only a default nobody declared is asked", () => {
  const s = seeded();
  const how = s.settings.find((x) => x.name === "how_many");
  assert.deepEqual([how.default, how.min, how.max], [12, 1, 24]);
  assert.ok(!s.open.some((o) => o.key === "setting how_many"), "a declared default is not asked");
});

test("every string lands byte for byte in some requirement's exact, where its line says", () => {
  const s = seeded();
  // Covered by B1's evidence (scripts/tides.mjs 30 to 45): a new wording requirement under F1.
  const words = requirementWith(s, "No tides were found for that harbor.");
  assert.deepEqual([words.feature, words.kind, words.source], ["F1", "wording", { behavior: "B1", evidence: [{ file: "scripts/tides.mjs", line: 36 }] }]);
  // Already a quote of B1, and a pattern of B2: carried once, not twice.
  assert.equal(s.features[0].requirements.filter((r) => (r.exact ?? []).includes("Read ${count} tides for ${harbor}.")).length, 1);
  assert.equal(s.features[1].requirements.filter((r) => (r.exact ?? []).includes("^\\s*stop that\\b")).length, 1);
  // Outside B2's evidence but in the file B2 is anchored to: under F2.
  assert.equal(requirementWith(s, "Stopped, as you asked.").feature, "F2");
  // In no behavior's file: a constraint.
  const none = requirementWith(s, "Something went wrong; nothing was written.");
  assert.equal(none.feature, null);
  assert.match(none.id, /^C\d+$/);
  assert.match(none.source.said, /scripts\/util\.mjs:4, in no behavior/);
  for (const str of stringsOf(record)) assert.ok(requirementWith(s, str.text), `${str.file}:${str.line} lands`);
  assert.ok(requirementWith(s, "/^[A-Z]{4}$/").kind === "pattern");
});

test("a string of a behavior the person dropped is not kept, and the check does not ask for it", () => {
  const said = `${SAID}dropped: B3\n`;
  const s = seeded(said);
  assert.equal(requirementWith(s, "~~ tides ~~"), undefined);
  assert.deepEqual(recordProblems(s, recordOf(askedWithV3(said))), []);
  assert.equal(behaviorOfString({ file: "scripts/banner.mjs", line: 2 }, record.behaviors.behaviors).behavior.id, "B3");
});

test("seeded and filled, the spec is valid, carries every fact of the record, and nothing is found", () => {
  const seed = seeded();
  const spec = mergeFill(seed, fillFor(seed));
  assert.deepEqual(validateSpec(spec), []);
  assert.deepEqual(recordProblems(spec, record), []);
  assert.deepEqual(specProblems(spec, { record, corpus: corpusOf(asked, null, { record }), person: { name: "tide-reader", price: "Free" } }), []);
});

test("the check finds a string, a kept value, a required flag or an allowed value the spec lost", () => {
  const seed = seeded();
  const spec = mergeFill(seed, fillFor(seed));
  const lost = structuredClone(spec);
  lost.features[0].requirements = lost.features[0].requirements.filter((r) => !(r.exact ?? []).includes("No tides were found for that harbor."));
  lost.interfaces.find((i) => i.id === "I14").value = "next-tides";
  delete lost.interfaces.find((i) => i.kind === "command").required_flags;
  delete lost.interfaces.find((i) => i.kind === "file").values;
  const found = recordProblems(lost, record).join("\n");
  assert.match(found, /fixes these for B1, and no requirement's exact carries them byte for byte: "No tides were found for that harbor\."/);
  assert.match(found, /interface I14 \(declaration agent-descriptor\.json offerings\[0\]\.outputs\[0\]\.name\) is kept as "next-tides", and the record gives "tides"/);
  assert.match(found, /does not carry --job among the flags it requires/);
  assert.match(found, /does not carry the allowed values the record gives it/);
  // On a revision whose words name I14, the new value is the person's.
  assert.ok(!recordProblems(lost, record, { targets: new Set(["I14"]) }).some((p) => /I14/.test(p)));
});

test("the spec as Markdown shows each kept value, where it is declared, the flags required and the allowed values", () => {
  const md = specMarkdown(mergeFill(seeded(), fillFor(seeded())));
  assert.match(md, /\*\*I14\*\* declaration `the first output's name`, kept exactly, declared at agent-descriptor\.json offerings\[0\]\.outputs\[0\]\.name/);
  assert.match(md, /requires --job/);
  assert.match(md, /`\/tides\/\*\/kind`: `high`, `low`/);
  assert.match(md, /\*\*I6\*\* constant `MOST`[^\n]*\n  Value:\n  ~~~json\n  12\n  ~~~/);
});
