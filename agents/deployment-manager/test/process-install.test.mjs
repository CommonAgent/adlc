// The deployment manager's process kind (process-install.mjs), with the
// platform's doors stood in. What is pinned: nothing is asked of the platform
// unless the build record verifies, was signed by the package maker, and names
// the bundle, its document's text and shape and every test case exactly; the
// install and the record calls are signed bodies for the install request the
// message names; the deployment record is an agent-deployment-record-v1 with
// kind "process" naming what the platform filed, drew and bound; the platform's
// refusal comes back in its words; retiring needs no files; and the brain's
// call exits 3 when it is not process work.
//   node --test agents/deployment-manager/test/process-install.test.mjs
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
import { checkSigned, doProcess, readRequest, triggerWords } from "../process-install.mjs";

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
const shape = digests(DOC, checker).shape_sha256;
const caseText = (name) => `TEST: ${name}          for: example/plan-a-page\n                                   digest: ${shape}\nanswer: approve-the-plan = approve\nexpect: goal reached\n`;
const packed = packProcess({ files: [{ name: "plan-a-page.process.txt", text: DOC }, { name: "a.test.txt", text: caseText("approved") }], checker, signer: PM });
const RECORD = `${JSON.stringify(packed.record, null, 2)}\n`;
const files = () => [{ name: "example-plan-a-page-v1.process-bundle.json", text: packed.bundleText }, { name: "example-plan-a-page-v1.build-record.json", text: RECORD }];
const ID = "pi_0123456789abcdef";
const INSTALLED = {
  id: ID, org: "org_1", status: "installed",
  process: { key: "example/plan-a-page", version: "1", text_sha256: packed.record.process.text_sha256, shape_sha256: shape },
  filed: { key: "example/plan-a-page", version: "1", digest: packed.record.process.text_sha256.slice(7), path: "orgs/org_1/plan-a-page.process.txt" },
  solution: { id: "sol_9", name: "plan a page", drawn: true },
  trigger: { kind: "on-request", schedule: null },
  approved: { by: "platform@agentmesh.ai", at: "2026-11-01T15:00:00Z" },
};

/** The platform's doors, stood in: every call is kept, and `answer` says what each returns. */
function platform(answer = (path) => (path.endsWith("/do") ? { status: 200, body: { install: INSTALLED } } : { status: 200, body: { ok: true } })) {
  const calls = [];
  return { calls, call: async (path, body) => { calls.push({ path, body }); return answer(path, body); } };
}
const signedOver = (b, id) => {
  const { sig, ...rest } = b;
  const hash = createHash("sha256").update(canonical(rest), "utf8").digest("hex");
  return edVerify(null, Buffer.from(`process-install-v1:${b.agent}:${b.ts}:${id}:${b.act}:${hash}`), DM.publicKey, Buffer.from(sig, "base64"));
};

test("the message is read: install or retire, the install request, the record and the bundle by content", () => {
  const r = readRequest({ files: files(), words: "install-a-process\ninstall request: pi_0123456789abcdef" });
  assert.equal(r.act, "install");
  assert.equal(r.id, ID);
  assert.equal(r.record.kind, "process");
  assert.equal(r.bundle.format, "process-bundle-v1");
  assert.equal(readRequest({ files: [], words: "retire-a-process\ninstall request: pi_0123456789abcdef" }).act, "retire");
});

test("the gate: a record that verifies, signed by the package maker, naming this bundle exactly", () => {
  const r = readRequest({ files: files(), words: "" });
  const ok = checkSigned({ ...r, verify: verifierOf(PM), packageMakerKeys: [PM.by], checker });
  assert.equal(ok.ok, true, ok.why);
  assert.equal(ok.process.text_sha256, packed.record.process.text_sha256);
  assert.match(checkSigned({ ...r, verify: verifierOf(PM), packageMakerKeys: ["USOMEONEELSE"], checker }).why, /not the package maker's key/);
  assert.match(checkSigned({ ...r, verify: () => false, packageMakerKeys: [PM.by], checker }).why, /does not verify/);
  const otherBundle = packed.bundleText.replace("plan a page", "plan a pagE");
  assert.match(checkSigned({ ...r, bundleText: otherBundle, verify: verifierOf(PM), packageMakerKeys: [PM.by], checker }).why, /the bundle is sha256:/);
  const changedDoc = { ...r.bundle, document: { ...r.bundle.document, text: DOC.replace("one run per page", "one run per address") } };
  const recordFor = { ...r.record, bundle: { ...r.record.bundle, sha256: sha256(packed.bundleText) } };
  assert.match(checkSigned({ ...r, record: recordFor, bundle: changedDoc, verify: () => true, packageMakerKeys: [PM.by], checker }).why, /its signature is not by|document's text/);
  assert.match(checkSigned({ record: null, bundle: r.bundle, verify: () => true, packageMakerKeys: [], checker }).why, /no signed build record/);
});

test("an install asks the platform once, signed, then signs the deployment record and files it", async () => {
  const p = platform();
  const now = new Date("2026-11-01T16:00:00.500Z");
  const got = await doProcess({ files: files(), words: "install-a-process\ninstall request: pi_0123456789abcdef", verify: verifierOf(PM), packageMakerKeys: [PM.by], signer: DM, call: p.call, checker, now: () => now });
  assert.equal(got.ok, true, got.refused);
  assert.deepEqual(p.calls.map((c) => c.path), [`/v1/process-installs/${ID}/do`, `/v1/process-installs/${ID}/record`]);
  const [doCall, recCall] = p.calls;
  assert.equal(doCall.body.act, "install");
  assert.equal(doCall.body.agent, DM.by);
  assert.equal(doCall.body.document, DOC);
  assert.deepEqual(doCall.body.build_record, packed.record);
  assert.ok(signedOver(doCall.body, ID));
  assert.equal(recCall.body.act, "record");
  assert.ok(signedOver(recCall.body, ID));
  const rec = got.record;
  assert.deepEqual(recCall.body.record, rec);
  assert.equal(rec.kind, "process");
  assert.equal(rec.act, "install");
  assert.equal(rec.role, "deployment-manager");
  assert.equal(rec.install_request, ID);
  assert.equal(rec.org, "org_1");
  assert.equal(rec.requested_by, "platform@agentmesh.ai");
  assert.equal(rec.process.id, "example/plan-a-page");
  assert.equal(rec.process.text_sha256, packed.record.process.text_sha256);
  assert.equal(rec.process.shape_sha256, shape);
  assert.equal(rec.build_record_sha256, sha256(RECORD));
  assert.equal(rec.bundle_sha256, sha256(packed.bundleText));
  assert.deepEqual(rec.filed, INSTALLED.filed);
  assert.deepEqual(rec.solution, INSTALLED.solution);
  assert.deepEqual(rec.trigger, INSTALLED.trigger);
  assert.equal(rec.produced_at, "2026-11-01T16:00:00Z");
  assert.deepEqual(verifyRecord(rec, TAGS.deploy, verifierOf(DM)), { ok: true, by: DM.by });
  assert.deepEqual(got.pieces.map((x) => [x.name, x.file, x.media_type]), [
    ["deployment record", "example-plan-a-page-v1.deployment-record.json", MEDIA.deploy],
    ["process bundle", "example-plan-a-page-v1.process-bundle.json", MEDIA.bundle],
  ]);
  assert.equal(got.pieces[1].text, packed.bundleText);
  assert.match(got.answer, /^Installed example\/plan-a-page v1 for the organization: filed as 1 \(sha256:[0-9a-f]{64}\), solution sol_9, run on request\./);
});

test("nothing is asked of the platform without an install request, a key, or a record that passes the gate", async () => {
  for (const [words, signer, keys, re] of [
    ["install-a-process", DM, [PM.by], /names no install request/],
    ["install-a-process\ninstall request: pi_0123456789abcdef", null, [PM.by], /no key to sign/],
    ["install-a-process\ninstall request: pi_0123456789abcdef", DM, ["UOTHER"], /not the package maker's key/],
  ]) {
    const p = platform();
    const got = await doProcess({ files: files(), words, verify: verifierOf(PM), packageMakerKeys: keys, signer, call: p.call, checker });
    assert.equal(got.ok, false);
    assert.match(got.refused, /^The process was not installed: /);
    assert.match(got.refused, re);
    assert.equal(p.calls.length, 0);
  }
});

test("the platform's refusal comes back in its words, and no record is signed", async () => {
  const p = platform(() => ({ status: 409, body: { error: "This install request is not approved." } }));
  const got = await doProcess({ files: files(), words: "install-a-process\ninstall request: pi_0123456789abcdef", verify: verifierOf(PM), packageMakerKeys: [PM.by], signer: DM, call: p.call, checker });
  assert.deepEqual(got, { ok: false, refused: "The process was not installed: This install request is not approved." });
  assert.equal(p.calls.length, 1);
  const down = await doProcess({ files: files(), words: "install-a-process\ninstall request: pi_0123456789abcdef", verify: verifierOf(PM), packageMakerKeys: [PM.by], signer: DM, call: async () => { throw new Error("connect refused"); }, checker });
  assert.match(down.refused, /^The process was not installed: connect refused\.$/);
});

test("a retire needs no files: the platform takes it down and the record says retire", async () => {
  const p = platform((path) => (path.endsWith("/do") ? { status: 200, body: { install: { ...INSTALLED, status: "retired" } } } : { status: 200, body: { ok: true } }));
  const got = await doProcess({ files: [], words: "retire-a-process\ninstall request: pi_0123456789abcdef", verify: verifierOf(PM), packageMakerKeys: [PM.by], signer: DM, call: p.call, checker });
  assert.equal(got.ok, true, got.refused);
  assert.equal(p.calls[0].body.act, "retire");
  assert.equal("document" in p.calls[0].body, false);
  assert.equal(got.record.act, "retire");
  assert.equal(got.record.status, "retired");
  assert.equal(got.record.process.id, "example/plan-a-page");
  assert.equal(got.pieces.length, 1);
  assert.match(got.answer, /^Retired example\/plan-a-page v1:/);
});

test("a trigger is said in words", () => {
  assert.equal(triggerWords({ kind: "on-request", schedule: null }), "run on request");
  assert.equal(triggerWords({ kind: "schedule", schedule: { name: "mornings", next_at: "2026-11-02T14:00:00Z" } }), "scheduled as mornings, next run 2026-11-02T14:00:00Z");
});

test("the brain's call exits 3 when the message is not process work", () => {
  const dir = mkdtempSync(join(tmpdir(), "process-install-"));
  try {
    const prompt = join(dir, "p.txt");
    writeFileSync(prompt, "You are deploymgr.\n\n=== agentmesh message from someone ===\n--- BEGIN SENDER MESSAGE ---\nwhat is deployed?\n--- END SENDER MESSAGE ---\n");
    const r = spawnSync("node", [join(HERE, "..", "process-install.mjs"), "--run", prompt, join(dir, "identity.json")], { encoding: "utf8" });
    assert.equal(r.status, 3, r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
