// stages.json holds the lifecycle's 24 stages as data: the site checks its
// stages page against it (agenticdevelopment.ai, tools/check-stages.mjs), and
// the auditor and the console read it. This checks its shape, that the 24 are
// there once each, numbered 1 to 24 in order, and that every stage the
// auditor checks a record for is one of them.
//   node --test standards/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const json = (...p) => JSON.parse(readFileSync(join(REPO, ...p), "utf8"));
const data = json("standards", "stages.json");

const PHASES = ["define", "make", "ship", "prove", "use", "run", "change"];
// Other agents key on these ids; a change to one is a change to them.
const IDS = ["requirements", "architecture", "impact", "source", "test", "code", "review", "security", "package", "release", "deploy", "conformance", "acceptance", "docs", "publish", "retract", "monitor", "eval", "incident", "cost", "update", "reconfigure", "rollback", "decommission"];
const TEXT = ["name", "role", "given", "hands_back", "done_when", "why"];

const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

test("the file has a version, the seven phases in order, and 24 stages", () => {
  assert.match(data.version, /^\d+\.\d+\.\d+$/);
  assert.ok(nonEmpty(data.about));
  assert.deepEqual(data.phases.map((p) => p.id), PHASES);
  for (const p of data.phases) assert.ok(nonEmpty(p.name), `phase ${p.id} has no name`);
  assert.equal(data.stages.length, 24);
});

test("the ids are the 24 named ones, once each, in order, numbered 1 to 24", () => {
  const ids = data.stages.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "an id is listed twice");
  assert.deepEqual(ids, IDS);
  assert.deepEqual(data.stages.map((s) => s.number), IDS.map((_, i) => i + 1));
  const names = data.stages.map((s) => s.name);
  assert.equal(new Set(names).size, names.length, "a name is listed twice");
});

test("every stage carries every member, of the right kind", () => {
  for (const s of data.stages) {
    for (const k of TEXT) assert.ok(nonEmpty(s[k]), `${s.id}: ${k} is empty`);
    assert.ok(PHASES.includes(s.phase), `${s.id}: phase ${s.phase}`);
    assert.equal(typeof s.person_gate, "boolean", `${s.id}: person_gate`);
    for (const k of ["reference_holders", "assets", "aliases"]) {
      assert.ok(Array.isArray(s[k]) && s[k].every(nonEmpty), `${s.id}: ${k} is not a list of words`);
    }
    assert.equal(s.reference_holder, s.reference_holders[0] ?? null, `${s.id}: reference_holder is the first of reference_holders, or null`);
    assert.equal(s.asset, s.assets[0] ?? null, `${s.id}: asset is the first of assets, or null`);
    for (const h of s.reference_holders) assert.match(h, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, `${s.id}: holder ${h}`);
    for (const p of s.parts ?? []) for (const k of ["name", "role", "given", "hands_back"]) assert.ok(nonEmpty(p[k]), `${s.id}: part ${p.name}: ${k}`);
  }
  const aliases = data.stages.flatMap((s) => s.aliases);
  assert.ok(aliases.every((a) => !IDS.includes(a)) && new Set(aliases).size === aliases.length, "an alias repeats or names a stage");
});

test("the phases run in order, each stage inside its own", () => {
  const order = data.stages.map((s) => PHASES.indexOf(s.phase));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] >= order[i - 1], `${data.stages[i].id} is in ${data.stages[i].phase}, after a later phase`);
  for (const p of PHASES) assert.ok(order.includes(PHASES.indexOf(p)), `phase ${p} has no stage`);
});

test("a person approves or decides at Requirements, Impact and Acceptance", () => {
  const gate = Object.fromEntries(data.stages.map((s) => [s.id, s.person_gate]));
  for (const id of ["requirements", "impact", "acceptance"]) assert.equal(gate[id], true, id);
});

// The auditor names a stage by the record it checks. Most of its keys are a
// stage's id or alias; these name the stage that makes the record.
const RECORD_STAGE = { "build-record": "release", descriptor: "deploy", "deployment-record": "deploy" };
// Usability is a stage the reference repository adds in Prove (optional);
// it is not one of the 24, so the auditor's line for it maps to none.
const OUTSIDE_THE_24 = new Set(["usability"]);

test("every stage the auditor checks maps to one of the 24, with the same name and asset", () => {
  const holders = json("agents", "agent-auditor", "references", "stage-holders.json").stages;
  const byKey = new Map();
  for (const s of data.stages) for (const k of [s.id, ...s.aliases]) byKey.set(k, s);
  for (const [key, h] of Object.entries(holders)) {
    if (OUTSIDE_THE_24.has(key)) continue;
    const s = RECORD_STAGE[key] ? data.stages.find((x) => x.id === RECORD_STAGE[key]) : byKey.get(key);
    assert.ok(s, `the auditor's stage ${key} is not in stages.json`);
    assert.equal(h.made_at, s.name, `the auditor's ${key} is made at "${h.made_at}"; stages.json calls ${s.id} "${s.name}"`);
    assert.ok(s.assets.includes(h.asset), `the auditor's ${key} checks "${h.asset}"; ${s.id} makes ${JSON.stringify(s.assets)}`);
  }
  // The stage-holders list and the auditor's order name the same stages, and
  // its order follows the lifecycle's.
  const src = readFileSync(join(REPO, "agents", "agent-auditor", "scripts", "stages.mjs"), "utf8");
  const order = JSON.parse(src.match(/export const STAGE_ORDER = (\[[^\]]*\])/)[1]);
  assert.deepEqual([...order].sort(), Object.keys(holders).sort());
  const numbers = order.filter((k) => !OUTSIDE_THE_24.has(k)).map((k) => (RECORD_STAGE[k] ? data.stages.find((x) => x.id === RECORD_STAGE[k]) : byKey.get(k)).number);
  for (let i = 1; i < numbers.length; i++) assert.ok(numbers[i] >= numbers[i - 1], `the auditor checks ${order[i]} before an earlier stage`);
});
