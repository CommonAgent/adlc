// Migration to the shared model caller and retirement of legacy variables.
//   node --test test/migration.test.mjs
//
// What is worth pinning: no script in the package reads AGENT_MODEL, VERTEX_WHERE,
// or any GOOGLE_* variable, and setting them has no effect on model caller settings;
// no script names the metadata server hostname; no file under scripts/ carries a
// network address literal under Common Agent 12.10 outside the excepted prefixes;
// agent-runtime-requirements.json declares text-reasoning with protocols ["anthropic-messages"]
// and no credential, env, or settings; and plugin.json references scripts/model-caller.mjs
// in skills that call the model and drops caller.mjs.
//
// Nothing here touches a network or calls a real model service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { modelSettings } from "../scripts/model-caller.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const scriptFiles = readdirSync(join(ROOT, "scripts")).filter((f) => f.endsWith(".mjs"));

test("no script in the package reads AGENT_MODEL, VERTEX_WHERE, or any GOOGLE_ variable", () => {
  const legacyVars = ["AGENT_MODEL", "VERTEX_WHERE", "GOOGLE_"];
  for (const f of scriptFiles) {
    const text = readFileSync(join(ROOT, "scripts", f), "utf8");
    for (const v of legacyVars) {
      assert.equal(
        text.includes(v),
        false,
        `scripts/${f} carries reference to legacy variable ${v}`,
      );
    }
  }
});

test("setting legacy environment variables changes nothing in modelSettings", () => {
  const base = {
    MODEL_NAME: "test-model",
    MODEL_ENDPOINT: "http://127.0.0.1:8080",
    MODEL_PROTOCOL: "anthropic-messages",
    MODEL_KEY: "k",
  };
  const withLegacy = {
    ...base,
    AGENT_MODEL: "gemini-flash",
    VERTEX_WHERE: "us-central1",
    GOOGLE_API_KEY: "test-google-key",
    GOOGLE_PROJECT: "proj-123",
  };
  assert.deepEqual(modelSettings(base), modelSettings(withLegacy));
});

test("no script in the package names the metadata server hostname", () => {
  for (const f of scriptFiles) {
    const text = readFileSync(join(ROOT, "scripts", f), "utf8");
    assert.equal(
      text.includes("metadata.google.internal"),
      false,
      `scripts/${f} names metadata.google.internal`,
    );
    assert.equal(
      text.includes("169.254.169.254"),
      false,
      `scripts/${f} names metadata IP address 169.254.169.254`,
    );
  }
});

test("no script under scripts carries a network address literal under Common Agent 12.10 rules", () => {
  const ADDRESS_RE = /(?:https?|wss?):\/\/[a-zA-Z0-9\[]|169\.254\.\d+\.\d+/;
  const EXCEPTED = [
    "http://json-schema.org",
    "https://json-schema.org",
    "http://www.w3.org",
    "https://www.w3.org",
  ];
  for (const f of scriptFiles) {
    const lines = readFileSync(join(ROOT, "scripts", f), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (EXCEPTED.some((prefix) => line.includes(prefix))) continue;
      const match = ADDRESS_RE.exec(line);
      assert.equal(
        match,
        null,
        `scripts/${f}:${i + 1} carries network address literal: ${line}`,
      );
    }
  }
});

test("agent-runtime-requirements.json declares the text-reasoning model system without credential, env, or settings", () => {
  const reqs = JSON.parse(readFileSync(join(ROOT, "agent-runtime-requirements.json"), "utf8"));
  const modelSys = reqs.systems.find((s) => s.name === "text-reasoning");
  assert.ok(modelSys, "text-reasoning system is declared");
  assert.equal(modelSys.kind, "model");
  assert.deepEqual(modelSys.protocols, ["anthropic-messages"]);
  assert.equal(modelSys.credential, undefined);
  assert.equal(modelSys.env, undefined);
  assert.equal(modelSys.settings, undefined);
});

test("plugin.json lists scripts/model-caller.mjs in model-calling skills and no longer lists scripts/caller.mjs", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
  const skills = manifest.extensions["net.agentdoc.package"].build.skills;
  for (const [id, skill] of Object.entries(skills)) {
    const scripts = skill.scripts ?? [];
    assert.equal(
      scripts.includes("scripts/caller.mjs"),
      false,
      `${id} still lists retired scripts/caller.mjs`,
    );
  }
  const reviewSkills = ["review-a-change", "review-the-code"];
  for (const id of reviewSkills) {
    if (skills[id]) {
      assert.ok(
        skills[id].scripts.includes("scripts/model-caller.mjs"),
        `${id} does not list scripts/model-caller.mjs`,
      );
    }
  }
});
