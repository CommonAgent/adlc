#!/usr/bin/env node
// The conformance checker's process kind: a signed verdict on an installed
// process (lane FLEET of "the ADLC builds processes"; the message and answer
// are in the lane's INTERFACE.md).
//
// The cases come from the process, never from the checker: the document is
// checked against the specification (§17.1, adlc standards/process-check.mjs),
// and the suite the package maker signed with it is read back as the test runs
// the platform ran, case by case. It combines:
//
//   - the §17.1 check of the document as installed, whose digests the signed
//     deployment record names (and the bundle is checked against);
//   - the suite's latest results, from the platform's process-install door
//     `suite`, which reads GET /v1/solutions/:id/tests/results for the
//     solution the suite ran on: every bundled test case, by name, must have a
//     test run that passed;
//
// into an agent-eval-record-v1 with `kind: "process"`, signed with this
// agent's key and filed with the registry where agent verdicts are filed
// (mesh.registry.eval.put), under the subject key process.<team>.<slug>.
//
// conforms: the check conforms with no finding, the install is still at the
// record's digest, and every case passed. does-not-conform: a §17.1 failure, a
// §20.1 finding, a failed case, or an install no longer at that digest.
// inconclusive: a case with no result or still running, or the platform could
// not be asked. Never rounded up.
//
//   node process-verdict.mjs --run <framed prompt file> <identity.json>
//       the brain's call (agenteval-process-as-node.sh): exit 3 when it is
//       not process work, so the brain goes on as before
//
//   needs: node >= 22
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const records = await import(new URL("./process-records.mjs", import.meta.url).href).catch(() => import(new URL("../package-maker/shared/process-records.mjs", import.meta.url).href));
const {
  BUNDLE_FORMAT, KIND, MEDIA, TAGS, amEnv, digests, hostKeys, jsonOf, labelled, loadChecker, promptFiles, readFiles,
  roleKeys, senderText, sha256, signRecord, signedBody, verifyRecord, writePieces,
} = records;

const HERE = dirname(fileURLToPath(import.meta.url));
const NOT_CHECKED = "The process was not checked";

export const isDeploymentRecord = (j) => !!j && j.kind === KIND && j.act === "install" && j.record === "v1";
export const isBundle = (j) => !!j && j.format === BUNDLE_FORMAT && j.document && typeof j.document.text === "string";

/** The registry's key for a process's latest verdict. */
export const subjectKey = (id) => `process.${String(id).replace("/", ".")}`;

/**
 * The verdict from what was found. `check`: the process check's result;
 * `atDigest`: whether the install is still at the record's digest; `cases`:
 * the bundled test case names; `results`: the suite's results (or null when
 * the platform could not be asked).
 */
export function judge({ check, atDigest, cases, results, unreachable = null }) {
  const byName = new Map();
  for (const r of results ?? []) if (r && typeof r.name === "string" && !byName.has(r.name)) byName.set(r.name, r);
  const out = cases.map((name) => {
    if (!results) return { id: name, kind: "test-run", run: null, verdict: "inconclusive", observed: `not judged: ${unreachable ?? "the suite's results could not be read"}` };
    const r = byName.get(name);
    if (!r) return { id: name, kind: "test-run", run: null, verdict: "inconclusive", observed: "the suite has no test run for this case" };
    if (r.result === "pass") return { id: name, kind: "test-run", run: r.run ?? null, verdict: "pass", observed: "its test run passed" };
    if (r.result === "fail") return { id: name, kind: "test-run", run: r.run ?? null, verdict: "fail", observed: `its test run failed: ${(r.failures ?? []).join("; ") || "no expectation was named"}` };
    return { id: name, kind: "test-run", run: r.run ?? null, verdict: "inconclusive", observed: r.result === "pending" ? "its test run has not ended" : `its test run was not started${r.error ? `: ${r.error}` : ""}` };
  });
  const n = (v) => out.filter((c) => c.verdict === v).length;
  const summary = { pass: n("pass"), fail: n("fail"), inconclusive: n("inconclusive") };
  const docFails = !check.conforms || !check.clean;
  const verdict = docFails || summary.fail > 0 || atDigest === false ? "does-not-conform" : summary.inconclusive > 0 || atDigest == null ? "inconclusive" : "conforms";
  return { cases: out, summary, verdict, conforms: verdict === "conforms" };
}

/** What the message brought: the deployment record and the bundle. */
export function readRequest(files) {
  let record = null; let recordText = null; let bundle = null; let bundleText = null;
  for (const f of files) {
    const j = jsonOf(f.text);
    if (isDeploymentRecord(j) && !record) { record = j; recordText = f.text; }
    else if (isBundle(j) && !bundle) { bundle = j; bundleText = f.text; }
  }
  return { record, recordText, bundle, bundleText };
}

/**
 * The whole check. `call(path, body) -> { status, body }` reaches the
 * platform; `submit(record) -> { ok, why }` files the verdict with the
 * registry. Returns { ok: true, answer, record, pieces } or { ok: false, refused }.
 */
export async function checkProcessInstall({ files, words = "", verify, deploymentManagerKeys, signer, call, checker, submit = null, now = () => new Date() }) {
  const req = readRequest(files);
  if (!req.record) return { ok: false, refused: `${NOT_CHECKED}: no signed deployment record of a process came with the message.` };
  if (!req.bundle) return { ok: false, refused: `${NOT_CHECKED}: no process bundle came with the message.` };
  const v = verifyRecord(req.record, TAGS.deploy, verify);
  if (!v.ok) return { ok: false, refused: `${NOT_CHECKED}: the deployment record does not verify: ${v.why}.` };
  if (!deploymentManagerKeys.includes(v.by)) return { ok: false, refused: `${NOT_CHECKED}: the deployment record was signed by ${v.by}, which is not the deployment manager's key.` };
  const p = req.record.process ?? {};
  const d = digests(req.bundle.document.text, checker);
  if (req.record.bundle_sha256 && sha256(req.bundleText) !== req.record.bundle_sha256) return { ok: false, refused: `${NOT_CHECKED}: the bundle is not the one the deployment record names.` };
  if (d.text_sha256 !== p.text_sha256 || d.shape_sha256 !== p.shape_sha256) return { ok: false, refused: `${NOT_CHECKED}: the bundle's document is not the one the deployment record names (text ${d.text_sha256}, shape ${d.shape_sha256}).` };
  if (!signer) return { ok: false, refused: `${NOT_CHECKED}: this host has no key to sign the verdict with.` };

  // The document against the specification.
  const r = checker.checkProcess(req.bundle.document.text, {});
  const check = { kind: "process-check", conforms: r.conforms, clean: r.clean, spec: `Agent Processes ${checker.SPEC_VERSION ?? ""}`.trim(),
    failures: r.failures.map((f) => `${f.section} ${f.text}`), findings: r.findings.map((f) => `[${f.test}] ${f.section} ${f.text}`) };

  // The install and its suite's latest results, from the platform.
  const id = req.record.install_request;
  let install = null; let results = null; let unreachable = null; let suiteSolution = null;
  const got = await call(`/v1/process-installs/${id}/suite`, signedBody({}, { id, act: "suite", signer, now: now() })).catch((err) => ({ status: 0, body: { error: err.message } }));
  if (got.status === 200 && got.body?.install) {
    install = got.body.install;
    suiteSolution = got.body.suite?.solution ?? null;
    results = Array.isArray(got.body.suite?.results) ? got.body.suite.results : null;
    if (!results) unreachable = got.body.suite?.error ?? "the install names no solution the suite ran on";
  } else {
    unreachable = String(got.body?.error ?? (got.status ? `the platform answered ${got.status}` : "the platform could not be reached")).replace(/[.\s]+$/, "");
  }
  const atDigest = install ? install.status === "installed" && String(install.process?.text_sha256 ?? "") === p.text_sha256 : null;
  const j = judge({ check, atDigest, cases: req.bundle.test_cases.map((c) => c.name), results, unreachable });

  const doc = {
    record: "v1", kind: KIND, role: "conformance-checker", act: "evaluate",
    requested_by: labelled(words, "requested by")[0] ?? req.record.requested_by ?? "the requester",
    subject: { agent_key: subjectKey(p.id), process: { id: p.id, version: p.version, shape_sha256: p.shape_sha256, text_sha256: p.text_sha256 }, org: req.record.org ?? null, install_request: id },
    deployment_record_sha256: sha256(req.recordText),
    install: install ? { status: install.status, at_digest: atDigest, solution: install.solution?.id ?? null, suite_solution: suiteSolution } : { status: null, at_digest: null, why: unreachable },
    checks: [check],
    cases: j.cases,
    summary: j.summary,
    conforms: j.conforms,
    verdict: j.verdict,
    produced_at: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  const record = signRecord(doc, TAGS.evaluate, signer);
  const filed = submit && record.signatures?.length ? await Promise.resolve(submit(record)).catch((err) => ({ ok: false, why: err.message })) : { ok: false, why: "not sent" };
  const stem = `${String(p.id).replace("/", "-")}-v${p.version}`;
  const answer = `The conformance checker's verdict on ${p.id} v${p.version}: ${j.verdict} (${j.summary.pass} passed, ${j.summary.fail} failed, ${j.summary.inconclusive} not judged; §17.1 ${check.conforms && check.clean ? "conforms" : check.conforms ? "conforms, with findings" : "fails"}).${filed.ok ? " The signed verdict is filed with the registry and delivered as a piece." : ` The signed verdict is delivered as a piece; the registry did not take it (${filed.why}).`}`;
  return { ok: true, answer, record, filed, pieces: [{ name: "the signed verdict", file: `${stem}.eval-record.json`, text: `${JSON.stringify(record, null, 2)}\n`, media_type: MEDIA.verdict,
    about: `The conformance checker's signed verdict on ${p.id} v${p.version}: the document against the specification and its suite's test runs.` }] };
}

/** File a signed verdict with the registry, through submit-record.mjs, as
 *  this agent's identity over the ops node's connection. */
export function registrySubmit(identityPath, creds = process.env.MESH_CREDS_FILE || "/opt/fleet/node-ops/mesh.creds") {
  const script = [join(HERE, "agenteval-submit-record.mjs"), join(HERE, "submit-record.mjs")].find((p) => existsSync(p));
  return (record) => {
    if (!script) return { ok: false, why: "the registry submitter is not on this host" };
    if (!existsSync(creds)) return { ok: false, why: "no mesh credential to file it with on this host" };
    const dir = mkdtempSync(join(tmpdir(), "process-verdict-"));
    try {
      const at = join(dir, "record.json");
      writeFileSync(at, JSON.stringify(record));
      const p = spawnSync("node", [script, at, identityPath], { encoding: "utf8", timeout: 60000, env: { ...process.env, MESH_CREDS_FILE: creds } });
      return p.status === 0 ? { ok: true } : { ok: false, why: (p.stderr || p.stdout || "the submitter said nothing").trim().slice(0, 200) };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
}

/** The platform's doors, from this host: the app's /v1, JSON both ways. */
export function platformCall(base = `${String(amEnv("urls.app")).replace(/\/+$/, "")}`) {
  return async (path, body) => {
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    return { status: r.status, body: j };
  };
}

async function run(promptPath, identityPath) {
  const prompt = readFileSync(promptPath, "utf8");
  const { jobDir, files: paths } = promptFiles(prompt);
  const files = readFiles(paths);
  if (!readRequest(files).record) process.exit(3);
  const keys = hostKeys(identityPath);
  const deploymentManagerKeys = await roleKeys("deployment_manager", { env: "DEPLOYMENT_MANAGER_KEYS" });
  const got = await checkProcessInstall({ files, words: senderText(prompt), verify: keys.verify, deploymentManagerKeys, signer: keys.signer, call: platformCall(), checker: await loadChecker(), submit: registrySubmit(identityPath) });
  if (!got.ok) { console.log(got.refused); return; }
  if (jobDir) writePieces(jobDir, "check-conformance", got.pieces);
  console.log(got.answer);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--run" && args.length === 3) await run(args[1], args[2]);
  else { console.error("usage: process-verdict.mjs --run <prompt file> <identity.json>"); process.exit(2); }
}
