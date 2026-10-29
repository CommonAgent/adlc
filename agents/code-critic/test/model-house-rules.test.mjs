// House rules for model systems and caller usage in reviewed packages.
//   node --test test/model-house-rules.test.mjs
//
// What is worth pinning: a reviewed package declaring a system of kind model with
// protocols and no credential, env, or settings is accepted without findings; a model
// system declaring its own credential, env variable, or settings is flagged as a
// finding; and any script in a reviewed package calling a model without the shared
// caller is flagged as a finding.
//
// Nothing here runs a package, touches a network, or calls a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHouseRules } from "../scripts/house-rules.mjs";
import { badPackage, readOf } from "./helpers.mjs";

test("a system of kind model with protocols reached through the four settings is not a finding", () => {
  const files = badPackage();
  files["agent-runtime-requirements.json"] = JSON.stringify({
    systems: [
      {
        name: "text-reasoning",
        kind: "model",
        protocols: ["anthropic-messages"],
      },
    ],
  }, null, 2);
  const { read, texts } = readOf(files);
  const out = checkHouseRules(read, texts);
  const modelSysFindings = out.findings.filter((f) =>
    f.place.file === "agent-runtime-requirements.json" && /model|protocol|setting/i.test(f.claim),
  );
  assert.deepEqual(modelSysFindings, []);
});

test("a model system that names a credential of its own is a finding", () => {
  const files = badPackage();
  files["agent-runtime-requirements.json"] = JSON.stringify({
    systems: [
      {
        name: "text-reasoning",
        kind: "model",
        protocols: ["anthropic-messages"],
        credential: "TEXT_KEY",
      },
    ],
  }, null, 2);
  const { read, texts } = readOf(files);
  const out = checkHouseRules(read, texts);
  const f = out.findings.find((x) =>
    x.place.file === "agent-runtime-requirements.json" && /credential/i.test(x.claim),
  );
  assert.ok(f, "model system naming credential was not flagged");
  assert.match(f.claim, /credential/);
});

test("a model system that names an env variable of its own is a finding", () => {
  const files = badPackage();
  files["agent-runtime-requirements.json"] = JSON.stringify({
    systems: [
      {
        name: "text-reasoning",
        kind: "model",
        protocols: ["anthropic-messages"],
        env: "TEXT_API_KEY",
      },
    ],
  }, null, 2);
  const { read, texts } = readOf(files);
  const out = checkHouseRules(read, texts);
  const f = out.findings.find((x) =>
    x.place.file === "agent-runtime-requirements.json" && /env/i.test(x.claim),
  );
  assert.ok(f, "model system naming env variable was not flagged");
  assert.match(f.claim, /TEXT_API_KEY/);
});

test("a model system that names settings of its own is a finding", () => {
  const files = badPackage();
  files["agent-runtime-requirements.json"] = JSON.stringify({
    systems: [
      {
        name: "text-reasoning",
        kind: "model",
        protocols: ["anthropic-messages"],
        settings: [{ env: "TEXT_MODEL" }],
      },
    ],
  }, null, 2);
  const { read, texts } = readOf(files);
  const out = checkHouseRules(read, texts);
  const f = out.findings.find((x) =>
    x.place.file === "agent-runtime-requirements.json" && /settings/i.test(x.claim),
  );
  assert.ok(f, "model system naming settings was not flagged");
  assert.match(f.claim, /settings|TEXT_MODEL/);
});

test("a script that calls a model without the shared caller is a finding", () => {
  const files = badPackage();
  files["scripts/call-direct.mjs"] = [
    "import https from 'node:https';",
    "export async function ask(prompt) {",
    "  const req = https.request('https://api.anthropic.com/v1/messages', { method: 'POST' });",
    "  req.write(JSON.stringify({ prompt }));",
    "  req.end();",
    "}",
  ].join("\n");
  const { read, texts } = readOf(files);
  const out = checkHouseRules(read, texts);
  const f = out.findings.find((x) =>
    x.place.file === "scripts/call-direct.mjs" && /shared caller|caller/i.test(x.claim),
  );
  assert.ok(f, "script calling model without shared caller was not flagged");
  assert.equal(f.place.file, "scripts/call-direct.mjs");
});
