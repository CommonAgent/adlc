// The conformance checker's process kind (process-verdict.mjs), with the
// platform's suite door and the registry stood in. What is pinned: the
// deployment record must verify and be the deployment manager's, and the
// bundle must be the one it names; the verdict combines the §17.1 check of the
// installed document with every bundled test case's test run, by name;
// conforms only when the check passes and every case passed at the installed
// digest; a failed case or a failing document is does-not-conform; a missing
// or unfinished run, or a platform that could not be asked, is inconclusive
// and never rounded up; the record is an agent-eval-record-v1 with kind
// "process" whose subject key is process.<team>.<slug>, and it is filed.
//   node --test agents/conformance-checker/test/process-verdict.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign, verify as edVerify, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { canonical, digests, loadChecker, sha256, verifyRecord, TAGS, MEDIA } from "../../package-maker/shared/process-records.mjs";
import { packProcess } from "../../package-maker/process-pack.mjs";
import { deploymentRecord } from "../../deployment-manager/process-install.mjs";
import { checkProcessInstall, judge, subjectKey } from "../process-verdict.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = readFileSync(join(HERE, "..", "..", "package-maker", "fixtures", "process", "plan-a-page.process.txt"), "utf8");
const checker = await loadChecker();

function keyPair(by) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { by, sign: (text) => edSign(null, Buffer.from(text, "utf8"), privateKey).toString("base64"), publicKey };
}
const verifierOf = (...pairs) => (key, text, sig) => {
  const p = pairs.find((x) => x.by === key);
  return !!p && edVerify(null, Buffer.from(text, "utf8"), p.publicKey, Buffer.from(sig, "base64"));
};
const PM = keyPair("UTESTPACKAGEMAKER");
const DM = keyPair("UTESTDEPLOYMGR");
const CC = keyPair("UTESTEVALUATOR");
const shape = digests(DOC, checker).shape_sha256;
const caseText = (name) => `TEST: ${name}          for: example/plan-a-page\n                                   digest: ${shape}\nanswer: approve-the-plan = approve\nexpect: goal reached\n`;
const packed = packProcess({ files: [{ name: "plan-a-page.process.txt", text: DOC }, { name: "a.test.txt", text: caseText("approved") }, { name: "b.test.txt", text: caseText("turned-down") }], checker, signer: PM });
const ID = "pi_0123456789abcdef";
const INSTALL = {
  id: ID, org: "org_1", status: "installed",
  process: { key: "example/plan-a-page", version: "1", text_sha256: packed.record.process.text_sha256, shape_sha256: shape },
  filed: { key: "example/plan-a-page", version: "1", digest: "x" }, solution: { id: "sol_9", name: "plan a page", drawn: true },
  trigger: { kind: "on-request", schedule: null }, approved: { by: "platform@agentmesh.ai", at: "2026-11-01T15:00:00Z" },
};
const DEPLOY = deploymentRecord({ act: "install", id: ID, install: INSTALL, recordText: JSON.stringify(packed.record), bundleText: packed.bundleText, process: { ...packed.record.process }, signer: DM });
const DEPLOY_TEXT = `${JSON.stringify(DEPLOY, null, 2)}\n`;
const files = () => [{ name: "d.deployment-record.json", text: DEPLOY_TEXT }, { name: "b.process-bundle.json", text: packed.bundleText }];
const pass = (name, run) => ({ test_case: `tc_${name}`, name, run, state: "closed", result: "pass", failures: [] });

function platform({ install = INSTALL, results = [pass("approved", "run_1"), pass("turned-down", "run_2")], status = 200 } = {}) {
  const calls = [];
  return { calls, call: async (path, body) => { calls.push({ path, body }); return status === 200 ? { status, body: { install, suite: { solution: "sol_9", results } } } : { status, body: { error: "No such install." } }; } };
}
const run = (p, extra = {}) => checkProcessInstall({ files: files(), verify: verifierOf(DM), deploymentManagerKeys: [DM.by], signer: CC, call: p.call, checker, now: () => new Date("2026-11-01T17:00:00.250Z"), ...extra });

test("the registry keys a process's verdict by its id", () => {
  assert.equal(subjectKey("example/plan-a-page"), "process.example.plan-a-page");
});

test("a process that passes the check and whose every case passed conforms, and the verdict is signed and filed", async () => {
  const p = platform();
  const filed = [];
  const got = await run(p, { submit: (rec) => { filed.push(rec); return { ok: true }; } });
  assert.equal(got.ok, true, got.refused);
  assert.deepEqual(p.calls.map((c) => c.path), [`/v1/process-installs/${ID}/suite`]);
  const b = p.calls[0].body;
  assert.equal(b.act, "suite");
  assert.equal(b.agent, CC.by);
  const { sig, ...rest } = b;
  const hash = createHash("sha256").update(canonical(rest), "utf8").digest("hex");
  assert.ok(edVerify(null, Buffer.from(`process-install-v1:${CC.by}:${b.ts}:${ID}:suite:${hash}`), CC.publicKey, Buffer.from(sig, "base64")));
  const r = got.record;
  assert.equal(r.kind, "process");
  assert.equal(r.act, "evaluate");
  assert.equal(r.role, "conformance-checker");
  assert.equal(r.subject.agent_key, "process.example.plan-a-page");
  assert.deepEqual(r.subject.process, { id: "example/plan-a-page", version: "1", shape_sha256: shape, text_sha256: packed.record.process.text_sha256 });
  assert.equal(r.subject.install_request, ID);
  assert.equal(r.deployment_record_sha256, sha256(DEPLOY_TEXT));
  assert.equal(r.checks[0].kind, "process-check");
  assert.equal(r.checks[0].conforms, true);
  assert.deepEqual(r.cases.map((c) => [c.id, c.verdict, c.run]), [["approved", "pass", "run_1"], ["turned-down", "pass", "run_2"]]);
  assert.deepEqual(r.summary, { pass: 2, fail: 0, inconclusive: 0 });
  assert.equal(r.verdict, "conforms");
  assert.equal(r.conforms, true);
  assert.equal(r.install.at_digest, true);
  assert.equal(r.produced_at, "2026-11-01T17:00:00Z");
  assert.deepEqual(verifyRecord(r, TAGS.evaluate, verifierOf(CC)), { ok: true, by: CC.by });
  assert.deepEqual(filed, [r]);
  assert.deepEqual(got.pieces.map((x) => [x.name, x.file, x.media_type]), [["the signed verdict", "example-plan-a-page-v1.eval-record.json", MEDIA.verdict]]);
  assert.match(got.answer, /^The conformance checker's verdict on example\/plan-a-page v1: conforms \(2 passed, 0 failed, 0 not judged; §17\.1 conforms\)\. The signed verdict is filed with the registry/);
});

test("a failed case is does-not-conform; a missing or unfinished run is inconclusive, never a pass", async () => {
  const failed = await run(platform({ results: [pass("approved", "run_1"), { test_case: "tc_2", name: "turned-down", run: "run_2", result: "fail", failures: ["the run reached its goal"] }] }));
  assert.equal(failed.record.verdict, "does-not-conform");
  assert.match(failed.record.cases[1].observed, /failed: the run reached its goal/);
  const missing = await run(platform({ results: [pass("approved", "run_1")] }));
  assert.equal(missing.record.verdict, "inconclusive");
  assert.equal(missing.record.cases[1].observed, "the suite has no test run for this case");
  const pending = await run(platform({ results: [pass("approved", "run_1"), { name: "turned-down", run: "run_2", result: "pending" }] }));
  assert.equal(pending.record.verdict, "inconclusive");
  const down = await run(platform({ status: 404 }));
  assert.equal(down.record.verdict, "inconclusive");
  assert.match(down.record.cases[0].observed, /not judged: No such install/);
  assert.equal(down.record.install.at_digest, null);
});

test("an install no longer at the record's digest, or retired, does not conform", async () => {
  const moved = await run(platform({ install: { ...INSTALL, process: { ...INSTALL.process, text_sha256: "sha256:" + "1".repeat(64) } } }));
  assert.equal(moved.record.verdict, "does-not-conform");
  const retired = await run(platform({ install: { ...INSTALL, status: "retired" } }));
  assert.equal(retired.record.verdict, "does-not-conform");
});

test("the judgement itself: a document that fails the check does not conform whatever the suite says", () => {
  const ok = { conforms: true, clean: true };
  assert.equal(judge({ check: ok, atDigest: true, cases: ["a"], results: [{ name: "a", result: "pass" }] }).verdict, "conforms");
  assert.equal(judge({ check: { conforms: false, clean: true }, atDigest: true, cases: ["a"], results: [{ name: "a", result: "pass" }] }).verdict, "does-not-conform");
  assert.equal(judge({ check: { conforms: true, clean: false }, atDigest: true, cases: ["a"], results: [{ name: "a", result: "pass" }] }).verdict, "does-not-conform");
  assert.equal(judge({ check: ok, atDigest: null, cases: ["a"], results: null, unreachable: "down" }).verdict, "inconclusive");
});

test("a deployment record that does not verify, is not the deployment manager's, or names another bundle is refused", async () => {
  const p = platform();
  assert.match((await run(p, { verify: () => false })).refused, /^The process was not checked: the deployment record does not verify/);
  assert.match((await run(p, { deploymentManagerKeys: ["UOTHER"] })).refused, /not the deployment manager's key/);
  const other = packed.bundleText.replace('"plan a page"', '"plan a pagE"');
  assert.match((await checkProcessInstall({ files: [files()[0], { name: "b.json", text: other }], verify: verifierOf(DM), deploymentManagerKeys: [DM.by], signer: CC, call: p.call, checker })).refused, /the bundle is not the one/);
  assert.match((await checkProcessInstall({ files: [files()[1]], verify: verifierOf(DM), deploymentManagerKeys: [DM.by], signer: CC, call: p.call, checker })).refused, /no signed deployment record/);
  assert.equal(p.calls.length, 0);
});

test("a verdict the registry did not take is still delivered, and says so", async () => {
  const got = await run(platform(), { submit: () => ({ ok: false, why: "no mesh credential to file it with on this host" }) });
  assert.equal(got.ok, true);
  assert.match(got.answer, /the registry did not take it \(no mesh credential/);
});

test("the brain's call exits 3 when no process deployment record is attached", () => {
  const dir = mkdtempSync(join(tmpdir(), "process-verdict-"));
  try {
    const prompt = join(dir, "p.txt");
    writeFileSync(prompt, "You are agentevaluator.\n\n=== agentmesh message from someone ===\n--- BEGIN SENDER MESSAGE ---\nevaluate site-reader\n--- END SENDER MESSAGE ---\n");
    const r = spawnSync("node", [join(HERE, "..", "process-verdict.mjs"), "--run", prompt, join(dir, "identity.json")], { encoding: "utf8" });
    assert.equal(r.status, 3, r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
