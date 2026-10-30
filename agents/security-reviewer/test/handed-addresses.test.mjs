// Handed-address reach rules, literal setting assignment checks, and determinism.
//
// What is worth pinning: a call to an address a program is handed counts as a
// declared reach in exactly three cases and in no other: (a) reading an address
// setting that agent-runtime-requirements.json lists under a declared service's
// settings as its address, (b) importing requestFor (or urlFor) and modelSettings
// from ./model-caller.mjs and fetching it in a package declaring a model system,
// and (c) fetching a URL in a skill whose offering declares an input marked
// external: true; negative cases with none of the three are refused naming the
// file and line; a literal URL assigned to a variable named like a setting still
// warns naming the file and address and does not count as case (a); reviewing the
// same archive twice gives the identical verdict, refusals and warnings; the
// process contract exits 2 when required parameters are missing.
// Nothing here touches a real network or model.
// Run: node --test test/handed-addresses.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT, filesOf, frontMatter, host, run, smallPackage, tarGz } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { matchReaches, tracePrograms } from "../scripts/trace-programs.mjs";
import { runJob } from "../scripts/review-package.mjs";
import { assess } from "../scripts/assess.mjs";

const LIMIT = "spending limit: 10 USD per month\n";

test("a program reading a declared service's address setting and fetching it passes as a declared reach", () => {
  const h = host();
  const p = smallPackage((pkg) => {
    pkg.descriptor.systems = [{
      name: "voice-service",
      access: "trigger",
      needs: "to synthesize speech using the voice service",
    }];
    pkg.requirements.systems = [{
      name: "voice-service",
      kind: "service",
      settings: [{
        env: "TTS_ENDPOINT",
        purpose: "where the voice service is",
      }],
    }];
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] = [
      'const endpoint = process.env.TTS_ENDPOINT;',
      'export async function speak(text) {',
      '  const res = await fetch(endpoint, { method: "POST", body: text });',
      '  return res.ok;',
      '}',
    ].join("\n");
    return pkg;
  });

  const files = new Map(Object.entries(filesOf(p)).map(([k, v]) => [k, Buffer.from(v)]));
  const { traced } = tracePrograms(files, ["skills/read-the-weather/scripts/read.mjs"]);
  const matched = matchReaches({ traced, systems: p.requirements.systems, binaries: [] });
  assert.equal(matched.unmatchedOpen.length, 0, "open fetch matched declared address setting");

  const r = run(h, { message: LIMIT, files: [{ name: "voice.tar.gz", bytes: tarGz(filesOf(p)) }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkDelivered(r.jobDir), []);

  const fm = frontMatter(r.review);
  assert.equal(fm.verdict, "passed");
  assert.deepEqual(fm.refused_for, []);
  assert.ok(!fm.no_reason_recorded.some((u) => /handed/i.test(u.permission)));
});

test("a program using model caller requestfor with a declared model system passes as a declared reach", () => {
  const h = host();
  const p = smallPackage((pkg) => {
    pkg.descriptor.systems = [{
      name: "text-reasoning",
      access: "trigger",
      needs: "to reason about user queries",
      kind: "model",
    }];
    pkg.requirements.systems = [{
      name: "text-reasoning",
      kind: "model",
      protocols: ["anthropic-messages", "openai-chat", "gemini"],
    }];
    pkg.programs["skills/read-the-weather/scripts/model-caller.mjs"] = readFileSync(
      join(AGENT, "scripts", "model-caller.mjs"),
      "utf8",
    );
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] = [
      'import { requestFor, modelSettings } from "./model-caller.mjs";',
      'export async function ground(prompt) {',
      '  const settings = modelSettings(process.env);',
      '  const req = requestFor(prompt, settings);',
      '  const res = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });',
      '  return res.json();',
      '}',
    ].join("\n");
    return pkg;
  });

  const r = run(h, { message: LIMIT, files: [{ name: "grounded.tar.gz", bytes: tarGz(filesOf(p)) }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkDelivered(r.jobDir), []);

  const fm = frontMatter(r.review);
  assert.equal(fm.verdict, "passed");
  assert.deepEqual(fm.refused_for, []);
  assert.ok(!fm.no_reason_recorded.some((u) => /handed/i.test(u.permission)));
});

test("a program fetching a url in a skill with an input marked external passes as a declared reach", () => {
  const h = host();
  const p = smallPackage((pkg) => {
    pkg.descriptor.offerings = [{
      id: "read-the-weather",
      name: "Read the weather",
      does: "Reads the forecast from an external URL.",
      inputs: [
        { name: "feed_url", kind: "url", required: true, external: true },
      ],
      outputs: [{ name: "forecast", kind: "text/markdown", when: "per_task" }],
      how: { control: "script", intelligence: "none", cost: "none", contract: "full" },
    }];
    pkg.descriptor.systems = [];
    pkg.requirements.systems = [];
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] = [
      'export async function fetchFeed(url) {',
      '  const res = await fetch(url);',
      '  return res.text();',
      '}',
    ].join("\n");
    return pkg;
  });

  const r = run(h, { message: LIMIT, files: [{ name: "external.tar.gz", bytes: tarGz(filesOf(p)) }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkDelivered(r.jobDir), []);

  const fm = frontMatter(r.review);
  assert.equal(fm.verdict, "passed");
  assert.deepEqual(fm.refused_for, []);
  assert.ok(!fm.no_reason_recorded.some((u) => /handed/i.test(u.permission)));
});

test("a handed-address fetch with none of the three is refused naming the file and line", () => {
  const h = host();
  const p = smallPackage((pkg) => {
    pkg.descriptor.systems = [];
    pkg.requirements.systems = [];
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] = [
      '// line 1',
      'export async function fetchArbitrary(dest) {',
      '  const res = await fetch(dest);',
      '  return res.text();',
      '}',
    ].join("\n");
    return pkg;
  });

  const r = run(h, { message: LIMIT, files: [{ name: "unmatched.tar.gz", bytes: tarGz(filesOf(p)) }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkDelivered(r.jobDir), []);

  const fm = frontMatter(r.review);
  assert.equal(fm.verdict, "refused");
  assert.ok(
    fm.refused_for.some((x) => x.includes("read.mjs:3")),
    `refusal must name file and line: ${JSON.stringify(fm.refused_for)}`,
  );
});

test("a literal url assigned to a setting variable still warns and does not count as reading a setting", () => {
  const h = host();
  const p = smallPackage((pkg) => {
    pkg.descriptor.systems = [{
      name: "voice-service",
      access: "trigger",
      needs: "to synthesize speech using the voice service",
    }];
    pkg.requirements.systems = [{
      name: "voice-service",
      kind: "service",
      settings: [{
        env: "TTS_ENDPOINT",
        purpose: "where the voice service is",
      }],
    }];
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] = [
      'const TTS_ENDPOINT = "https://voice-literal.example-vendor.net/v1";',
      'export async function speak(text) {',
      '  const res = await fetch(TTS_ENDPOINT, { method: "POST", body: text });',
      '  return res.ok;',
      '}',
    ].join("\n");
    return pkg;
  });

  const r = run(h, { message: LIMIT, files: [{ name: "literal.tar.gz", bytes: tarGz(filesOf(p)) }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkDelivered(r.jobDir), []);

  const fm = frontMatter(r.review);
  const warned = fm.warnings.some((w) =>
    JSON.stringify(w).includes("https://voice-literal.example-vendor.net/v1") &&
    JSON.stringify(w).includes("read.mjs"),
  );
  assert.ok(warned, "literal URL must produce a warning naming the file and the address");
  assert.equal(fm.verdict, "refused", "literal URL does not qualify as reading a setting and is refused");
  assert.ok(
    fm.refused_for.some((x) => x.includes("voice-literal.example-vendor.net") || x.includes("read.mjs")),
    `refusal must identify the unapproved destination: ${JSON.stringify(fm.refused_for)}`,
  );
});

test("reviewing the same archive twice yields the identical verdict, refusals and warnings", () => {
  const h = host();
  const p = smallPackage((pkg) => {
    pkg.descriptor.systems = [{
      name: "voice-service",
      access: "trigger",
      needs: "to synthesize speech using the voice service",
    }];
    pkg.requirements.systems = [{
      name: "voice-service",
      kind: "service",
      settings: [{
        env: "TTS_ENDPOINT",
        purpose: "where the voice service is",
      }],
    }];
    pkg.programs["skills/read-the-weather/scripts/read.mjs"] = [
      'const TTS_ENDPOINT = "https://voice-literal.example-vendor.net/v1";',
      'export async function speak(text) {',
      '  const res = await fetch(TTS_ENDPOINT, { method: "POST", body: text });',
      '  return res.ok;',
      '}',
    ].join("\n");
    return pkg;
  });

  const bytes = tarGz(filesOf(p));
  const r1 = run(h, { id: "det-1", message: LIMIT, files: [{ name: "pkg.tar.gz", bytes }] });
  const r2 = run(h, { id: "det-2", message: LIMIT, files: [{ name: "pkg.tar.gz", bytes }] });

  const fm1 = frontMatter(r1.review);
  const fm2 = frontMatter(r2.review);

  assert.equal(fm1.verdict, fm2.verdict);
  assert.deepEqual(fm1.refused_for, fm2.refused_for);
  assert.deepEqual(fm1.warnings, fm2.warnings);
});

test("review-package script exits 2 when required arguments are missing", async () => {
  const scriptPath = join(AGENT, "scripts", "review-package.mjs");
  const res = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
  assert.equal(res.status, 2);

  const direct = await runJob([], process.env);
  assert.equal(direct.code, 2);
  assert.match(direct.reply, /--job/);
});
