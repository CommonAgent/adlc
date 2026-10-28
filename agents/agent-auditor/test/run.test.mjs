// The audit end to end, as the runtime requirements start it, against a
// platform served from a map: a hand-made agent fails on its missing stage
// records, an agent that came through every stage passes, the report is
// signed and filed by its digest, each finding is filed once, and the
// auditor approves nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runJob } from "../scripts/audit.mjs";
import { holderHandles } from "../scripts/gather.mjs";
import { canonical, sha256, verifyReport } from "../scripts/keys.mjs";
import { frontMatterOf } from "../scripts/checklist.mjs";
import { DEV, PROD, agentFiles, boundDescriptor, fakePlatform, jobWith, keyring, makeTar, signManifest, signRecord } from "./helpers.mjs";

const HANDLE = "summarizer.platform@agentmesh.ai";
const HOLDERS = holderHandles();
const NOW = new Date("2026-11-02T12:00:00Z");

/** A platform holding one agent, and the keys of everyone who signs. */
function world({ firstReleased = "2026-10-30T00:00:00Z", deployed = true, conformance = true, prodVersion = null, agentdocVersion = null, prodListedAt = null, legacy = false } = {}) {
  const handles = [...new Set(Object.values(HOLDERS).flatMap((s) => s.holders))];
  const keys = keyring([...handles, "agent", "auditor", "stranger"]);
  const pkg = agentFiles({ version: "1.0.0" });
  if (legacy) {
    // A package built before Common Agent 0.30.0-draft: descriptor.json, which plugin.json points at.
    pkg.files["descriptor.json"] = pkg.files["agent-descriptor.json"];
    delete pkg.files["agent-descriptor.json"];
    pkg.files["plugin.json"] = JSON.stringify({ name: "summarizer", version: "1.0.0", extensions: { "net.agentdoc.package": { descriptor: { path: "descriptor.json" } } } });
  }
  const tar = makeTar("summarizer", pkg.files);
  const digest = sha256(tar);
  const hexd = digest.slice(7);
  const served = boundDescriptor(pkg.descriptor, keys.agent, HANDLE);
  const servedBytes = Buffer.from(JSON.stringify(served, null, 2));
  const servedHex = sha256(servedBytes).slice(7);
  const pm = keys["package-maker.platform@agentmesh.ai"];
  const dm = keys["deployment-manager.platform@agentmesh.ai"];
  const build = signRecord({ record: "v1", role: "agent-builder", act: "build", package: { name: "summarizer", version: "1.0.0", sha256: hexd }, format_rules: { existing: false, mode: "refuse", since: "2026-10-27", findings: [] }, produced_at: firstReleased, by: pm.key }, "agent-build-record-v1", pm.seed);
  const deploy = signRecord({ record: "v1", role: "deployment-manager", act: "deploy", package: { name: "summarizer", version: "1.0.0", url: "x", sha256: hexd }, agent: { key: keys.agent.key, handle: HANDLE }, descriptor: { sha256: servedHex, signed: true, added: ["subject", "interaction", "acts_for"] }, produced_at: firstReleased, by: dm.key }, "agent-deployment-record-v1", dm.seed);
  const cc = keys["conformance-checker.platform@agentmesh.ai"];
  const verdict = signRecord({ record: "v1", verdict: "pass", subject: { agent_key: keys.agent.key, handle: HANDLE }, package: { sha256: hexd }, produced_at: firstReleased, by: cc.key }, "agent-eval-record-v1", cc.seed);
  const routes = {};
  for (const h of handles) routes[`GET ${DEV}/a/${encodeURIComponent(h)}`] = { body: { agent_id: keys[h].key } };
  routes[`GET ${DEV}/a/${encodeURIComponent(HANDLE)}`] = { body: { agent_id: keys.agent.key, availability: "online", card: { card: { handle: HANDLE } } } };
  routes[`GET ${DEV}/v1/agents/${keys.agent.key}/descriptor`] = { bytes: servedBytes, headers: { "x-descriptor-digest": servedHex } };
  routes[`GET ${DEV}/a/${encodeURIComponent(HANDLE)}/agentdoc.json`] = { body: { agentdoc: "v1", assembled_at: firstReleased, sources: [{ id: "descriptor", kind: "agent-descriptor", digest: servedHex, agent_version: agentdocVersion ?? "1.0.0" }] } };
  routes[`GET ${DEV}/v1/operator/audit/stage-records?agent=${keys.agent.key}&package=summarizer`] = {
    body: { requests: deployed ? [{ id: "dr_1", status: "deployed", package: { name: "summarizer", version: "1.0.0", sha256: hexd }, filed_at: firstReleased, decided_at: firstReleased, build_record: build, deploy_record: deploy }] : [] },
  };
  routes[`GET ${DEV}/v1/deploy-requests/dr_1/package.tar.gz`] = { bytes: tar };
  if (deployed && conformance) routes[`GET ${DEV}/v1/agents/${keys.agent.key}/eval-record`] = { body: verdict };
  if (prodVersion) {
    routes[`GET ${PROD}/a/${encodeURIComponent(HANDLE)}`] = { body: { agent_id: keys.agent.key, ...(prodListedAt ? { card: { listing: { created_at: prodListedAt } } } : {}) } };
    routes[`GET ${PROD}/v1/agents/${keys.agent.key}/descriptor`] = { body: { ...served, agent_version: prodVersion } };
  }
  return { keys, pkg, tar, digest, routes, served };
}

/** The signed deliveries every stage left, for an agent that came through the lifecycle. */
function lifecycleRecords(w) {
  const k = (h) => w.keys[h].seed;
  const scriptDigest = sha256(Buffer.from(w.pkg.files["skills/summarize/scripts/run.mjs"]));
  const descDigest = sha256(Buffer.from(w.pkg.files["agent-descriptor.json"]));
  const names = (extra) => ({ produced_for: `package ${w.digest}`, ...extra });
  return {
    "requirements.manifest.json": signManifest([{ name: "requirements", digest: sha256(Buffer.from("req")) }], k("solution-planner.platform@agentmesh.ai"), names()),
    "architecture.manifest.json": signManifest([{ name: "architecture record", digest: sha256(Buffer.from("arch")) }], k("solution-architect.platform@agentmesh.ai"), names()),
    "design.manifest.json": signManifest([{ name: "agent-descriptor.json", digest: descDigest }], k("spec-writer.platform@agentmesh.ai")),
    "impact.manifest.json": signManifest([{ name: "impact report", digest: sha256(Buffer.from("imp")) }], k("impact-analyst.platform@agentmesh.ai"), names()),
    "test.manifest.json": signManifest([{ name: "suite", digest: sha256(Buffer.from("suite")) }], k("test-writer.platform@agentmesh.ai"), names()),
    "code.manifest.json": signManifest([{ name: "run.mjs", digest: scriptDigest }], k("code-writer.platform@agentmesh.ai")),
    "review.manifest.json": signManifest([{ name: "review", digest: sha256(Buffer.from("rev")) }], k("code-critic.platform@agentmesh.ai"), names()),
    "security.manifest.json": signManifest([{ name: "security statement", digest: sha256(Buffer.from("sec")) }], k("security-reviewer.platform@agentmesh.ai"), names()),
    "run-record.json": { run_record: "v1", standing_assets: [{ schema: "https://schemas.agentmesh.ai/style-guide/v1", version_digest: sha256(Buffer.from("style")), layer: "organization" }] },
    ...usabilityRecords(w),
  };
}

/** A usability report for the package, the manifest it came under, and the App walk's record. */
function usabilityRecords(w, { digest = w.digest, signer = "usability-tester.platform@agentmesh.ai", verdict = "ready", version = "1.0.0", walkDigest = w.digest } = {}) {
  const report = `---
usability_report: v1
agent: ${HANDLE}
version: 1.0.0
package_digest: "${digest}"
verdict: usable
tested_at: "2026-10-31T10:00:00Z"
tested_by: usability-tester 0.1.0
---

# Usability report: Summarizer
`;
  const seed = signer === "agent" ? w.keys.agent.seed : w.keys[signer].seed;
  return {
    "usability-report.md": report,
    "usability.manifest.json": signManifest([{ name: "usability report", digest: sha256(Buffer.from(report)) }], seed),
    "app-walk.json": { app_walk: "v1", agent: HANDLE, version, package_digest: walkDigest, verdict, reason: verdict === "ready" ? "It delivered 1 piece." : "It answered in words but delivered nothing.", job: "J9", walked_at: "2026-10-31T11:00:00Z" },
  };
}

const env = (w, extra = {}) => ({ MESH_API_BASE: DEV, PROD_API_BASE: PROD, AUDIT_TOKEN: "audit-token", LEDGER_TOKEN: "ledger-token", AUDIT_SIGNING_SEED: w.keys.auditor.seed, PACKAGE_MAKER: "/nowhere/build.py", ...extra });

// Since 2026-10-28 the artifacts before the package are optional evidence
// (level info): a hand-made agent with a build record, a deployment record
// and a conformance verdict bound to its digest is not failed for its
// missing pre-package records, and those are shown, never filed.
test("a hand-made agent, new since the checklist's date: its missing pre-package records are info, and each finding is filed once", async () => {
  const w = world();
  const p = fakePlatform(w.routes);
  const j = jobWith(`agent: ${HANDLE}\nversion: 1.0.0\n`);
  const out = await runJob(j.argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  assert.equal(out.code, 0, out.reply);
  assert.equal(out.verdict, "pass_with_findings");
  assert.equal(out.package_digest, w.digest);
  const st = Object.fromEntries(out.stages.map((s) => [s.stage, s.state]));
  for (const s of ["requirements", "architecture", "design", "test", "code", "review", "security"]) assert.equal(st[s], "missing", s);
  assert.equal(st["build-record"], "present");
  assert.equal(st["deployment-record"], "present");
  assert.equal(st.descriptor, "present");
  const text = readFileSync(join(j.job, "out", "audit-report.md"), "utf8");
  for (const h of ["## Stage records", "## Rule checks", "## Findings", "## Not checked"]) assert.ok(text.includes(h), h);
  const fm = frontMatterOf(text);
  assert.equal(fm.verdict, "pass_with_findings");
  assert.equal(fm.package_digest, w.digest);
  assert.equal(fm.signed_by, w.keys.auditor.key);
  assert.ok(verifyReport(text, fm.signed_by, fm.signature), "the report's signature verifies");
  assert.ok(!verifyReport(text.replace("## Findings", "## Findings (edited)"), fm.signed_by, fm.signature), "an edited report does not");
  // Every finding filed, refusals holding back promote, each naming its stage.
  const refusing = p.ledger.filter((x) => x.blocks.includes("promote"));
  assert.equal(refusing.length, 0, `${refusing.length} refusing debts`);
  assert.ok(p.ledger.every((x) => x.kind === "dependency" && x.against === HANDLE && x.owed_to === "platform@agentmesh.ai"));
  assert.ok(!p.ledger.some((x) => /Fixed at the requirements stage/.test(x.what)), "a missing optional record is info, and info is never filed");
  assert.equal(out.checks.find((c) => c.id === "stage-record-requirements").level, "info");
  assert.equal(p.audits.length, 1, "the report is filed where the gates read it");
  // A second audit of the same package files no debt twice.
  const before = p.ledger.length;
  const again = await runJob(jobWith(`agent: ${HANDLE}\nversion: 1.0.0\n`).argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  assert.equal(p.ledger.length, before);
  assert.ok(again.filed.every((f) => f.state === "already filed"));
});

test("an existing hand-made agent: the same findings are warnings until the date for existing agents is set", async () => {
  const w = world({ firstReleased: "2026-10-05T00:00:00Z" });
  const p = fakePlatform(w.routes);
  const out = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  assert.equal(out.verdict, "pass_with_findings");
  assert.ok(out.checks.filter((c) => c.result === "fail" && c.level !== "info").every((c) => c.level === "warn"));
  assert.ok(p.ledger.every((x) => x.blocks.length === 0), "a warning blocks nothing");
});

test("an agent new to dev that prod has listed for months is an existing agent", async () => {
  const w = world({ prodVersion: "0.9.0", prodListedAt: "2026-07-01T00:00:00Z" });
  const out = await runJob(jobWith(`agent: ${HANDLE}
`).argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(out.verdict, "pass_with_findings");
  assert.ok(out.checks.filter((c) => c.result === "fail" && c.level !== "info").every((c) => c.level === "warn"));
});

test("an agent that came through every stage passes its stage records", async () => {
  const w = world();
  const p = fakePlatform(w.routes);
  const j = jobWith(`agent: ${HANDLE}\npackage_digest: ${w.digest}\n`, lifecycleRecords(w));
  const out = await runJob(j.argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  const st = Object.fromEntries(out.stages.map((s) => [s.stage, s.state]));
  for (const s of ["requirements", "architecture", "design", "impact", "test", "code", "review", "security", "build-record", "descriptor", "deployment-record", "conformance", "usability", "docs"]) assert.equal(st[s], "present", `${s}: ${st[s]}`);
  assert.equal(out.checks.find((c) => c.id === "usable-in-app").result, "pass");
  const failed = out.checks.filter((c) => c.result === "fail").map((c) => c.id);
  assert.deepEqual(failed, ["descriptor-person-members"], "only the proposed person members are missing");
  // The checklist is not approved by a person, so the best verdict is a pass with findings.
  assert.equal(out.verdict, "pass_with_findings");
  assert.equal(p.ledger.filter((x) => x.blocks.includes("promote")).length, 0);
});

test("a delivery signed by someone who holds no stage is a stage's record when the message names it for the stage", async () => {
  const w = world();
  const code = signManifest([{ name: "run.mjs", digest: sha256(Buffer.from(w.pkg.files["skills/summarize/scripts/run.mjs"])) }], w.keys.stranger.seed);
  const unnamed = await runJob(jobWith(`agent: ${HANDLE}\n`, { "code.manifest.json": code }).argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(unnamed.stages.find((s) => s.stage === "code").state, "missing", "unnamed, a stranger's delivery belongs to no stage");
  const named = await runJob(jobWith(`agent: ${HANDLE}\ncode: code.manifest.json\n`, { "code.manifest.json": code }).argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(named.stages.find((s) => s.stage === "code").state, "present", "any signer counts when the record is signed and bound");
});

test("a build record signed by a key that is not the package maker's counts, one that does not verify is unsigned, and one for another digest is stale", async () => {
  const w = world();
  const req = w.routes[Object.keys(w.routes).find((k) => k.includes("stage-records"))].body.requests[0];
  req.build_record = signRecord({ ...req.build_record, signatures: undefined }, "agent-build-record-v1", w.keys.stranger.seed);
  const out = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(out.stages.find((s) => s.stage === "build-record").state, "present");
  const wb = world();
  const rb = wb.routes[Object.keys(wb.routes).find((k) => k.includes("stage-records"))].body.requests[0];
  rb.build_record = { ...rb.build_record, produced_at: "2026-01-01T00:00:00Z" };
  const outb = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(wb), { fetchImpl: fakePlatform(wb.routes).fetchImpl, now: NOW });
  assert.equal(outb.stages.find((s) => s.stage === "build-record").state, "unsigned", "a record changed after signing does not verify");
  const w2 = world();
  const r2 = w2.routes[Object.keys(w2.routes).find((k) => k.includes("stage-records"))].body.requests[0];
  r2.build_record = signRecord({ ...r2.build_record, signatures: undefined, package: { ...r2.build_record.package, sha256: "f".repeat(64) } }, "agent-build-record-v1", w2.keys["package-maker.platform@agentmesh.ai"].seed);
  const out2 = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w2), { fetchImpl: fakePlatform(w2.routes).fetchImpl, now: NOW });
  assert.equal(out2.stages.find((s) => s.stage === "build-record").state, "stale");
});

test("an info check is shown in the report, never counted toward the verdict, and never filed", async () => {
  const w = world();
  const p = fakePlatform(w.routes);
  const checklist = "---\nschema: https://schemas.agentmesh.ai/audit-checklist/v1\nname: A small checklist\napproved_by: owner@example.com\napproved_at: 2026-10-28\n---\n\n```yaml\nid: registered\nsays: It is registered.\nwhy: r\nkind: run-time\ncheck: registered\nfixed-by: deploy\nlevel: refuse\napplies: new agents from 2026-10-28; existing agents from not set\nevidence: e\n```\n\n```yaml\nid: stage-record-architecture\nsays: An architecture record is on file.\nwhy: a\nkind: stage-record\ncheck: stage-record:architecture\nfixed-by: architecture\nlevel: info\napplies: new agents from 2026-10-28; existing agents from not set\nevidence: e\n```\n\n```yaml\nid: something-optional\nsays: Something nobody tests yet.\nwhy: w\nkind: design-time\ncheck: nobody-registered-this\nfixed-by: design\nlevel: info\napplies: new agents from 2026-10-28; existing agents from not set\nevidence: e\n```\n";
  const j = jobWith(`agent: ${HANDLE}\nversion: 1.0.0\n`, { "checklist.md": checklist });
  const out = await runJob(j.argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  assert.equal(out.code, 0, out.reply);
  const arch = out.checks.find((c) => c.id === "stage-record-architecture");
  assert.deepEqual([arch.result, arch.level], ["fail", "info"]);
  assert.equal(out.checks.find((c) => c.id === "something-optional").level, "info");
  assert.equal(out.verdict, "pass", "a missing optional record and an unregistered info check change nothing");
  assert.equal(p.ledger.length, 0, "nothing is filed for an info check");
  const text = readFileSync(join(j.job, "out", "audit-report.md"), "utf8");
  assert.match(text, /Info checks, shown as evidence on file and not counted toward the verdict/);
  assert.match(text, /\*\*stage-record-architecture\*\* \(stage-record, `stage-record:architecture`, info\): \*\*not on file\*\*/);
});

test("a check with no registered test is reported as not checked, never skipped", async () => {
  const w = world();
  const p = fakePlatform(w.routes);
  const checklist = "---\nschema: https://schemas.agentmesh.ai/audit-checklist/v1\nname: A small checklist\napproved_by: owner@example.com\napproved_at: 2026-10-28\n---\n\n```yaml\nid: registered\nsays: It is registered.\nwhy: r\nkind: run-time\ncheck: registered\nfixed-by: deploy\nlevel: refuse\napplies: new agents from 2026-10-28; existing agents from not set\nevidence: e\n```\n\n```yaml\nid: something-new\nsays: Something nobody tests yet.\nwhy: w\nkind: design-time\ncheck: nobody-registered-this\nfixed-by: design\nlevel: refuse\napplies: new agents from 2026-10-28; existing agents from not set\nevidence: e\n```\n";
  const j = jobWith(`agent: ${HANDLE}\n`, { "checklist.md": checklist });
  const out = await runJob(j.argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  assert.deepEqual(out.checks.map((c) => [c.id, c.result]), [["registered", "pass"], ["something-new", "not checked"]]);
  assert.equal(out.verdict, "pass_with_findings");
  const text = readFileSync(join(j.job, "out", "audit-report.md"), "utf8");
  assert.match(text, /\*\*something-new\*\* \(`nobody-registered-this`\): no test named nobody-registered-this is registered/);
  assert.equal(out.checklist_digest, sha256(Buffer.from(checklist)));
});

test("an agent with no package on record: audited, failed, and not filed by digest", async () => {
  const w = world({ deployed: false });
  const p = fakePlatform(w.routes);
  const out = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  assert.equal(out.package_digest, null);
  assert.equal(out.report_filed.state, "not filed");
  assert.match(out.reply, /keeps reports by package digest/);
  assert.equal(p.audits.length, 0);
});

test("without the signing key the report is unsigned and not filed, and the reply says why", async () => {
  const w = world();
  const p = fakePlatform(w.routes);
  const out = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w, { AUDIT_SIGNING_SEED: "" }), { fetchImpl: p.fetchImpl, now: NOW });
  assert.equal(out.signed_by, "none");
  assert.equal(p.audits.length, 0);
  assert.match(out.reply, /unsigned/);
});

test("prod running a newer version than the audited one is a finding", async () => {
  const w = world({ prodVersion: "1.1.0" });
  const out = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(out.checks.find((c) => c.id === "present-dev-and-prod").result, "fail");
});

test("asked to approve, it says no and still audits; with no agent named it asks how", async () => {
  const w = world();
  const out = await runJob(jobWith(`agent: ${HANDLE}\nPlease approve it for prod.\n`).argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(out.declined, true);
  assert.match(out.reply, /^I do not approve, deploy or list agents/);
  assert.ok(out.verdict);
  const none = await runJob(jobWith("audit something please").argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(none.code, 3);
  assert.match(none.reply, /agent: <handle>/);
});

test("the same records give the same findings: nothing in the body depends on what the ledger answered first", async () => {
  const w = world();
  const p = fakePlatform(w.routes);
  const a = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  const b = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  assert.equal(canonical(a.checks), canonical(b.checks));
  assert.equal(canonical(a.stages), canonical(b.stages));
});

// ── Agent auditor 0.3.0 (fix pass, 2026-10-28) ─────────────────────────────

const stageReq = (w) => w.routes[Object.keys(w.routes).find((k) => k.includes("stage-records"))].body.requests[0];
const reportOf = (j) => readFileSync(join(j.job, "out", "audit-report.md"), "utf8");

test("a 429 is waited out and asked again, so a busy minute never reads as a missing Descriptor", async () => {
  const w = world();
  const p = fakePlatform(w.routes);
  const busy = new Map();
  const fetchImpl = async (url, init = {}) => {
    if (/\/descriptor$/.test(url) || /stage-records/.test(url)) {
      const n = busy.get(url) ?? 0;
      busy.set(url, n + 1);
      if (n < 2) return { ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ error: "slow down", retry_after_ms: 1000 }), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return p.fetchImpl(url, init);
  };
  const slept = [];
  const j = jobWith(`agent: ${HANDLE}\n`);
  const out = await runJob(j.argv, env(w), { fetchImpl, now: NOW, sleep: async (ms) => { slept.push(ms); } });
  const st = Object.fromEntries(out.stages.map((s) => [s.stage, s.state]));
  assert.equal(st.descriptor, "present");
  assert.equal(st["deployment-record"], "present");
  assert.equal(out.checks.find((c) => c.id === "descriptor-stored-signed").result, "pass");
  assert.ok(slept.length >= 4 && slept.every((ms) => ms === 1500), `waited ${slept.join(", ")}`);
});

test("asking again: Retry-After first, then the body's retry_after_ms, then 2, 4, 8 seconds; the last answer is handed back", async () => {
  const { fetchRetrying, waitFor } = await import("../scripts/retry.mjs");
  const r429 = (headers = {}, body = "") => ({ status: 429, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, text: async () => body });
  assert.equal(await waitFor(r429({ "retry-after": "3" }), 1), 3000);
  assert.equal(await waitFor(r429({}, JSON.stringify({ retry_after_ms: 200 })), 1), 700);
  assert.deepEqual([await waitFor(r429(), 1), await waitFor(r429(), 2), await waitFor(r429(), 3), await waitFor(r429(), 9)], [2000, 4000, 8000, 60000]);
  let calls = 0;
  const slept = [];
  const last = await fetchRetrying("https://x.example/a", {}, { fetchImpl: async () => { calls++; return r429(); }, sleep: async (ms) => { slept.push(ms); }, tries: 4 });
  assert.equal(last.status, 429, "a read that still fails is handed back as failed");
  assert.equal(calls, 4);
  assert.deepEqual(slept, [2000, 4000, 8000]);
  let posts = 0;
  const once = await fetchRetrying("https://x.example/b", { method: "POST" }, { fetchImpl: async () => { posts++; return { status: 503, headers: { get: () => null }, text: async () => "" }; }, codes: new Set([429]) });
  assert.equal(once.status, 503);
  assert.equal(posts, 1, "a write is not asked again after a 503");
});

test("a replaced package's debts are closed when its successor is audited: resolved where it passes, dropped as superseded where it fails", async () => {
  const w = world();
  const p = fakePlatform(w.routes);
  const old = `sha256:${"a".repeat(64)}`;
  const item = (number, mark, state = "open", owed_to = "platform@agentmesh.ai") => ({ number, kind: "dependency", against: HANDLE, owed_to, state, blocks: [], what: `**${HANDLE} 0.9.0: x.**\n\nFixed at the deploy stage.\n\n${mark}` });
  p.ledger.push(
    item(1, `finding: registered on ${old}`),
    item(2, `finding: descriptor-person-members on ${old}`, "acknowledged"),
    item(3, "finding: stage-record-requirements on no package digest"),
    item(4, `finding: registered on ${old}`, "resolved"),
    item(5, `finding: descriptor-person-members on ${w.digest}`),
    item(6, `finding: registered on ${old}`, "open", "someone@else.example"),
    { number: 7, kind: "dependency", against: HANDLE, owed_to: "platform@agentmesh.ai", state: "open", blocks: [], what: "a person's own note" },
  );
  const j = jobWith(`agent: ${HANDLE}\n`);
  const out = await runJob(j.argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  const byNo = (n) => p.ledger.find((x) => x.number === n);
  assert.equal(byNo(1).state, "resolved");
  assert.match(byNo(1).evidence, /was replaced by sha256:[0-9a-f]{64} \(version 1\.0\.0\); its audit on 2026-11-02 passes registered/);
  assert.equal(byNo(2).state, "dropped");
  assert.match(byNo(2).evidence, /^superseded: .* the finding is owed on the new package as #5\.$/, "the new package's item is the one already filed for this digest");
  assert.equal(byNo(3).state, "dropped");
  assert.match(byNo(3).evidence, /no package on record was replaced .* holds no finding for stage-record-requirements \(an info check\)/);
  for (const n of [4, 5, 6, 7]) assert.equal(byNo(n).state, n === 4 ? "resolved" : "open", `#${n} is not touched`);
  assert.deepEqual(out.closed.map((c) => [c.number, c.to, c.state]), [[1, "resolved", "closed"], [2, "dropped", "closed"], [3, "dropped", "closed"]]);
  assert.match(out.reply, /I closed 3 debts a replaced package left: #1 \(registered, resolved\), #2 \(descriptor-person-members, dropped\), #3 \(stage-record-requirements, dropped\)/);
  const filedJson = JSON.parse(readFileSync(join(j.root, "records", "job", "filed.json"), "utf8"));
  assert.equal(filedJson.closed.length, 3);
});

test("auditing a package that is not the one dev serves closes nothing", async () => {
  const w = world();
  w.routes[Object.keys(w.routes).find((k) => k.endsWith("/descriptor"))] = { body: { ...w.served, agent_version: "1.1.0" } };
  const p = fakePlatform(w.routes);
  p.ledger.push({ number: 1, kind: "dependency", against: HANDLE, owed_to: "platform@agentmesh.ai", state: "open", blocks: [], what: `x\n\nfinding: registered on sha256:${"a".repeat(64)}` });
  const out = await runJob(jobWith(`agent: ${HANDLE}\npackage_digest: ${w.digest}\n`).argv, env(w), { fetchImpl: p.fetchImpl, now: NOW });
  assert.deepEqual(out.closed, []);
  assert.equal(p.ledger[0].state, "open");
});

test("a package built before Common Agent 0.30.0-draft: its descriptor.json, which plugin.json points at, is the package's Descriptor", async () => {
  const w = world({ legacy: true });
  const j = jobWith(`agent: ${HANDLE}\n`);
  const out = await runJob(j.argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(out.checks.find((c) => c.id === "descriptor-matches-package").result, "pass");
  const text = reportOf(j);
  assert.match(text, /every other member is the package's descriptor\.json/);
  assert.match(text, /read from the package's descriptor\.json/);
});

test("a deployment record signed later counts: an attest act, and one of a request's later records", async () => {
  const w = world();
  const req = stageReq(w);
  const dm = w.keys["deployment-manager.platform@agentmesh.ai"];
  const attest = signRecord({ record: "v1", role: "deployment-manager", act: "attest", package: { name: "summarizer", version: "1.0.0", sha256: w.digest.slice(7) }, agent: { key: w.keys.agent.key, handle: HANDLE }, produced_at: "2026-10-31T00:00:00Z", by: dm.key }, "agent-deployment-record-v1", dm.seed);
  req.deploy_record = null;
  req.later_records = [attest];
  const j = jobWith(`agent: ${HANDLE}\n`);
  const out = await runJob(j.argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(out.stages.find((s) => s.stage === "deployment-record").state, "present");
  assert.match(reportOf(j), /deploy request dr_1 \(later record\): attest of sha256:/);
  const w2 = world();
  const r2 = stageReq(w2);
  r2.deploy_record = signRecord({ ...r2.deploy_record, signatures: undefined, act: "reconfigure" }, "agent-deployment-record-v1", w2.keys["deployment-manager.platform@agentmesh.ai"].seed);
  const out2 = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w2), { fetchImpl: fakePlatform(w2.routes).fetchImpl, now: NOW });
  assert.equal(out2.stages.find((s) => s.stage === "deployment-record").state, "present");
  const w3 = world();
  const r3 = stageReq(w3);
  r3.deploy_record = signRecord({ ...r3.deploy_record, signatures: undefined, act: "remove" }, "agent-deployment-record-v1", w3.keys["deployment-manager.platform@agentmesh.ai"].seed);
  const out3 = await runJob(jobWith(`agent: ${HANDLE}\n`).argv, env(w3), { fetchImpl: fakePlatform(w3.routes).fetchImpl, now: NOW });
  assert.equal(out3.stages.find((s) => s.stage === "deployment-record").state, "missing", "a removal says nothing runs");
});

test("the conformance line says the verdict, or whether the agent conforms when the record names no verdict", async () => {
  const w = world();
  const cc = w.keys["conformance-checker.platform@agentmesh.ai"];
  w.routes[`GET ${DEV}/v1/agents/${w.keys.agent.key}/eval-record`] = { body: signRecord({ record: "v1", act: "evaluate", subject: { agent_key: w.keys.agent.key, handle: HANDLE }, package: { name: "summarizer", sha256: w.digest.slice(7) }, summary: { pass: 2, fail: 0, inconclusive: 1, flagged_for_review: 1 }, conforms: false, produced_at: "2026-10-31T00:00:00Z", by: cc.key }, "agent-eval-record-v1", cc.seed) };
  const j = jobWith(`agent: ${HANDLE}\n`);
  const out = await runJob(j.argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  assert.equal(out.stages.find((s) => s.stage === "conformance").state, "present");
  assert.match(reportOf(j), /verdict does not conform \(2 pass, 0 fail, 1 inconclusive, 1 flagged for review\), signed by/);
});

test("the Usability stage: a report bound to the package under a tester's signed manifest is present; others are stale or unsigned", async () => {
  const w = world();
  const ask = (attach) => runJob(jobWith(`agent: ${HANDLE}
package_digest: ${w.digest}
`, attach).argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  const line = (out) => out.stages.find((x) => x.stage === "usability").state;
  const check = (out, id) => out.checks.find((c) => c.id === id);
  const none = await ask({});
  assert.equal(line(none), "missing");
  assert.deepEqual([check(none, "usability-report").result, check(none, "usability-report").level], ["fail", "info"]);
  assert.equal(check(none, "usable-in-app").result, "not checked");
  const good = await ask(usabilityRecords(w));
  assert.equal(line(good), "present");
  assert.equal(check(good, "usability-report").result, "pass");
  const stale = await ask(usabilityRecords(w, { digest: `sha256:${"e".repeat(64)}` }));
  assert.equal(line(stale), "stale");
  const own = await ask(usabilityRecords(w, { signer: "agent" }));
  assert.equal(line(own), "unsigned");
  const stranger = await ask(usabilityRecords(w, { signer: "stranger" }));
  assert.equal(line(stranger), "present", "any tester's signed manifest counts");
});

test("usable-in-app: the App walk's verdict for this version; broken refuses a new agent, and a walk of another version is not checked", async () => {
  const w = world();
  const ask = (attach) => runJob(jobWith(`agent: ${HANDLE}
package_digest: ${w.digest}
`, attach).argv, env(w), { fetchImpl: fakePlatform(w.routes).fetchImpl, now: NOW });
  const broken = await ask({ ...lifecycleRecords(w), ...usabilityRecords(w, { verdict: "broken" }) });
  const c = broken.checks.find((x) => x.id === "usable-in-app");
  assert.deepEqual([c.result, c.level], ["fail", "refuse"]);
  assert.equal(broken.verdict, "fail");
  const other = await ask({ ...lifecycleRecords(w), ...usabilityRecords(w, { version: "0.9.0", walkDigest: `sha256:${"f".repeat(64)}` }) });
  assert.equal(other.checks.find((x) => x.id === "usable-in-app").result, "not checked");
});
