// stages.json holds the lifecycle's 24 stages as data: the site checks its
// stages page against it (agenticdevelopment.ai, tools/check-stages.mjs), and
// the auditor and the console read it. This checks its shape, that the 24 are
// there once each, numbered 1 to 24 in order, and that every stage the
// auditor checks a record for is one of them. From 1.1.0 it also checks the
// roles that hold the stages and the evidence formats, and from 1.3.0 each
// stage's cadence.
//   node --test standards/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

// Version 1.1.0 adds the roles that hold the stages, so an organization can
// choose who holds each one, and the open formats outside holders hand their
// evidence back in.
const ROLE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

test("every role has an id, a name, its contract page, its offering and the stages it holds", () => {
  assert.ok(Array.isArray(data.roles) && data.roles.length > 0, "the file lists no roles");
  const ids = data.roles.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "a role is listed twice");
  for (const r of data.roles) {
    assert.match(r.id, ROLE_ID, `role ${r.id}`);
    assert.ok(nonEmpty(r.name), `${r.id}: no name`);
    assert.equal(r.contract, `https://agentroles.ai/${r.id}.html`, `${r.id}: contract`);
    assert.equal(r.offering, `role-${r.id}`, `${r.id}: offering`);
    assert.ok(Array.isArray(r.stages) && r.stages.length > 0, `${r.id}: holds no stage`);
    for (const s of r.stages) assert.ok(IDS.includes(s), `${r.id}: holds "${s}", which is not a stage`);
    assert.equal(new Set(r.stages).size, r.stages.length, `${r.id}: a stage is listed twice`);
  }
});

test("a role's reference agent is null or an agent in this repository", () => {
  for (const r of data.roles) {
    assert.ok(r.reference_agent === null || nonEmpty(r.reference_agent), `${r.id}: reference_agent`);
    if (r.reference_agent) assert.ok(existsSync(join(REPO, "agents", r.reference_agent)), `${r.id}: there is no agents/${r.reference_agent}`);
  }
});

test("every stage names the roles that hold it, and they agree with the roles' own lists", () => {
  const roles = new Map(data.roles.map((r) => [r.id, r]));
  for (const s of data.stages) {
    assert.ok(Array.isArray(s.role_ids) && s.role_ids.length > 0, `${s.id}: no role_ids`);
    for (const id of s.role_ids) {
      assert.ok(roles.has(id), `${s.id}: role ${id} is not in roles`);
      assert.ok(roles.get(id).stages.includes(s.id), `${s.id} names ${id}, but ${id} does not list ${s.id}`);
    }
  }
  for (const r of data.roles) for (const st of r.stages) {
    assert.ok(data.stages.find((s) => s.id === st).role_ids.includes(r.id), `${r.id} lists ${st}, but ${st} does not name ${r.id}`);
  }
});

test("the requester holds Acceptance, alone, and holds nothing else", () => {
  const req = data.roles.find((r) => r.id === "requester");
  assert.ok(req, "there is no requester role");
  assert.deepEqual(req.stages, ["acceptance"]);
  assert.equal(req.reference_agent, null, "the requester is a person, so no agent holds it for reference");
  assert.deepEqual(data.stages.find((s) => s.id === "acceptance").role_ids, ["requester"]);
});

test("the evidence formats are listed once each, with a name and what each is read for", () => {
  const formats = data.evidence_formats;
  assert.ok(Array.isArray(formats) && formats.length > 0, "the file lists no evidence formats");
  const ids = formats.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "a format is listed twice");
  for (const f of formats) {
    assert.match(f.id, ROLE_ID, `format ${f.id}`);
    assert.ok(nonEmpty(f.name) && nonEmpty(f.read_for), `${f.id}: name or read_for is empty`);
  }
  for (const id of ["sarif", "cyclonedx", "spdx", "slsa", "in-toto", "otel-genai", "pact"]) assert.ok(ids.includes(id), `${id} is not listed`);
});

// Version 1.3.0 adds each stage's cadence, so a client can show a build by
// what runs on it: the routine on every build, the stages set up once per
// product and carried forward, and the actions run when something happens.
const CADENCES = ["every_build", "setup", "when_needed"];
const EVERY_BUILD = ["requirements", "test", "code", "review", "security", "package", "release", "deploy", "conformance", "acceptance", "docs"];
const SETUP = ["architecture", "source", "publish", "monitor", "eval", "incident", "cost", "update"];
const WHEN_NEEDED = ["impact", "retract", "reconfigure", "rollback", "decommission"];

test("the three cadences are listed once each, in order, with a name and what each means", () => {
  assert.ok(Array.isArray(data.cadences), "the file lists no cadences");
  assert.deepEqual(data.cadences.map((c) => c.id), CADENCES);
  for (const c of data.cadences) assert.ok(nonEmpty(c.name) && nonEmpty(c.about), `${c.id}: name or about is empty`);
});

test("every stage has one of the three cadences, grouped as the lifecycle runs them", () => {
  for (const s of data.stages) assert.ok(CADENCES.includes(s.cadence), `${s.id}: cadence ${JSON.stringify(s.cadence)}`);
  const of = (c) => data.stages.filter((s) => s.cadence === c).map((s) => s.id);
  assert.deepEqual(of("every_build"), EVERY_BUILD);
  assert.deepEqual(of("setup"), SETUP);
  assert.deepEqual(of("when_needed"), WHEN_NEEDED);
});

test("from 1.3.0 the file says what a cadence is", () => {
  const [major, minor] = data.version.split(".").map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 3), `version ${data.version} carries cadences, so it is 1.3.0 or later`);
  assert.match(data.about, /cadence/);
});
