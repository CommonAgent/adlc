// The house rules, checked with no model.
//   node --test test/house-rules.test.mjs
//
// What is worth pinning: each of the five rules finds what it is for, with a
// file, a line, a claim and a consequence; what is not a breach is left
// alone (a comment that names a model, a public address the package exists
// to read, a model provider's endpoint in the shared caller, a record built
// from a pattern); this package passes its own rules; and a real Builder's
// real breach is found where it is. With a diff, a finding off the changed
// lines is outside the change, and an access a declaration adds is a finding.
//
// Nothing here runs a package, touches a network or calls a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkHouseRules, inChange, kindHolds, modelFindings, addressFindings } from "../scripts/house-rules.mjs";
import { badPackage, filesOf, readOf } from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS = join(HERE, "..", "..");
const rulesOf = (files, change) => { const { read, texts } = readOf(files, change); return checkHouseRules(read, texts); };
const by = (out, rule) => out.findings.filter((f) => f.rule === rule);

test("every finding names a file, a line, a claim and a consequence", () => {
  const out = rulesOf(badPackage());
  assert.ok(out.findings.length >= 8, `only ${out.findings.length} findings`);
  for (const f of out.findings) {
    assert.ok(f.place.file, JSON.stringify(f));
    assert.ok(Number.isInteger(f.place.line) && f.place.line > 0, JSON.stringify(f));
    assert.ok(f.claim.length > 10 && f.consequence.length > 20, JSON.stringify(f));
  }
});

test("a model named in a script is found on its line, and a comment that names one is not", () => {
  const files = badPackage();
  files["scripts/think.mjs"] = "// 0.2.0 called gemini-2.5-flash by name and it went 404\nexport const think = () => 1;\n";
  const out = by(rulesOf(files), "model-in-code");
  assert.deepEqual(out.map((f) => `${f.place.file}:${f.place.line}`), ["scripts/make.mjs:4"]);
  assert.match(out[0].claim, /gemini-2\.5-flash/);
});

test("a model named in a declaration's setting is found", () => {
  const files = badPackage();
  const rt = JSON.parse(files["agent-runtime-requirements.json"]);
  rt.systems[0].settings = [{ env: "TEXT_MODEL", purpose: "absent, it is claude-sonnet-5-5" }];
  files["agent-runtime-requirements.json"] = JSON.stringify(rt, null, 2);
  assert.ok(by(rulesOf(files), "model-in-code").some((f) => f.place.file === "agent-runtime-requirements.json" && /claude-sonnet-5-5/.test(f.claim)));
});

test("a script that calls a model's endpoint without the configured model is found; the shared caller is not", () => {
  const files = { "scripts/look.mjs": "const URL = \"https://generativelanguage.googleapis.com/v1beta/models/x:generateContent\";\n" };
  const { read, texts } = readOf(files);
  assert.equal(modelFindings(read.files, texts).length, 1);
  const own = filesOf(join(HERE, "..", "scripts"));
  const r2 = readOf(Object.fromEntries(Object.entries(own).map(([p, t]) => [`scripts/${p}`, t])));
  assert.deepEqual(modelFindings(r2.read.files, r2.texts), []);
});

test("an environment's address, or any address used as a setting's fallback, is found; a public read is not", () => {
  const files = {
    "scripts/a.mjs": [
      "const API = process.env.MESH_API_BASE || \"https://app.dev.agentmesh.ai\";",
      "const WIKI = \"https://en.wikipedia.org/w/api.php\";",
      "const SITE = env.SITE_URL ?? \"https://brand.example.org\";",
      "const DOC = \"https://agentroles.ai/code-critic.html\";",
      "const PH = \"https://...\";",
      "const SVC = \"https://reader-abc123-uc.a.run.app/v1\";",
      "",
    ].join("\n"),
  };
  const { read, texts } = readOf(files);
  const out = addressFindings(read.files, texts);
  assert.deepEqual(out.map((f) => f.place.line), [1, 6]);
  assert.match(out[0].claim, /app\.dev\.agentmesh\.ai.*nothing is configured/);
});

test("a bare application/json is one finding for all of them, and a piece sent as another kind is found", () => {
  const out = rulesOf(badPackage());
  const bare = out.findings.filter((f) => /bare application\/json/.test(f.claim));
  assert.equal(bare.length, 1);
  assert.equal(bare[0].place.file, "agent-descriptor.json");
  const kinds = by(out, "kind-mismatch").filter((f) => f.place.file === "scripts/pieces.mjs");
  assert.ok(kinds.some((f) => /"the thing" as application\/json.*declares it text\/markdown/.test(f.claim)), JSON.stringify(kinds));
  assert.ok(kinds.some((f) => /out\/thing\.md as application\/json/.test(f.claim)));
  assert.equal(kindHolds("text", "text/plain"), true);
  assert.equal(kindHolds("document", "application/gzip"), true);
  assert.equal(kindHolds("text/markdown", "text/plain"), false);
});

test("a piece no output declares is found on its entry", () => {
  const out = by(rulesOf(badPackage()), "undeclared-output");
  assert.equal(out.length, 1);
  assert.equal(out[0].place.file, "scripts/pieces.mjs");
  assert.equal(out[0].place.line, 4);
  assert.match(out[0].claim, /"a surprise"/);
});

test("records, credentials and how claims are held to the code", () => {
  const out = by(rulesOf(badPackage()), "claims-match-code");
  const claims = out.map((f) => f.claim).join("\n");
  assert.match(claims, /declares the record \*\/round-\*\.json, and no script writes/);
  assert.match(claims, /writes secret-notes\.json into the job's records/);
  assert.doesNotMatch(claims, /writes read\.json/);
  assert.match(claims, /reads the credential STORE_TOKEN/);
  assert.doesNotMatch(claims, /MESH_API_BASE/);
  assert.match(claims, /think declares control by a model under a full contract/);
  const files = badPackage();
  const d = JSON.parse(files["agent-descriptor.json"]);
  d.offerings[0].steps[1].how = { control: "script", intelligence: "open", cost: "metered", contract: "full" };
  files["agent-descriptor.json"] = JSON.stringify(d, null, 2);
  assert.match(by(rulesOf(files), "claims-match-code").map((f) => f.claim).join("\n"), /think declares a program that hands the work to a model to find its own way/);
  assert.match(claims, /read declares no model \(intelligence none\), and scripts\/read\.mjs, which it runs, calls one/);
});

test("a record named from a pattern is found when its fixed part is written", () => {
  const files = badPackage();
  files["scripts/think.mjs"] = "// thinks\nexport const at = (n) => `round-${n}.json`;\n";
  assert.doesNotMatch(by(rulesOf(files), "claims-match-code").map((f) => f.claim).join("\n"), /round-\*\.json/);
});

test("with a diff, findings off the changed lines are outside the change, and a new write access is a finding", () => {
  const files = badPackage();
  const rt = JSON.parse(files["agent-runtime-requirements.json"]);
  rt.systems.push({ name: "customer-drive", kind: "service", access: "write" });
  files["agent-runtime-requirements.json"] = JSON.stringify(rt, null, 2) + "\n";
  const at = files["agent-runtime-requirements.json"].split("\n").findIndex((l) => /"access": "write"/.test(l)) + 1;
  const change = { scope: "diff", files: [{ path: "agent-runtime-requirements.json", lines: [at], removed: 0 }] };
  const out = rulesOf(files, change);
  const dc = out.findings.filter((f) => f.rule === "declaration-change");
  assert.equal(dc.length, 1);
  assert.match(dc[0].claim, /write access to customer-drive, and no script in the change uses it/);
  assert.ok(out.outside_the_change.some((f) => f.place.file === "scripts/make.mjs"));
  assert.ok(!out.findings.some((f) => f.place.file === "scripts/make.mjs"));
  assert.equal(inChange({ place: { file: "scripts/make.mjs", line: 4 } }, { change: { scope: "package" } }), true);
});

test("this package keeps its own house rules", () => {
  const out = rulesOf(filesOf(join(HERE, "..")));
  assert.deepEqual(out.findings.map((f) => `${f.rule} ${f.place.file}:${f.place.line} ${f.claim}`), []);
});

test("a real Builder's hard-coded address is found where it is", () => {
  const out = rulesOf(filesOf(join(AGENTS, "publisher")));
  const f = out.findings.find((x) => x.rule === "hard-coded-address");
  assert.ok(f, "the publisher's API_DEFAULT was not found");
  assert.equal(f.place.file, "scripts/place.mjs");
  assert.match(f.claim, /api\.agentmesh\.ai/);
});
