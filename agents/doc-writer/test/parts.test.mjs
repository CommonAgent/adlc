// The parts the agent is made of agree with each other: the descriptor, the
// runtime requirements, plugin.json and the skills, and the shared file kept
// the same as every other package's.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(AGENT, p), "utf8"));
const D = json("agent-descriptor.json");
const R = json("agent-runtime-requirements.json");
const P = json("plugin.json");

test("one version, and every job and step has a skill with its scripts", () => {
  assert.equal(D.agent_version, P.version);
  const skills = P.extensions["net.agentdoc.package"].build.skills;
  const ids = D.offerings.flatMap((o) => [o.id, ...(o.steps ?? []).map((s) => s.id)]);
  assert.deepEqual(Object.keys(skills).sort(), [...ids].sort());
  for (const [slug, { scripts = [], references = [] }] of Object.entries(skills)) {
    assert.ok(existsSync(join(AGENT, "skills", slug, "SKILL.md")), `${slug} has a SKILL.md`);
    for (const f of [...scripts, ...references]) assert.ok(existsSync(join(AGENT, f)), `${slug}: ${f}`);
  }
  assert.ok(R.run[D.offerings[0].id], "the offering has a run command");
});

test("every kind is specific: no bare application/json, and every input says who gives it", () => {
  const pieces = D.offerings.flatMap((o) => [o, ...(o.steps ?? [])]).flatMap((j) => [...(j.inputs ?? []), ...(j.outputs ?? [])]);
  for (const p of pieces) {
    assert.notEqual(p.kind, "application/json", `${p.name} is bare application/json`);
    assert.ok(["text", "identifier", "url", "document"].includes(p.kind) || /^[a-z]+\/[a-z0-9.+-]+$/.test(p.kind), `${p.name}: ${p.kind}`);
  }
  for (const o of D.offerings) for (const i of o.inputs) assert.ok(["person", "agent", "either"].includes(i.given_by), `${i.name} says who gives it`);
});

test("it calls no model, reaches nothing, and names no model anywhere", () => {
  assert.deepEqual(D.systems ?? [], []);
  assert.deepEqual(R.systems, []);
  for (const o of D.offerings) for (const j of [o, ...(o.steps ?? [])]) {
    assert.deepEqual(j.how, { control: "script", intelligence: "none", cost: "none", contract: "full" }, j.id);
  }
  const skills = P.extensions["net.agentdoc.package"].build.skills;
  const files = [...new Set(Object.values(skills).flatMap((s) => [...(s.scripts ?? []), ...(s.references ?? [])]))];
  for (const f of files) assert.doesNotMatch(readFileSync(join(AGENT, f), "utf8"), /\b(claude|gemini|gpt-\d|sonnet|opus|haiku)\b/i, f);
});

test("went-without.mjs is the same file the other packages keep", () => {
  const mine = readFileSync(join(AGENT, "scripts", "went-without.mjs"), "utf8");
  assert.equal(mine, readFileSync(join(AGENT, "..", "spec-writer", "scripts", "went-without.mjs"), "utf8"));
});
