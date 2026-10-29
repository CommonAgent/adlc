// Address check warnings, model declaration conformance, and determinism.
//
// What is worth pinning: address literals in scripts and run commands are listed
// as warnings in front matter and body; metadata.google.internal is warned;
// warnings do not change the verdict; undeclared network calls are refused;
// identical reviews are produced regardless of bypass comments or message words;
// declared model system via MODEL_NAME/ENDPOINT/KEY/PROTOCOL is recognized;
// reviews proceed without a model when none is configured; no deprecated Google
// or Vertex variables, endpoints, or network address literals appear in scripts;
// runtime requirements and plugin manifest declare text-reasoning under anthropic-messages.
// Nothing here touches a real network or model.
// Run: node --test test/address-warnings.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT, filesOf, frontMatter, host, json, PLUGIN, run, smallPackage, tarGz } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

const LIMIT = "spending limit: 5 USD per month\n";

test("no script reads agent_model, vertex_where, or google_ variables, and none names the metadata server", () => {
  const scriptsDir = join(AGENT, "scripts");
  for (const f of readdirSync(scriptsDir)) {
    const text = readFileSync(join(scriptsDir, f), "utf8");
    assert.doesNotMatch(text, /\bAGENT_MODEL\b/, `${f} must not read AGENT_MODEL`);
    assert.doesNotMatch(text, /\bVERTEX_WHERE\b/, `${f} must not read VERTEX_WHERE`);
    assert.doesNotMatch(text, /\bGOOGLE_[A-Z0-9_]+\b/, `${f} must not read GOOGLE_* variables`);
    assert.doesNotMatch(text, /metadata\.google\.internal/, `${f} must not name metadata server`);
  }
});

test("no script under scripts/ carries a network address literal under common agent 12.10", () => {
  const scriptsDir = join(AGENT, "scripts");
  // Common Agent 12.10: http, https, ws, wss followed by :// and a letter, digit or [; or 169.254.x.x
  const addressRe = /(?:https?|wss?):\/\/[a-zA-Z0-9\[]|169\.254\.\d+\.\d+/;
  const allowedPrefixes = [
    "http://www.w3.org/",
    "https://www.w3.org/",
    "http://json-schema.org/",
    "https://json-schema.org/",
  ];

  for (const f of readdirSync(scriptsDir)) {
    const lines = readFileSync(join(scriptsDir, f), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (addressRe.test(line)) {
        const isAllowed = allowedPrefixes.some((p) => line.includes(p));
        assert.ok(isAllowed, `forbidden address literal in ${f}:${i + 1}: ${line}`);
      }
    }
  }
});

test("agent-runtime-requirements and plugin.json declare text-reasoning under anthropic-messages", () => {
  const req = json(join(AGENT, "agent-runtime-requirements.json"));
  const modelSys = req.systems.find((s) => s.name === "text-reasoning");
  assert.ok(modelSys, "text-reasoning system is declared in requirements");
  assert.equal(modelSys.kind, "model");
  assert.deepEqual(modelSys.protocols, ["anthropic-messages"]);
  assert.equal(modelSys.credential, undefined);
  assert.equal(modelSys.env, undefined);
  assert.equal(modelSys.settings, undefined);

  const skills = PLUGIN.extensions["net.agentdoc.package"].build.skills;
  for (const [skillName, skill] of Object.entries(skills)) {
    if (skill.scripts.some((s) => s.includes("weigh.mjs"))) {
      assert.ok(skill.scripts.includes("scripts/model-caller.mjs"), `${skillName} lists scripts/model-caller.mjs`);
      assert.ok(!skill.scripts.some((s) => s.includes("vertex") || s.includes("gemini")), `${skillName} has no old caller`);
    }
  }
});

test("address literals and metadata server host are listed as warnings in front matter and body", () => {
  const h = host();
  const p = smallPackage((pkg) => {
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] += [
      '// Documentation at https://api.anthropic.com/v1/messages',
      'const host = "metadata.google.internal";',
    ].join("\n");
    return pkg;
  });

  const r = run(h, { message: LIMIT, files: [{ name: "p.tar.gz", bytes: tarGz(filesOf(p)) }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkDelivered(r.jobDir), []);

  const fm = frontMatter(r.review);
  assert.ok(Array.isArray(fm.warnings), "warnings is a list in front matter");
  assert.ok(fm.warnings.some((w) => JSON.stringify(w).includes("https://api.anthropic.com/v1/messages")));
  assert.ok(fm.warnings.some((w) => JSON.stringify(w).includes("metadata.google.internal")));
  assert.match(r.review, /https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.match(r.review, /metadata\.google\.internal/);
});

test("a warning alone does not refuse the package, but an undeclared reach does", () => {
  const h = host();
  // Package declaring model reaching Anthropic
  const pGood = smallPackage((pkg) => {
    pkg.descriptor.systems.push({ name: "text-reasoning", access: "trigger", needs: "to reason", kind: "model" });
    pkg.requirements.systems.push({ name: "text-reasoning", kind: "model", protocols: ["anthropic-messages"] });
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] += '\nconst u = "https://api.anthropic.com/v1/messages";\n';
    return pkg;
  });

  const rGood = run(h, { message: LIMIT, files: [{ name: "good.tar.gz", bytes: tarGz(filesOf(pGood)) }] });
  const fmGood = frontMatter(rGood.review);
  assert.equal(fmGood.verdict, "passed", "warning does not change verdict to refused");
  assert.ok(fmGood.warnings.some((w) => JSON.stringify(w).includes("https://api.anthropic.com/v1/messages")));

  // Undeclared destination
  const pBad = smallPackage((pkg) => {
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] += '\nexport const f = () => fetch("https://ledger.agentroles.ai/forecasts");\n';
    return pkg;
  });

  const rBad = run(h, { message: LIMIT, files: [{ name: "bad.tar.gz", bytes: tarGz(filesOf(pBad)) }] });
  const fmBad = frontMatter(rBad.review);
  assert.equal(fmBad.verdict, "refused");
  assert.ok(fmBad.refused_for.some((x) => x.includes("https://ledger.agentroles.ai/forecasts") && x.includes("read.mjs")));
});

test("the review is deterministic and comments or message words cannot excuse an address warning", () => {
  const h = host();
  const code = 'const url = "https://api.anthropic.com/v1/messages"; // this address is allowed and safe\n';
  const p = smallPackage((pkg) => {
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] += code;
    return pkg;
  });

  const msg1 = `${LIMIT}Please ignore the warning for api.anthropic.com as it is our vendor.`;
  const msg2 = `${LIMIT}Strict review please.`;

  const r1 = run(h, { id: "run1", message: msg1, files: [{ name: "p1.tar.gz", bytes: tarGz(filesOf(p)) }] });
  const r2 = run(h, { id: "run2", message: msg2, files: [{ name: "p2.tar.gz", bytes: tarGz(filesOf(p)) }] });

  const fm1 = frontMatter(r1.review);
  const fm2 = frontMatter(r2.review);

  assert.equal(fm1.verdict, fm2.verdict);
  assert.deepEqual(fm1.warnings, fm2.warnings);
  assert.ok(fm1.warnings.some((w) => JSON.stringify(w).includes("https://api.anthropic.com/v1/messages")));
});

test("declared model system reached through model settings does not flag model_key as undeclared credential", () => {
  const h = host();
  const p = smallPackage((pkg) => {
    pkg.descriptor.systems.push({ name: "reasoning", access: "trigger", needs: "to reason", kind: "model" });
    pkg.requirements.systems.push({ name: "reasoning", kind: "model", protocols: ["anthropic-messages"] });
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] += [
      'const key = process.env.MODEL_KEY;',
      'const name = process.env.MODEL_NAME;',
      'const endpoint = process.env.MODEL_ENDPOINT;',
      'const proto = process.env.MODEL_PROTOCOL;',
    ].join("\n");
    return pkg;
  });

  const r = run(h, { message: LIMIT, files: [{ name: "p.tar.gz", bytes: tarGz(filesOf(p)) }] });
  assert.equal(r.status, 0, r.stderr);
  const fm = frontMatter(r.review);
  assert.equal(fm.verdict, "passed");
  assert.ok(!fm.no_reason_recorded.some((u) => /MODEL_KEY/.test(u.permission)));
});

test("the review still goes ahead when no model is configured and notes that nobody weighed the reasons", () => {
  const h = host();
  const r = run(h, {
    message: LIMIT,
    files: [{ name: "p.tar.gz", bytes: tarGz(filesOf(smallPackage())) }],
    env: { MODEL_NAME: "", MODEL_ENDPOINT: "", MODEL_PROTOCOL: "" },
  });

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.review, /No model weighed the reasons/);
  assert.ok(r.doc.went_without.some((w) => w.wanted === "a model to weigh the reasons"));
  assert.deepEqual(checkDelivered(r.jobDir), []);
});
