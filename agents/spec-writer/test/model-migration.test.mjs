// Verification of model migration, runtime declarations, and plugin manifest schema.
//
// What is worth pinning: no script reads AGENT_MODEL, VERTEX_WHERE, or GOOGLE_* variables;
// setting them changes nothing; no script names the metadata server; no script contains
// unauthorized network address literals; agent-runtime-requirements.json declares text-reasoning
// as kind model with anthropic-messages protocol without credentials, env, or settings;
// plugin.json's build entry lists model-caller.mjs in each skill calling the model and omits
// retired callers; draft checks refuse model systems naming credentials or variables without
// referencing AGENT_MODEL or TEXT_MODEL; and plugin.json schema is read from reference.
//
// Nothing here touches a network or model.
// Run: node --test test/model-migration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDraft, systemProblems } from "../scripts/check-spec.mjs";
import { agentFilesOf } from "../scripts/files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = join(ROOT, "scripts");

const EXCEPTED_PREFIXES = [
  "https://schemas.agentmesh.ai/",
  "https://json-schema.org/",
  "http://json-schema.org/",
  "https://github.com/",
  "http://www.w3.org/",
  "https://agentmesh.ai/",
  "http://agentmesh.ai/",
];

test("no script under scripts reads AGENT_MODEL, VERTEX_WHERE, or any GOOGLE_ variable", () => {
  const scripts = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs"));
  assert.ok(scripts.length > 0);
  for (const file of scripts) {
    const text = readFileSync(join(SCRIPTS_DIR, file), "utf8");
    assert.equal(text.includes("AGENT_MODEL"), false, `${file} reads AGENT_MODEL`);
    assert.equal(text.includes("VERTEX_WHERE"), false, `${file} reads VERTEX_WHERE`);
    assert.equal(/GOOGLE_[A-Z0-9_]*/.test(text), false, `${file} reads a GOOGLE_ variable`);
  }
});

test("no script under scripts names the metadata server or carries unauthorized network address literals", () => {
  const scripts = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs"));
  const urlPattern = /(?:https?|wss?):\/\/[a-zA-Z0-9\[]|169\.254\.\d+\.\d+/g;
  for (const file of scripts) {
    const text = readFileSync(join(SCRIPTS_DIR, file), "utf8");
    assert.equal(text.includes("metadata.google.internal"), false, `${file} names metadata server`);
    assert.equal(text.includes("169.254.169.254"), false, `${file} carries metadata server address`);

    const matches = text.match(urlPattern) ?? [];
    for (const match of matches) {
      const idx = text.indexOf(match);
      const surrounding = text.slice(idx, idx + 80).split(/[\s"',`)]/)[0];
      const isAllowed = EXCEPTED_PREFIXES.some((prefix) => surrounding.startsWith(prefix));
      assert.ok(isAllowed, `${file} carries unauthorized address literal: ${surrounding}`);
    }
  }
});

test("agent-runtime-requirements.json declares the text-reasoning model system without credentials, env, or settings", () => {
  const rr = JSON.parse(readFileSync(join(ROOT, "agent-runtime-requirements.json"), "utf8"));
  const system = rr.systems.find((s) => s.name === "text-reasoning");
  assert.ok(system, "text-reasoning system missing from agent-runtime-requirements.json");
  assert.equal(system.kind, "model");
  assert.deepEqual(system.protocols, ["anthropic-messages"]);
  assert.equal("credential" in system, false, "model system must not declare credential");
  assert.equal("env" in system, false, "model system must not declare env");
  assert.equal("settings" in system, false, "model system must not declare settings");
});

test("plugin.json build entry lists model-caller.mjs for skills calling a model and omits retired callers", () => {
  const plugin = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  for (const slug of ["write-a-spec", "draft-the-spec"]) {
    const list = skills[slug]?.scripts ?? [];
    assert.ok(list.includes("scripts/model-caller.mjs"), `${slug} does not list scripts/model-caller.mjs`);
    for (const s of list) {
      assert.equal(/vertex|gemini/i.test(s), false, `${slug} still lists retired caller ${s}`);
    }
  }
});

test("a drafted agent that needs a model declares one system of kind model with protocols and no credentials", () => {
  const validSystem = {
    name: "text-reasoning",
    kind: "model",
    access: "trigger",
    protocols: ["anthropic-messages"],
  };
  assert.deepEqual(systemProblems([validSystem]), []);
});

test("checkDraft refuses a model system that declares credentials, env, or settings without mentioning AGENT_MODEL or TEXT_MODEL", () => {
  const badSystem = {
    name: "text-reasoning",
    kind: "model",
    credential: "text-reasoning-key",
    env: "TEXT_KEY",
    settings: [{ env: "MODEL_SETTING", purpose: "model override" }],
  };
  const problems = systemProblems([badSystem]);
  assert.ok(problems.length > 0, "expected problems for model system declaring credentials or env");
  const joined = problems.join(" ");
  assert.match(joined, /model system/);
  assert.equal(joined.includes("AGENT_MODEL"), false, "must not mention AGENT_MODEL");
  assert.equal(joined.includes("TEXT_MODEL"), false, "must not mention TEXT_MODEL");
});

test("the $schema in a written plugin.json matches the reference schema", () => {
  const refSchema = JSON.parse(readFileSync(join(ROOT, "references", "plugin-manifest-schema.json"), "utf8"));
  const spec = {
    name: "schema-agent",
    version: "0.1.0",
    description: "Tests schema emission.",
    jobs: [{
      slug: "do-work",
      title: "Do work",
      offered: true,
      how: { control: "script", intelligence: "none", cost: "none", contract: "full" },
      when: "when run",
      good: "work done",
      empty: "no work",
      does: "Works.",
    }],
    refuses: ["none", "none", "none", "none"],
    records: [{ name: "the signed job manifest" }],
    price: { model: "free" },
  };

  const files = agentFilesOf(spec);
  const plugin = JSON.parse(files["plugin.json"]);
  assert.equal(plugin.$schema, refSchema.$id ?? refSchema.id);
});
