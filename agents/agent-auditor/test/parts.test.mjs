// The auditor's parts, each on its own: the keys and signatures, the
// checklist and its levels, the pinned standards, the package reader, and
// the copies of other agents' rules it runs (the test writer's
// delivered-formats check and AgentMesh's rule against model names), held
// to their sources so they cannot drift apart unseen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, idFromSeed, newSeed, sha256, signReport, verifyDoc, verifyManifest, verifyReport } from "../scripts/keys.mjs";
import { appliesDates, levelFor, readChecklist } from "../scripts/checklist.mjs";
import { readPackage } from "../scripts/tar.mjs";
import { fromText, readFiles } from "../scripts/read-request.mjs";
import { REGISTERED, floorProblems } from "../scripts/checks.mjs";
import { findingsIn, modelIn } from "../scripts/models.mjs";
import * as formats from "../scripts/formats.mjs";
import { ownerOf, owedItems } from "../scripts/ledger.mjs";
import { versionOrder, pickTarget } from "../scripts/gather.mjs";
import { findPackageMaker, runPackageMaker } from "../scripts/package-maker.mjs";
import { makeTar, signManifest, agentFiles } from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

test("a real Descriptor from dev verifies under its subject's key, and a changed one does not", () => {
  const d = JSON.parse(readFileSync(join(HERE, "fixtures", "quiz-maker-0.6.0.dev.descriptor.json"), "utf8"));
  const sigs = verifyDoc(d);
  assert.deepEqual(sigs.map((s) => [s.tag, s.by === d.subject.id, s.verifies]), [["descriptor-statement-v1", true, true]]);
  assert.equal(verifyDoc({ ...d, does: "something else" })[0].verifies, false);
  assert.deepEqual(floorProblems(d), []);
});

test("a seed signs a report that verifies under its key, and not once edited", () => {
  const seed = newSeed();
  const key = idFromSeed(seed);
  assert.match(key, /^U[A-Z2-7]{55}$/);
  const text = `---\naudit_report: v1\nsigned_by: ${key}\nsignature: PENDING\n---\n\n# Audit\n`;
  const sig = signReport(text, seed);
  const signed = text.replace("PENDING", sig);
  assert.ok(verifyReport(signed, key, sig));
  assert.ok(!verifyReport(signed.replace("# Audit", "# Audit!"), key, sig));
});

test("a delivery manifest verifies the adapter's way, and not under another agent's name", () => {
  const seed = newSeed();
  const m = signManifest([{ name: "a", digest: sha256(Buffer.from("a")) }], seed);
  assert.ok(verifyManifest(m));
  assert.ok(!verifyManifest({ ...m, agent: idFromSeed(newSeed()) }));
  assert.ok(!verifyManifest({ ...m, pieces: [] }));
});

test("the checklist this package pins is the one in standards/, and reads as 30 checks", () => {
  const pins = JSON.parse(readFileSync(join(HERE, "..", "standards-pins.json"), "utf8")).pins;
  for (const [file, pin] of Object.entries(pins)) {
    const at = join(REPO, "standards", file);
    assert.ok(existsSync(at), `${file} is in standards/`);
    assert.equal(sha256(readFileSync(at)), pin, `standards/${file} no longer matches its pin: re-pin on purpose, run the tests, release`);
  }
  const c = readChecklist(readFileSync(join(REPO, "standards", "audit-checklist.md")));
  assert.equal(c.digest, pins["audit-checklist.md"]);
  assert.deepEqual(c.problems, []);
  assert.equal(c.checks.length, 30);
  assert.equal(c.schema, "https://schemas.agentmesh.ai/audit-checklist/v1");
  assert.equal(c.approved_by, null);
  const unregistered = c.checks.filter((x) => !REGISTERED[x.check]).map((x) => `${x.id} (${x.check})`);
  assert.deepEqual(unregistered, [], "every check in the pinned checklist has a registered test");
});

test("a finding's level: the check's for a new agent, a warning for an existing one until its date", () => {
  const check = { level: "refuse", applies: "new agents from 2026-10-28; existing agents from not set" };
  assert.deepEqual(appliesDates(check.applies), { every: false, newFrom: "2026-10-28", existingFrom: null });
  const now = new Date("2026-11-02T00:00:00Z");
  assert.equal(levelFor(check, { firstReleased: "2026-10-29T00:00:00Z", now }).level, "refuse");
  assert.equal(levelFor(check, { firstReleased: "2026-10-05T00:00:00Z", now }).level, "warn");
  assert.equal(levelFor(check, { firstReleased: null, now }).level, "warn");
  const set = { level: "refuse", applies: "new agents from 2026-10-28; existing agents from 2026-11-01" };
  assert.equal(levelFor(set, { firstReleased: "2026-10-05T00:00:00Z", now }).level, "refuse");
  assert.equal(levelFor({ level: "warn", applies: check.applies }, { firstReleased: "2026-10-29T00:00:00Z", now }).level, "warn");
  // An info check stays info whatever the dates: shown, never counted.
  assert.equal(levelFor({ level: "info", applies: set.applies }, { firstReleased: "2026-10-29T00:00:00Z", now }).level, "info");
  assert.equal(levelFor({ level: "info", applies: set.applies }, { firstReleased: "2026-10-05T00:00:00Z", now }).level, "info");
});

test("a check that applies to every agent refuses an existing agent as it refuses a new one", () => {
  const every = { level: "refuse", applies: "every agent" };
  assert.deepEqual(appliesDates(every.applies), { every: true, newFrom: null, existingFrom: null });
  const now = new Date("2026-11-02T00:00:00Z");
  for (const firstReleased of ["2026-10-29T00:00:00Z", "2026-09-01T00:00:00Z", null]) {
    assert.equal(levelFor(every, { firstReleased, now }).level, "refuse");
  }
  assert.equal(levelFor({ level: "warn", applies: "every agent" }, { firstReleased: null, now }).level, "warn");
  assert.equal(levelFor({ level: "info", applies: "every agent" }, { firstReleased: null, now }).level, "info");
});

test("the pinned checklist holds every agent alike: no check gives an existing agent a later date", () => {
  const c = readChecklist(readFileSync(join(HERE, "..", "..", "..", "standards", "audit-checklist.md"), "utf8"));
  for (const x of c.checks) assert.equal(x.applies, "every agent", x.id);
});

test("a package tarball is read file by file, under the package's own paths", () => {
  const { files } = agentFiles();
  const p = readPackage(makeTar("summarizer", files));
  assert.equal(p.root, "summarizer");
  assert.deepEqual([...p.files.keys()].sort(), Object.keys(files).sort());
  assert.equal(p.files.get("plugin.json").toString(), files["plugin.json"]);
  assert.throws(() => readPackage(Buffer.from("not a tarball")), /not a gzip file/);
});

test("the message names the agent and the version or digest", () => {
  assert.deepEqual(fromText("agent: Quiz-Maker.platform@agentmesh.ai\nversion: v0.7.0\n"), { handle: "quiz-maker.platform@agentmesh.ai", version: "0.7.0", digest: "", stages: {}, asksToApprove: false });
  assert.deepEqual(fromText("agent: x.y@z.com\narchitecture: arch.manifest.json\n- code: a.json, b.json\n").stages, { architecture: ["arch.manifest.json"], code: ["a.json", "b.json"] });
  assert.equal(fromText(`please audit help.system@agentmesh.ai, package_digest: ${"A".repeat(64)}`).digest, `sha256:${"a".repeat(64)}`);
  assert.equal(fromText("agent: x.y@z.com\nand approve it").asksToApprove, true);
  assert.deepEqual(readFiles([{ path: join(HERE, "nothing-here.json") }]).unread.map((u) => u.why), ["the file was not there to read"]);
});

test("the version picked: the digest asked for, else the version, else what dev serves", () => {
  const requests = [
    { id: "a", status: "deployed", package: { version: "1.0.0", sha256: "a".repeat(64) } },
    { id: "b", status: "denied", package: { version: "1.1.0", sha256: "b".repeat(64) } },
  ];
  assert.equal(pickTarget({ asked: { digest: `sha256:${"b".repeat(64)}`, version: "" }, requests, devVersion: "1.0.0", attachedPackages: [] }).version, "1.1.0");
  assert.equal(pickTarget({ asked: { digest: "", version: "" }, requests, devVersion: "1.0.0", attachedPackages: [] }).digest, `sha256:${"a".repeat(64)}`);
  assert.equal(pickTarget({ asked: { digest: "", version: "2.0.0" }, requests, devVersion: "1.0.0", attachedPackages: [] }).digest, null);
  assert.ok(versionOrder("1.10.0", "1.9.0") > 0 && versionOrder("0.6.0", "0.6.0") === 0);
});

test("each finding is a debt owed to the agent's owner; a refusing one holds back promote", () => {
  const f = { id: "stage-record-test", says: "s", why: "w", fixed_by: "test", evidence: "e" };
  const items = owedItems({ findings: [{ ...f, level: "refuse" }, { ...f, id: "x", level: "warn" }], handle: "quiz-maker.platform@agentmesh.ai", version: "0.6.0", digest: "sha256:ab", checklistDigest: "sha256:cd" });
  assert.equal(ownerOf("quiz-maker.platform@agentmesh.ai"), "platform@agentmesh.ai");
  assert.deepEqual(items.map((i) => [i.kind, i.owed_to, i.blocks]), [["dependency", "platform@agentmesh.ai", ["promote"]], ["dependency", "platform@agentmesh.ai", []]]);
  assert.match(items[0].what, /Fixed at the test stage/);
  assert.equal(items[0].what.split("\n").pop(), "finding: stage-record-test on sha256:ab");
});

test("the rule against model names is AgentMesh's: a model in code or a skill is found, a comment and a run config are not", () => {
  // The names are put together here so that no model is written into this package.
  const m = ["gem", "ini-3.8-fl", "ash"].join("");
  const c = ["clau", "de-son", "net-5-5"].join("");
  assert.ok(modelIn(m));
  assert.equal(findingsIn("x.mjs", `export const MODEL = "${m}";`).length, 1);
  assert.equal(findingsIn("x.mjs", `const u = \`\${x ? \`${c}\` : y}\`;`).length, 1);
  assert.equal(findingsIn("x.mjs", `// ${m} once answered 404\nconst m = env.AGENT_MODEL;`).length, 0);
  assert.equal(findingsIn("SKILL.md", `The model is TEXT_MODEL, ${m} when unset.`).length, 1);
  assert.equal(findingsIn("agent-descriptor.json", JSON.stringify({ does: "x", run_config: { settings: [{ name: "model", allowed: [`google/${m}`] }] } })).length, 0);
  assert.equal(modelIn("Gemini"), null);
  // And the copy is the gate's, where the AgentMesh repository is beside this one.
  const gate = [process.env.AGENTMESH_REPO, join(REPO, "..", "AgentMesh"), join(REPO, "..", "..")].filter(Boolean).map((r) => join(r, "tools", "ci", "check-no-model-literals.mjs")).find((p) => existsSync(p));
  if (gate) {
    const src = readFileSync(gate, "utf8");
    const mine = readFileSync(join(HERE, "..", "scripts", "models.mjs"), "utf8");
    const body = (t) => t.slice(t.indexOf("export function modelIn"), t.indexOf("/** Every file")).replace(/\r/g, "");
    assert.equal(body(mine).replace(/^function filesUnder[\s\S]*/m, ""), body(src).replace(/^function filesUnder[\s\S]*/m, ""));
  }
});

test("the delivered-formats copy is the test writer's, function for function", async () => {
  const ref = await import(pathToFileURL(join(REPO, "agents", "test-writer", "references", "delivered-formats.test.mjs")).href);
  for (const name of ["declaredOutputs", "conventionOf", "formatProblems", "outputFor", "textOf"]) {
    assert.equal(String(formats[name]), String(ref[name]), `${name} matches agents/test-writer/references/delivered-formats.test.mjs`);
  }
  assert.deepEqual(formats.formatProblems(Buffer.from('{"a":1}'), "text/markdown"), ["the piece is declared text/markdown and is JSON"]);
});

test("the package maker's own checks run over a package when it is beside this one", { skip: !findPackageMaker() && "the package maker is not on this machine" }, () => {
  const { files } = agentFiles();
  const pkg = readPackage(makeTar("summarizer", files));
  const r = runPackageMaker(pkg, { work: HERE });
  assert.equal(r.ran, true, r.why);
  assert.ok(Array.isArray(r.format_rules?.findings), JSON.stringify(r));
  assert.equal(canonical(runPackageMaker(null)), canonical({ ran: false, why: "the package's bytes were not read" }));
});

test("can-use-declared reads the package maker's own standing rules when it runs", { skip: !findPackageMaker() && "the package maker is not on this machine" }, () => {
  // This package itself, built, with its can_use made wrong two ways.
  const out = mkdtempSync(join(tmpdir(), "auditor-pm-"));
  try {
    const built = spawnSync("python3", [findPackageMaker(), join(HERE, ".."), out], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const root = join(out, "agent-auditor");
    const files = new Map();
    const walk = (d, rel = "") => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, `${rel}${n}/`); else files.set(`${rel}${n}`, readFileSync(p)); } };
    walk(root);
    const d = JSON.parse(files.get("agent-descriptor.json").toString());
    d.can_use = [{ ...d.can_use[0], without: undefined }, { schema: "https://schemas.example/unknown/v1", reads: ["x"], required: false, does: "d", without: "w" }];
    files.set("agent-descriptor.json", Buffer.from(JSON.stringify(d, null, 2)));
    const pm = runPackageMaker({ files, root: "agent-auditor" }, { work: out });
    assert.ok(pm.standing_rules, JSON.stringify(pm));
    const ctx = { facts: { pkg: { descriptor: d }, dev: {} }, packageMaker: pm, schemas: null };
    const without = REGISTERED["can-use-declared"]({ id: "can-use-without" }, ctx);
    const known = REGISTERED["can-use-declared"]({ id: "can-use-known-schema" }, ctx);
    assert.equal(without.result, "fail", without.evidence);
    assert.match(without.evidence, /does not say without/);
    assert.equal(known.result, "fail", known.evidence);
    assert.match(known.evidence, /unknown\/v1/);
    assert.doesNotMatch(known.evidence, /does not say without/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("person-facing-declares-library without the package maker: can_use [] is a statement, a missing can_use is not (6.14.4)", () => {
  const doc = (extra) => ({ format: "agent-descriptor-v1", agent_version: "1.0.0", does: "d", offerings: [{ id: "write", name: "Write", inputs: [], outputs: [{ name: "the note", kind: "text/markdown" }] }], ...extra });
  const ctxOf = (d) => ({ facts: { pkg: { descriptor: d }, dev: {} }, packageMaker: { ran: false }, schemas: null });
  const empty = REGISTERED["can-use-declared"]({ id: "person-facing-declares-library" }, ctxOf(doc({ can_use: [] })));
  const absent = REGISTERED["can-use-declared"]({ id: "person-facing-declares-library" }, ctxOf(doc({})));
  assert.equal(empty.result, "pass", empty.evidence);
  assert.match(empty.evidence, /declared empty/);
  assert.equal(absent.result, "fail", absent.evidence);
});

test("conformance-result: does-not-conform lists the failed cases, inconclusive is a warning at most naming what was not judged, conforms passes", () => {
  const line = (record, bound = true) => ({ stage: "conformance", present: true, bound, source: "the registry", record, evidence: "e" });
  const run = (record, bound) => REGISTERED["conformance-result"]({ id: "conformance-result" }, { lines: [line(record, bound)], facts: {} });
  const failed = run({ verdict: "does-not-conform", cases: [{ id: "refuse-1", kind: "refusal", source: "Does not refund.", verdict: "fail", observed: "did not decline" }, { id: "refuse-2", verdict: "pass" }], records_audit: { missing: ["the run log"] } });
  assert.equal(failed.result, "fail");
  assert.match(failed.evidence, /refuse-1 \(Does not refund\.\): did not decline/);
  assert.match(failed.evidence, /promised records not found: the run log/);
  assert.doesNotMatch(failed.evidence, /refuse-2/);
  assert.equal(failed.at_most, undefined);
  const unjudged = run({ verdict: "inconclusive", cases: [{ id: "escalate-1", source: "A chargeback", verdict: "inconclusive", observed: "no reply" }], records_audit: { unobserved: ["each answer"] } });
  assert.equal(unjudged.result, "fail");
  assert.equal(unjudged.at_most, "warn");
  assert.match(unjudged.evidence, /not judged: escalate-1 \(A chargeback\): no reply/);
  assert.match(unjudged.evidence, /records not observed: each answer/);
  assert.equal(run({ verdict: "conforms", cases: [] }).result, "pass");
  assert.equal(run({ conforms: true }).result, "pass", "a verdict from before the word reads conforms");
  assert.equal(run({ verdict: "conforms" }, false).result, "not checked", "a verdict for another version says nothing about this one");
  assert.equal(REGISTERED["conformance-result"]({ id: "conformance-result" }, { lines: [{ stage: "conformance", present: false }], facts: {} }).result, "not checked");
});
