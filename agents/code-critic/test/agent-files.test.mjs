// The agent's own files say what the scripts do.
//   node --test test/agent-files.test.mjs
//
// What is worth pinning: every offering and step has its skill and its build
// entry, every script a skill carries exists and every script is carried by
// some skill; every `how` is a program calling a model at named points, and
// only the review step calls one; every kind is specific (no bare
// application/json) and every input says who gives it; the run command names
// a script the offering's skill carries; the one system is text-reasoning
// with access trigger, and the package names no model anywhere a build
// reads; and the files kept the same in every package are the same here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_NAME_RE } from "../scripts/house-rules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const descriptor = json("agent-descriptor.json");
const runtime = json("agent-runtime-requirements.json");
const manifest = json("plugin.json");
const skills = manifest.extensions["net.agentdoc.package"].build.skills;

test("the versions agree", () => {
  assert.equal(descriptor.agent_version, manifest.version);
  assert.equal(manifest.name, "code-critic");
});

test("every offering and step has its skill and build entry, and every script is carried and exists", () => {
  const ids = descriptor.offerings.flatMap((o) => [o.id, ...o.steps.map((s) => s.id)]);
  assert.deepEqual(Object.keys(skills).sort(), [...ids].sort());
  for (const id of ids) {
    const md = readFileSync(join(ROOT, "skills", id, "SKILL.md"), "utf8");
    assert.match(md, new RegExp(`^---\\nname: ${id}\\n`), id);
    for (const s of skills[id].scripts ?? []) assert.match(md, new RegExp(`- ${s.replace(/[.]/g, "\\.")}$`, "m"), `${id} SKILL.md does not list ${s}`);
  }
  const carried = new Set(Object.values(skills).flatMap((s) => [...(s.scripts ?? []), ...(s.references ?? [])]));
  for (const p of carried) assert.ok(existsSync(join(ROOT, p)), `${p} does not exist`);
  for (const f of readdirSync(join(ROOT, "scripts"))) assert.ok(carried.has(`scripts/${f}`), `scripts/${f} is carried by no skill`);
});

test("every how is a program calling a model at named points, and only the review step calls one", () => {
  for (const o of descriptor.offerings) {
    for (const p of [o, ...o.steps]) {
      assert.equal(p.how.control, "script", p.id);
      assert.equal(p.how.contract, "full", p.id);
      assert.ok(["none", "called"].includes(p.how.intelligence), p.id);
    }
    assert.deepEqual(o.steps.filter((s) => s.how.intelligence === "called").map((s) => s.id), ["review-the-code"]);
  }
  for (const [id, s] of Object.entries(skills)) {
    const callsModel = (s.scripts ?? []).includes("scripts/caller.mjs");
    const step = descriptor.offerings[0].steps.find((x) => x.id === id);
    if (step) assert.equal(callsModel, step.how.intelligence === "called", `${id} carries the caller ${callsModel ? "and declares no model" : "nowhere"}`);
  }
});

test("every kind is specific and every input says who gives it", () => {
  for (const o of descriptor.offerings) {
    for (const x of [...o.inputs, ...o.outputs]) {
      assert.notEqual(x.kind.split(";")[0].trim().toLowerCase(), "application/json", x.name);
      assert.ok(x.about, `${x.name} has no about`);
    }
    for (const i of o.inputs) assert.ok(["person", "agent", "either"].includes(i.given_by), i.name);
  }
});

test("the run command names the offering's own job script", () => {
  const cmd = runtime.run["review-a-change"].command;
  assert.equal(cmd[1], "{home}/{package}/skills/review-a-change/scripts/job.mjs");
  assert.ok(skills["review-a-change"].scripts.includes("scripts/job.mjs"));
  assert.equal(runtime.run["review-a-change"].reply, "json:reply");
});

test("the one system is text-reasoning with access trigger, and no model is named where a build reads", () => {
  assert.deepEqual(descriptor.systems.map((s) => [s.name, s.access]), [["text-reasoning", "trigger"]]);
  assert.deepEqual(runtime.systems.map((s) => [s.name, s.env, s.settings.map((x) => x.env)]), [["text-reasoning", "TEXT_API_KEY", ["TEXT_MODEL"]]]);
  const read = ["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json", ...readdirSync(join(ROOT, "skills")).map((s) => `skills/${s}/SKILL.md`), ...readdirSync(join(ROOT, "scripts")).map((s) => `scripts/${s}`)];
  for (const p of read) {
    const lines = readFileSync(join(ROOT, p), "utf8").split("\n").filter((l) => p.endsWith(".md") || p.endsWith(".json") || !/^\s*(\/\/|\/\*|\*)/.test(l));
    for (const l of lines) assert.equal([...l.matchAll(MODEL_NAME_RE)].length, 0, `${p}: ${l}`);
  }
});

test("the files every package keeps the same are the same here", () => {
  const same = (a, b) => assert.equal(readFileSync(join(ROOT, a), "utf8"), readFileSync(join(ROOT, b), "utf8"), `${a} is not ${b}`);
  same("scripts/went-without.mjs", "../test-writer/scripts/went-without.mjs");
  same("scripts/agent-folder.mjs", "../package-maker/agent-folder.mjs");
});
