// The spec is the promise, so the spec is read here and held against the
// scripts that keep it.
//
// What is worth pinning: the offering's steps are jobs of this spec, in the
// order the spec gives; each job's "how" is what it claims (only the plan job
// and the ask step call a model, only they cost anything); every script the
// spec names exists and loads without running anything, so each is reached;
// the harness command names the arguments plan.mjs takes; went-without.json
// is declared as a record under the name the shared script writes; the pieces
// script files each piece under a step that is a job of this spec; and the
// package declares no settings of its own: its one system is text-reasoning, a
// model spoken to in anthropic-messages, reached through the four MODEL_*
// settings the install places, and no NEW_AGENT_USD is declared.
// Nothing here touches a network or a model.
// Run: node --test test/spec.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makePlan } from "../scripts/plan.mjs";
import { FILE } from "../scripts/went-without.mjs";
import { STEP_OF } from "../scripts/pieces.mjs";
import { readAgentFolder } from "../../package-maker/agent-folder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const spec = readAgentFolder(root);
const job = (slug) => spec.jobs.find((j) => j.slug === slug);

test("every step of the offering is a job of this spec, in the order the spec gives", () => {
  const offered = spec.jobs.filter((j) => j.offered);
  assert.deepEqual(offered.map((j) => j.slug), ["make-a-plan"]);
  // 0.3.0: no catalog and no descriptor is read here; the catalog agent answers each step at Source.
  assert.deepEqual(offered[0].steps, ["read-the-request", "ask-the-model", "check-the-plan", "write-the-plan"]);
  assert.equal(job("read-the-catalog"), undefined);
  assert.equal(job("read-the-descriptors"), undefined);
  for (const s of offered[0].steps) assert.ok(job(s), `${s} is not a job in this spec`);
});

test("each job's how is what it claims: only the plan and the ask step call a model", () => {
  assert.deepEqual(job("make-a-plan").how, { control: "script", intelligence: "called", cost: "metered", contract: "full" });
  assert.deepEqual(job("ask-the-model").how, { control: "script", intelligence: "called", cost: "metered", contract: "full" });
  for (const slug of ["read-the-request", "check-the-plan", "write-the-plan"]) {
    assert.deepEqual(job(slug).how, { control: "script", intelligence: "none", cost: "none", contract: "full" }, slug);
  }
});

test("every script the spec names exists and loads without running anything", async () => {
  const named = new Set(spec.jobs.flatMap((j) => j.scripts ?? []));
  // 0.4.0: the shared model caller is named beside the six scripts the job had.
  assert.equal(named.size, 7);
  assert.ok(named.has("scripts/model-caller.mjs"), "the shared model caller is named");
  for (const s of named) {
    assert.ok(existsSync(join(root, s)), `${s} is named in the spec and is not there`);
    await import(pathToFileURL(join(root, s)).href);
  }
  assert.equal(typeof makePlan, "function");
});

test("the harness command names the arguments plan.mjs takes", () => {
  const run = job("make-a-plan").run;
  for (const flag of ["--job", "--records", "--work", "--text-file"]) assert.ok(run.command.includes(flag), flag);
  assert.equal(run.per_file[0], "--file");
  assert.match(run.command[1], /skills\/make-a-plan\/scripts\/plan\.mjs$/);
});

test("went-without.json is declared as a per-job record under the name the shared script writes", () => {
  const declared = spec.records.find((r) => r.file === `*/${FILE}`);
  assert.ok(declared, "the record is not declared");
  assert.equal(declared.when, "per_task");
  for (const f of ["calls.json", "checks.json"]) {
    assert.ok(spec.records.some((r) => r.file === `*/${f}`), `${f} is not declared`);
  }
  assert.ok(!spec.records.some((r) => r.file === "*/candidates.json"), "0.3.0 reads no candidates");
});

test("the spec says the planner names no agent and reads no address of AgentMesh", () => {
  assert.match(spec.description, /names no agent/);
  assert.ok(!/@agentmesh\.ai|AgentMesh Build page/.test(spec.description), "the description names no handle and no page");
  const instructions = job("make-a-plan").skill;
  assert.ok(!/agentcatalog\.com|api\.agentmesh\.ai/.test(instructions), "no AgentMesh address is read");
  assert.ok(spec.refuses.some((r) => /^Naming an agent or an offering for a step/.test(r)));
});

test("every kind of piece is filed under a step that is a job of this spec", () => {
  const steps = Object.values(STEP_OF);
  assert.ok(steps.length > 0);
  for (const s of steps) assert.ok(job(s), `${s} is not a job in this spec`);
});

test("the only system is the install's model, reached through the four MODEL settings, and no setting is declared", () => {
  assert.deepEqual(spec.systems.map((s) => s.name), ["text-reasoning"]);
  const model = spec.systems[0];
  assert.equal(model.kind, "model");
  assert.deepEqual(model.protocols, ["anthropic-messages"]);
  const envs = spec.systems.flatMap((s) => (s.settings ?? []).map((x) => x.env));
  assert.deepEqual(envs, [], "the package declares no settings of its own, NEW_AGENT_USD included");
  assert.deepEqual(spec.systems.map((s) => s.env).filter(Boolean), [], "no credential variable of its own");
  const instructions = job("make-a-plan").skill;
  for (const name of ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL"]) {
    assert.ok(instructions.includes(name), `the plan job names ${name}`);
  }
});
