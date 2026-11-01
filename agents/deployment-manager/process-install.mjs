#!/usr/bin/env node
// The deployment manager's process kind: install a signed process, or retire
// one (lane FLEET of "the ADLC builds processes"; the message and answer are
// in the lane's INTERFACE.md).
//
// A process installs into the platform, not onto this host: it is filed with
// the organization's processes, published as a solution, and bound to its
// trigger or schedule. Only the platform can do those three, so this procedure
// asks it to, through the process-install doors, each call signed with this
// agent's own key, and only for an install the owner approved there (the
// install request, like a deploy request). What stays this agent's is the
// gate and the record:
//
//   1. the build record's signature verifies, and its signer is the package
//      maker (the key the platform's handle resolves to);
//   2. the bundle is the one the record names: its digest, the document's
//      text and shape digests, every test case's digest;
//   3. the platform files, draws and binds (POST /v1/process-installs/:id/do);
//   4. an agent-deployment-record-v1 with `kind: "process"` is signed and
//      kept on the install (POST /v1/process-installs/:id/record).
//
// Retiring is the same in reverse: the platform unbinds the schedule, removes
// the solution the install drew and takes the document out of the
// organization's processes, and the record says act "retire".
//
//   node process-install.mjs --run <framed prompt file> <identity.json>
//       the brain's call (deploymgr-process-as-node.sh): exit 3 when it is
//       not process work, so the brain goes on as before
//
//   needs: node >= 22
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const records = await import(new URL("./process-records.mjs", import.meta.url).href).catch(() => import(new URL("../package-maker/shared/process-records.mjs", import.meta.url).href));
const {
  BUNDLE_FORMAT, KIND, MEDIA, TAGS, amEnv, digests, hostKeys, jsonOf, labelled, loadChecker, promptFiles,
  readFiles, roleKeys, senderText, sha256, signRecord, signedBody, verifyRecord, writePieces,
} = records;

const NOT_INSTALLED = "The process was not installed";
const NOT_RETIRED = "The process was not retired";
const INSTALL_ID = /^pi_[0-9a-f]{8,40}$/;

/** A process build record, by content. */
export const isBuildRecord = (j) => !!j && j.kind === KIND && j.act === "build" && j.record === "v1";
/** A process bundle, by content. */
export const isBundle = (j) => !!j && j.format === BUNDLE_FORMAT && j.document && typeof j.document.text === "string";

/** What the message asks: install or retire, the install request, the files. */
export function readRequest({ files, words }) {
  const retire = /\bretire-a-process\b/i.test(words);
  const id = (labelled(words, "install request")[0] ?? "").trim();
  let record = null; let recordText = null; let bundle = null; let bundleText = null;
  for (const f of files) {
    const j = jsonOf(f.text);
    if (isBuildRecord(j) && !record) { record = j; recordText = f.text; }
    else if (isBundle(j) && !bundle) { bundle = j; bundleText = f.text; }
  }
  return { act: retire ? "retire" : "install", id, record, recordText, bundle, bundleText };
}

/**
 * The gate before anything is asked of the platform: the record verifies and
 * is the package maker's, and the bundle is the one it names.
 * Returns { ok: true, process } or { ok: false, why }.
 */
export function checkSigned({ record, bundle, bundleText, verify, packageMakerKeys, checker = null }) {
  if (!record) return { ok: false, why: "no signed build record of a process came with the message" };
  if (!bundle) return { ok: false, why: "no process bundle came with the message" };
  const v = verifyRecord(record, TAGS.build, verify);
  if (!v.ok) return { ok: false, why: `the build record does not verify: ${v.why}` };
  if (!packageMakerKeys.includes(v.by)) return { ok: false, why: `the build record was signed by ${v.by}, which is not the package maker's key` };
  const want = record.process ?? {};
  if (sha256(bundleText) !== record.bundle?.sha256) return { ok: false, why: `the bundle is ${sha256(bundleText)}, and the record names ${record.bundle?.sha256 ?? "no bundle"}` };
  const d = digests(bundle.document.text, checker);
  if (d.text_sha256 !== want.text_sha256) return { ok: false, why: `the document's text is ${d.text_sha256}, and the record names ${want.text_sha256}` };
  if (d.shape_sha256 !== want.shape_sha256) return { ok: false, why: `the document's shape is ${d.shape_sha256}, and the record names ${want.shape_sha256}` };
  const named = new Map((record.test_cases?.cases ?? []).map((c) => [c.name, c.sha256]));
  if (named.size !== bundle.test_cases.length) return { ok: false, why: `the record names ${named.size} test cases and the bundle carries ${bundle.test_cases.length}` };
  for (const c of bundle.test_cases) {
    if (named.get(c.name) !== sha256(c.text)) return { ok: false, why: `the test case ${c.name} is not the one the record names` };
  }
  return { ok: true, process: { id: want.id, version: want.version, name: want.name ?? "", shape_sha256: want.shape_sha256, text_sha256: want.text_sha256 } };
}

/** The signed deployment record of one act, from what the platform answered. */
export function deploymentRecord({ act, id, install, recordText = null, bundleText = null, process = null, signer, now = new Date() }) {
  const p = process ?? install?.process ?? {};
  const doc = {
    record: "v1", kind: KIND, role: "deployment-manager", act,
    requested_by: install?.approved?.by ?? "the owner",
    install_request: id,
    org: install?.org ?? null,
    process: { id: p.id ?? p.key ?? null, version: p.version ?? null, name: p.name ?? "", shape_sha256: p.shape_sha256 ?? null, text_sha256: p.text_sha256 ?? null },
    ...(recordText ? { build_record_sha256: sha256(recordText) } : {}),
    ...(bundleText ? { bundle_sha256: sha256(bundleText) } : {}),
    approved: install?.approved ?? null,
    filed: install?.filed ?? null,
    solution: install?.solution ?? null,
    trigger: install?.trigger ?? null,
    status: install?.status ?? null,
    checks: act === "install"
      ? [{ kind: "build-record", what: "the build record's signature verified and is the package maker's; the bundle, the document's text and shape and every test case are the ones it names" }]
      : [{ kind: "retire", what: "the owner's yes to retiring it is on the install request the platform holds" }],
    produced_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  return signRecord(doc, TAGS.deploy, signer);
}

/** The words a trigger is said in. */
export function triggerWords(t) {
  if (t?.kind === "schedule" && t.schedule) return `scheduled as ${t.schedule.name ?? "a schedule"}${t.schedule.next_at ? `, next run ${t.schedule.next_at}` : ""}`;
  return "run on request";
}

/**
 * The whole act. `call(path, body) -> { status, body }` reaches the platform;
 * `verify`, `packageMakerKeys` and `signer` are the host's.
 * Returns { ok: true, answer, record, pieces } or { ok: false, refused }.
 */
export async function doProcess({ files, words, verify, packageMakerKeys, signer, call, checker = null, now = () => new Date() }) {
  const req = readRequest({ files, words });
  const REF = req.act === "retire" ? NOT_RETIRED : NOT_INSTALLED;
  if (!INSTALL_ID.test(req.id)) return { ok: false, refused: `${REF}: the message names no install request (a line "install request: pi_…", which the platform gives when the owner approves the install).` };
  if (!signer) return { ok: false, refused: `${REF}: this host has no key to sign the call or the record with.` };
  let checked = null;
  if (req.act === "install") {
    checked = checkSigned({ ...req, verify, packageMakerKeys, checker });
    if (!checked.ok) return { ok: false, refused: `${REF}: ${checked.why}.` };
  }
  const body = req.act === "install" ? { document: req.bundle.document.text, build_record: req.record } : {};
  const got = await call(`/v1/process-installs/${req.id}/do`, signedBody(body, { id: req.id, act: req.act, signer, now: now() })).catch((err) => ({ status: 0, body: { error: err.message } }));
  if (got.status !== 200 || !got.body?.install) {
    const why = String(got.body?.error ?? (got.status ? `the platform answered ${got.status}` : "the platform could not be reached")).replace(/[.\s]+$/, "");
    return { ok: false, refused: `${REF}: ${why}.` };
  }
  const install = got.body.install;
  const rec = deploymentRecord({ act: req.act, id: req.id, install, recordText: req.recordText, bundleText: req.bundleText, process: checked?.process ?? null, signer, now: now() });
  const kept = await call(`/v1/process-installs/${req.id}/record`, signedBody({ record: rec }, { id: req.id, act: "record", signer, now: now() })).catch(() => ({ status: 0 }));
  const p = rec.process;
  const stem = `${String(p.id ?? "process").replace("/", "-")}-v${p.version ?? "0"}`;
  const pieces = [{ name: "deployment record", file: `${stem}.deployment-record.json`, text: `${JSON.stringify(rec, null, 2)}\n`, media_type: MEDIA.deploy,
    about: `The deployment record of ${p.id} v${p.version}, signed by the deployment manager: ${req.act === "install" ? "where it was filed, the solution it was published as, and its trigger" : "what was taken down"}.` }];
  if (req.act === "install") {
    pieces.push({ name: "process bundle", file: `${stem}.process-bundle.json`, text: req.bundleText, media_type: MEDIA.bundle,
      about: "The process bundle as installed, passed on unchanged for the conformance check." });
  }
  const keptWords = kept.status === 200 ? "" : " The platform did not take the record back just now; it is delivered here.";
  const answer = req.act === "install"
    ? `Installed ${p.id} v${p.version} for the organization: filed as ${install.filed?.version ?? p.version} (${install.filed?.digest ? `sha256:${String(install.filed.digest).replace(/^sha256:/, "")}` : p.text_sha256}), solution ${install.solution?.id ?? "none"}, ${triggerWords(install.trigger)}. The signed deployment record is delivered as a piece.${keptWords}`
    : `Retired ${p.id} v${p.version}: its schedule is unbound, the solution it was published as is removed, and the document is out of the organization's processes. The signed deployment record is delivered as a piece.${keptWords}`;
  return { ok: true, answer, record: rec, pieces, install };
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
  const words = senderText(prompt);
  const { jobDir, files: paths } = promptFiles(prompt);
  const files = readFiles(paths);
  const req = readRequest({ files, words });
  if (!(req.record || /\b(install|retire)-a-process\b/i.test(words))) process.exit(3);
  const keys = hostKeys(identityPath);
  const packageMakerKeys = await roleKeys("package_maker", { env: "PACKAGE_MAKER_KEYS" });
  const got = await doProcess({ files, words, verify: keys.verify, packageMakerKeys, signer: keys.signer, call: platformCall(), checker: await loadChecker().catch(() => null) });
  if (!got.ok) { console.log(got.refused); return; }
  if (jobDir) writePieces(jobDir, got.record.act === "install" ? "install-the-process" : "retire-the-process", got.pieces);
  console.log(got.answer);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--run" && args.length === 3) await run(args[1], args[2]);
  else { console.error("usage: process-install.mjs --run <prompt file> <identity.json>"); process.exit(2); }
}
