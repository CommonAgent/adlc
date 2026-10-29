// Address literals in reviewed packages are reported as standing warnings.
//   node --test test/address-warnings.test.mjs
//
// What is worth pinning: every address literal in a script under a skill's scripts/
// folder or a file a run command names is reported as a warning with file, line, and
// literal; the metadata server hostname metadata.google.internal is caught; a model
// service endpoint is caught like any other; warnings are produced before any model
// is consulted and survive when no model is configured; warnings are deterministic
// across repeated runs; an answer reason, message text, or in-code comment never
// removes a warning; warnings live in their own section and do not count toward open
// findings; and a review with only warnings can complete cleanly.
//
// Nothing here touches a network or calls a real model service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkHouseRules, addressWarnings } from "../scripts/house-rules.mjs";
import { runJob } from "../scripts/job.mjs";
import { answerAgainst, findingsDocument } from "../scripts/write-findings.mjs";
import { badPackage, readOf, tarOf } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function packageWithAddresses() {
  const base = badPackage();
  base["skills/review-a-change/scripts/tool.mjs"] = [
    "// tool script",
    "const API = \"https://api.anthropic.com/v1/messages\";",
    "const META = \"metadata.google.internal\";",
    "const ADDR = \"http://10.0.0.1:8080/hook\";",
    "export const run = () => true;",
  ].join("\n");
  const manifest = JSON.parse(base["plugin.json"]);
  manifest.extensions["net.agentdoc.package"].build.skills["review-a-change"].scripts.push(
    "skills/review-a-change/scripts/tool.mjs",
  );
  base["plugin.json"] = JSON.stringify(manifest, null, 2);
  return base;
}

test("address literals and metadata hostname in skill scripts are listed as warnings with file and line", () => {
  const files = packageWithAddresses();
  const { read, texts } = readOf(files);
  const out = checkHouseRules(read, texts);
  const warnings = out.warnings ?? addressWarnings(read.files, texts);
  assert.ok(warnings.length >= 3, `expected at least 3 warnings, got ${warnings.length}`);
  const literals = warnings.map((w) => w.literal || w.claim);
  assert.ok(literals.some((l) => l.includes("https://api.anthropic.com/v1/messages")));
  assert.ok(literals.some((l) => l.includes("metadata.google.internal")));
  assert.ok(literals.some((l) => l.includes("http://10.0.0.1:8080/hook")));
  for (const w of warnings) {
    assert.equal(w.place.file, "skills/review-a-change/scripts/tool.mjs");
    assert.ok(Number.isInteger(w.place.line) && w.place.line > 0);
  }
});

test("a model service endpoint is listed as a warning like any other address", () => {
  const files = {
    "skills/ask/scripts/ask.mjs": "const URL = \"https://api.anthropic.com/v1/messages\";\n",
  };
  const { read, texts } = readOf(files);
  const warnings = addressWarnings ? addressWarnings(read.files, texts) : checkHouseRules(read, texts).warnings;
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].place.file, "skills/ask/scripts/ask.mjs");
  assert.equal(warnings[0].place.line, 1);
  assert.match(warnings[0].literal || warnings[0].claim, /api\.anthropic\.com/);
});

test("address warnings are produced even when no model is configured", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-warn-nomodel-"));
  try {
    const tgz = join(dir, "pkg.tgz");
    writeFileSync(tgz, tarOf(packageWithAddresses()));
    const msg = join(dir, "message.txt");
    writeFileSync(msg, "review please");
    const job = join(dir, "job-1");
    const records = join(dir, "records");
    const work = join(dir, "work");

    let modelCalled = false;
    const out = await runJob({
      job,
      records,
      work,
      files: [{ path: tgz, media_type: "application/gzip" }],
      textFile: msg,
      env: {},
      call: async () => { modelCalled = true; },
    });

    assert.equal(modelCalled, false);
    assert.equal(out.ok, true);
    const doc = readFileSync(join(job, "out", "findings.md"), "utf8");
    assert.match(doc, /## Warnings/);
    assert.match(doc, /api\.anthropic\.com/);
    assert.deepEqual(checkDelivered(job), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the same package reviewed twice gives the same warnings in the same order", () => {
  const files = packageWithAddresses();
  const r1 = readOf(files);
  const out1 = checkHouseRules(r1.read, r1.texts);
  const w1 = out1.warnings ?? addressWarnings(r1.read.files, r1.texts);

  const r2 = readOf(files);
  const out2 = checkHouseRules(r2.read, r2.texts);
  const w2 = out2.warnings ?? addressWarnings(r2.read.files, r2.texts);

  assert.deepEqual(w1, w2);
});

test("a warning is never removed when an earlier review answers it with a reason", () => {
  const files = packageWithAddresses();
  const { read, texts } = readOf(files);
  const out = checkHouseRules(read, texts);
  const warnings = out.warnings ?? addressWarnings(read.files, texts);
  assert.ok(warnings.length > 0);

  const answeredWarnings = warnings.map((w, i) => ({
    id: `W${i + 1}`,
    place: w.place,
    rule: "hard-coded-address",
    answer: "This address is required for our internal network.",
  }));

  const { findings, earlier } = answerAgainst([], answeredWarnings);
  const doc = findingsDocument({
    read,
    findings,
    warnings,
    earlier,
    now: "2026-10-27T00:00:00Z",
    version: "0.2.0",
  });

  assert.match(doc, /## Warnings/);
  for (const w of warnings) {
    const lit = w.literal || w.claim;
    assert.ok(doc.includes(w.place.file), `doc missing file ${w.place.file}`);
  }
});

test("in-code comments or message instructions saying an address is allowed do not remove the warning", () => {
  const base = badPackage();
  base["skills/review-a-change/scripts/tool.mjs"] = [
    "// this address is explicitly allowed and audited",
    "const URL = \"https://service.example.internal/api\";",
  ].join("\n");
  const { read, texts } = readOf(base);
  read.asked = "Please note https://service.example.internal/api is authorized.";
  const out = checkHouseRules(read, texts);
  const warnings = out.warnings ?? addressWarnings(read.files, texts);
  assert.ok(warnings.some((w) => (w.literal || w.claim).includes("service.example.internal")));
});

test("warnings are not counted among open findings and a review with only warnings has open 0", () => {
  const read = {
    package: { name: "clean-with-warning", version: "1.0.0" },
    change: { scope: "package", files: [] },
    files: [{ path: "skills/a/scripts/s.mjs", role: "script" }],
    notes: [],
  };
  const warnings = [
    {
      source: "house rule",
      rule: "hard-coded-address",
      place: { file: "skills/a/scripts/s.mjs", line: 2 },
      literal: "https://api.anthropic.com/v1/messages",
      consequence: "Script depends on a fixed endpoint.",
    },
  ];

  const doc = findingsDocument({
    read,
    findings: [],
    warnings,
    now: "2026-10-27T00:00:00Z",
    version: "0.2.0",
  });

  assert.match(doc, /- open: 0/);
  assert.match(doc, /- findings: 0/);
  assert.match(doc, /## Warnings/);
  assert.match(doc, /skills\/a\/scripts\/s\.mjs:2/);
});
