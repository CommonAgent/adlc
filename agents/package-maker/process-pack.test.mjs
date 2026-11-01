// The package maker's process kind (process-pack.mjs) and what the three
// process kinds share (shared/process-records.mjs). What is pinned: the two
// digests (the text's, and §21.1's shape, which leaves the bindings: block
// out); the process check must pass; every test case is for this process and
// pinned to its shape; the bundle carries the document and the cases at the
// digests the record names; the record is an agent-build-record-v1 with
// kind "process", signed over the family's text, naming who held each stage
// and the suite's results when they came; and the brain's call exits 3 when no
// process document is attached.
//   node --test agents/package-maker/process-pack.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign, verify as edVerify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  canonical, digests, documentText, headerOf, loadChecker, promptFiles, readCase, sha256, shapeOf, signRecord,
  signedText, verifyRecord, bareName, signedBody, TAGS, MEDIA,
} from "./shared/process-records.mjs";
import { packProcess, stagesOf, suiteOf } from "./process-pack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = readFileSync(join(HERE, "fixtures", "process", "plan-a-page.process.txt"), "utf8");
const checker = await loadChecker();

/** A key pair standing in for an agent's identity: `by` is its name. */
export function keyPair(by = "UTESTPACKAGEMAKER") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { by, sign: (text) => edSign(null, Buffer.from(text, "utf8"), privateKey).toString("base64"), publicKey };
}
const verifierOf = (...pairs) => (key, text, sig) => {
  const p = pairs.find((x) => x.by === key);
  return !!p && edVerify(null, Buffer.from(text, "utf8"), p.publicKey, Buffer.from(sig, "base64"));
};

/** A §21 test case for the fixture, pinned to `digest`. */
export function caseText(name, digest, { id = "example/plan-a-page", answer = "approve" } = {}) {
  return `TEST: ${name}          for: ${id}\n                                   digest: ${digest}\ncarried: url = https-free example page\nanswer: approve-the-plan = ${answer}\nexpect: goal reached\n`;
}

const shape = digests(DOC, checker).shape_sha256;
const files = (extra = []) => [
  { name: "plan-a-page.process.txt", text: DOC },
  { name: "approved.test.txt", text: caseText("approved", shape) },
  { name: "changed-then-approved.test.txt", text: caseText("changed-then-approved", shape, { answer: "changes: name the claim" }) },
  ...extra,
];

test("the text digest is the checker's, and the shape leaves the bindings: block out", () => {
  const d = digests(DOC, checker);
  assert.equal(d.text_sha256, checker.digestOf(checker.documentText(DOC)));
  assert.match(d.shape_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(d.shape_sha256, d.text_sha256);
  const s = shapeOf(DOC);
  assert.doesNotMatch(s, /^bindings:/m);
  assert.doesNotMatch(s, /roster: site-reader/);
  assert.match(s, /^policy:/m);
  assert.match(s, /^deviations:/m);
  // Who holds a role is not the shape; a phase's level is.
  assert.equal(digests(DOC.replace("roster: site-reader and", "roster: site-reader.acme@example.com and"), checker).shape_sha256, d.shape_sha256);
  assert.notEqual(digests(DOC.replace("after: plan-the-lenses    automation: never", "after: plan-the-lenses    automation: supervised"), checker).shape_sha256, d.shape_sha256);
  // Line endings do not change either digest.
  assert.deepEqual(digests(DOC.replace(/\n/g, "\r\n"), checker), d);
  // A checker that has its own shape digest is the one used.
  assert.equal(digests(DOC, { shapeDigestOf: () => "sha256:" + "0".repeat(64) }).shape_sha256, "sha256:" + "0".repeat(64));
});

test("a document's header, a test case's header and an attachment's sent name are read", () => {
  assert.deepEqual(headerOf(DOC), { id: "example/plan-a-page", version: "1", name: "plan a page", owner: "owner@example.com", team: "example", slug: "plan-a-page" });
  assert.deepEqual(readCase(caseText("approved", shape)), { name: "approved", for: "example/plan-a-page", digest: shape });
  assert.equal(readCase("not a test case"), null);
  assert.equal(bareName("3-ab12cd34-approved.test.txt"), "approved.test.txt");
  assert.equal(bareName("ab12cd34-ef56ab78-plan.process.txt"), "plan.process.txt");
  assert.equal(bareName("made-first-time.test.txt"), "made-first-time.test.txt");
  assert.equal(documentText("# A page\n\n```\nPROCESS: x    id: a/b v1\n```\n"), "PROCESS: x    id: a/b v1\n");
});

test("a record is signed over the tag and its canonical text, and anything changed fails to verify", () => {
  const pm = keyPair();
  const rec = signRecord({ record: "v1", kind: "process", b: 2, a: { z: 1, y: [true, null, "é"] } }, TAGS.build, pm);
  assert.equal(rec.by, pm.by);
  assert.equal(rec.signatures[0].tag, TAGS.build);
  assert.equal(rec.signatures[0].alg, "ed25519");
  assert.equal(signedText(rec, TAGS.build), `${TAGS.build}\n{"a":{"y":[true,null,"é"],"z":1},"b":2,"by":"${pm.by}","kind":"process","record":"v1"}`);
  assert.equal(canonical({ b: 1, a: undefined, c: [1, "x"] }), '{"b":1,"c":[1,"x"]}');
  assert.deepEqual(verifyRecord(rec, TAGS.build, verifierOf(pm)), { ok: true, by: pm.by });
  assert.equal(verifyRecord({ ...rec, b: 3 }, TAGS.build, verifierOf(pm)).ok, false);
  assert.equal(verifyRecord(rec, TAGS.deploy, verifierOf(pm)).ok, false);
  assert.equal(verifyRecord({ ...rec, by: "USOMEBODYELSE" }, TAGS.build, verifierOf(pm)).ok, false);
  const unsigned = signRecord({ a: 1 }, TAGS.build, null);
  assert.deepEqual(unsigned.signatures, []);
  assert.match(unsigned._unsigned, /unsigned/);
});

test("a door's body is signed over the tag, the agent, the time, the install, the act and the body's digest", () => {
  const dm = keyPair("UTESTDEPLOYMGR");
  const now = new Date("2026-11-01T15:00:00Z");
  const b = signedBody({ document: "PROCESS: x" }, { id: "pi_0123456789ab", act: "install", signer: dm, now });
  assert.equal(b.agent, dm.by);
  assert.equal(b.ts, "2026-11-01T15:00:00.000Z");
  assert.equal(b.act, "install");
  const { sig, ...rest } = b;
  const hash = sha256(canonical(rest)).slice("sha256:".length);
  assert.ok(edVerify(null, Buffer.from(`process-install-v1:${dm.by}:${b.ts}:pi_0123456789ab:install:${hash}`), dm.publicKey, Buffer.from(sig, "base64")));
});

test("the framed prompt gives the job folder and the attached files", () => {
  const p = "You are x.\n\njob folder: /opt/fleet/node-ops/agents/agentbuilder/jobs/01ab  (put every delivered piece under …)\n\nattached:  2 files, already downloaded to this machine:\n           /opt/x/a.process.txt  (text/plain)\n           /opt/x/b.test.txt  NOT downloaded: too big\n\n=== agentmesh message from someone ===\n";
  assert.deepEqual(promptFiles(p), { jobDir: "/opt/fleet/node-ops/agents/agentbuilder/jobs/01ab", files: ["/opt/x/a.process.txt"] });
});

test("a document that passes and its cases make a bundle and a signed build record naming both digests", () => {
  const pm = keyPair();
  const suite = { name: "results.json", text: JSON.stringify({ solution: "sol_1", results: [{ test_case: "tc_1", name: "approved", result: "pass" }, { test_case: "tc_2", name: "changed-then-approved", result: "pass" }] }) };
  const holders = { name: "holders.json", text: JSON.stringify({ stages: [{ stage: "write-the-process", holder: "spec-writer.platform@agentmesh.ai", kind: "agent" }, { stage: "approve-the-process", holder: "platform@agentmesh.ai", kind: "person" }] }) };
  const got = packProcess({ files: files([suite, holders]), words: "pack-a-process\nrequested by: the platform's proof", checker, signer: pm, now: new Date("2026-11-01T15:00:00.123Z") });
  assert.equal(got.ok, true, got.refused);
  const d = digests(DOC, checker);
  assert.equal(got.bundle.format, "process-bundle-v1");
  assert.equal(got.bundle.document.text, DOC);
  assert.equal(got.bundle.document.text_sha256, d.text_sha256);
  assert.equal(got.bundle.document.shape_sha256, d.shape_sha256);
  assert.deepEqual(got.bundle.test_cases.map((c) => c.name), ["approved", "changed-then-approved"]);
  assert.deepEqual(got.names, { bundle: "example-plan-a-page-v1.process-bundle.json", record: "example-plan-a-page-v1.build-record.json" });
  const r = got.record;
  assert.equal(r.kind, "process");
  assert.equal(r.act, "build");
  assert.equal(r.role, "package-maker");
  assert.equal(r.requested_by, "the platform's proof");
  assert.equal(r.process.id, "example/plan-a-page");
  assert.equal(r.process.version, "1");
  assert.equal(r.process.text_sha256, d.text_sha256);
  assert.equal(r.process.shape_sha256, d.shape_sha256);
  assert.equal(r.bundle.sha256, sha256(got.bundleText));
  assert.equal(r.test_cases.count, 2);
  assert.equal(r.test_cases.pinned_to, d.shape_sha256);
  assert.equal(r.test_cases.cases[0].sha256, sha256(got.bundle.test_cases[0].text));
  assert.deepEqual(r.suite, { solution: "sol_1", pass: 2, fail: 0, pending: 0, not_started: 0, sha256: sha256(suite.text) });
  assert.deepEqual(r.stages, [{ stage: "write-the-process", holder: "spec-writer.platform@agentmesh.ai", kind: "agent" }, { stage: "approve-the-process", holder: "platform@agentmesh.ai", kind: "person" }]);
  assert.equal(r.checks[0].kind, "process-check");
  assert.equal(r.produced_at, "2026-11-01T15:00:00Z");
  assert.deepEqual(verifyRecord(r, TAGS.build, verifierOf(pm)), { ok: true, by: pm.by });
  assert.match(got.answer, /^Signed example\/plan-a-page v1: shape sha256:[0-9a-f]{64}, text sha256:[0-9a-f]{64}, 2 test cases\./);
});

test("who held each stage is read from held: lines too, and nobody said is an empty list", () => {
  assert.deepEqual(stagesOf([], "held: write-the-process by spec-writer.platform@agentmesh.ai\nheld: approve-the-process by person platform@agentmesh.ai"),
    [{ stage: "write-the-process", holder: "spec-writer.platform@agentmesh.ai", kind: "agent" }, { stage: "approve-the-process", holder: "platform@agentmesh.ai", kind: "person" }]);
  assert.deepEqual(stagesOf([], ""), []);
  assert.equal(suiteOf([{ name: "x.json", text: "{}" }]), null);
  const got = packProcess({ files: files(), checker, signer: keyPair() });
  assert.deepEqual(got.record.stages, []);
  assert.equal("suite" in got.record, false);
});

test("a document the process check does not pass is refused, naming what failed", () => {
  const bad = DOC.replace(/^measures:[\s\S]*$/m, "measures:\n  cycle time: from the address to the plan\n");
  const got = packProcess({ files: [{ name: "p.process.txt", text: bad }, ...files().slice(1)], checker, signer: keyPair() });
  assert.equal(got.ok, false);
  assert.match(got.refused, /^The process was not signed: the process check did not pass .*§12\.2/);
  const finding = DOC.replace("concurrency:", "colour: blue\nconcurrency:");
  const got2 = packProcess({ files: [{ name: "p.process.txt", text: finding }], checker, signer: keyPair() });
  assert.match(got2.refused, /undefined-line/);
});

test("a test case for another process, pinned to the text or to nothing, or named twice, is refused", () => {
  const d = digests(DOC, checker);
  const other = packProcess({ files: [files()[0], { name: "x.test.txt", text: caseText("x", d.shape_sha256, { id: "example/another" }) }], checker, signer: keyPair() });
  assert.match(other.refused, /the test case x is for example\/another, not example\/plan-a-page/);
  const text = packProcess({ files: [files()[0], { name: "x.test.txt", text: caseText("x", d.text_sha256) }], checker, signer: keyPair() });
  assert.match(text.refused, /pinned to sha256:[0-9a-f]{64}, and example\/plan-a-page v1's shape is/);
  const twice = packProcess({ files: [...files(), { name: "again.test.txt", text: caseText("approved", d.shape_sha256) }], checker, signer: keyPair() });
  assert.match(twice.refused, /two test cases are called approved/);
  const none = packProcess({ files: [files()[0]], checker, signer: keyPair() });
  assert.match(none.refused, /no test case came/);
});

test("with several documents the message names which one is signed; the others are inner documents", () => {
  const inner = DOC.replace("id: example/plan-a-page v1", "id: example/inner-one v1");
  const two = [...files(), { name: "inner.process.txt", text: inner }];
  assert.match(packProcess({ files: two, checker, signer: keyPair() }).refused, /2 process documents came and nothing said which one/);
  assert.equal(packProcess({ files: two, words: "process: plan-a-page.process.txt", checker, signer: keyPair() }).ok, true);
  assert.match(packProcess({ files: [{ name: "x.txt", text: "hello" }], checker }).refused, /no process document came/);
});

test("the brain's call exits 3 with no process document, and otherwise writes the pieces and answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "process-pack-"));
  try {
    const at = (n, t) => { writeFileSync(join(dir, n), t); return join(dir, n); };
    const job = join(dir, "job");
    const prompt = (paths) => `You are agentbuilder.\n\njob folder: ${job}  (put every delivered piece under ${job}/out/ …)\n\nattached:  ${paths.length} files, already downloaded to this machine:\n${paths.map((p) => `           ${p}  (text/plain)`).join("\n")}\n\n=== agentmesh message from someone ===\n--- BEGIN SENDER MESSAGE ---\npack-a-process\n--- END SENDER MESSAGE ---\n`;
    const none = at("p1.txt", prompt([at("spec.json", "{}")]));
    const r1 = spawnSync("node", [join(HERE, "process-pack.mjs"), "--run", none, join(dir, "no-identity.json")], { encoding: "utf8" });
    assert.equal(r1.status, 3);
    const paths = files().map((f) => at(f.name, f.text));
    const yes = at("p2.txt", prompt(paths));
    const r2 = spawnSync("node", [join(HERE, "process-pack.mjs"), "--run", yes, join(dir, "no-identity.json")], { encoding: "utf8" });
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /^Signed example\/plan-a-page v1/);
    assert.match(r2.stdout, /not signed: the signer was not available/);
    const pieces = JSON.parse(readFileSync(join(job, "pieces.json"), "utf8"));
    assert.deepEqual(pieces.map((p) => [p.name, p.path, p.media_type]), [
      ["process bundle", "out/example-plan-a-page-v1.process-bundle.json", MEDIA.bundle],
      ["build record", "out/example-plan-a-page-v1.build-record.json", MEDIA.build],
    ]);
    assert.ok(existsSync(join(job, "out", "example-plan-a-page-v1.build-record.json")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
