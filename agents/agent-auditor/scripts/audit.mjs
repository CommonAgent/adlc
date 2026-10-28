// Audit one agent version: one command, five steps, no model.
//   needs: node >= 22
//   node audit.mjs --job <job folder> --records <records folder>
//        --work <work folder> --text-file <message> [--file <path>[::<media type>]]...
//
// This is the command the runtime requirements start (run.audit-an-agent).
// The steps, in order:
//   read-the-request      read-request.mjs: the agent, the version or digest,
//                         the checklist, the attached records; gather.mjs:
//                         the agent on dev and prod and the deploy queue
//   check-the-stage-records   stages.mjs: one line per stage
//   run-the-checks        checks.mjs: every checklist entry through its
//                         registered test, or "not checked" with the reason
//   file-the-findings     ledger.mjs: each finding as a debt, once
//   write-the-report      report.mjs, keys.mjs, store.mjs, pieces.mjs: the
//                         signed report, filed where the gates read it
//
// It approves, deploys and lists nothing, and changes nothing it audits.
// Asked to approve, it says no, and still audits when it was told what to.
//
// It prints one JSON object with a `reply` field. Exit codes: 0 audited;
// 2 usage; 3 the job stops and the reply says what is needed; 1 failed.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asksForApproval, fromText, readFiles } from "./read-request.mjs";
import { levelFor, readChecklist } from "./checklist.mjs";
import { gather } from "./gather.mjs";
import { platform } from "./platform.mjs";
import { stageLines, strayManifests } from "./stages.mjs";
import { runCheck } from "./checks.mjs";
import { runPackageMaker } from "./package-maker.mjs";
import { fileOwed, owedItems } from "./ledger.mjs";
import { writeReport } from "./report.mjs";
import { fileReport } from "./store.mjs";
import { fill, plan as piecesPlan } from "./pieces.mjs";
import { note, read as wentWithout, sentence } from "./went-without.mjs";
import { sha256 } from "./keys.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** A file this package carries: in references/ (as built, or beside the
 *  scripts), or in the repository's standards/ folder. */
export function carried(name) {
  const tries = [join(HERE, "..", "references", name), join(HERE, name), join(HERE, "..", "..", "..", "standards", name), join(HERE, "..", "..", "..", "..", "standards", name)];
  const at = tries.find((p) => existsSync(p));
  if (!at) throw new Error(`${name} is not beside the auditor (looked in ${tries.join(", ")})`);
  return readFileSync(at);
}

export function fromArgv(args = []) {
  const parsed = { files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--job") parsed.job = args[++i];
    else if (a === "--records") parsed.records = args[++i];
    else if (a === "--work") parsed.work = args[++i];
    else if (a === "--text-file") parsed.textFile = args[++i];
    else if (a === "--file") {
      const v = String(args[++i] ?? "");
      const at = v.lastIndexOf("::");
      parsed.files.push(at === -1 ? { path: v, declared: "" } : { path: v.slice(0, at), declared: v.slice(at + 2) });
    }
  }
  return parsed;
}

export const DECLINE = "I do not approve, deploy or list agents. The gates read my report: the Deployment Manager and the Catalog decide from it.";
export const HOW_TO_ASK = "Name the agent and the version in the message, one per line: `agent: <handle>`, and `version: <x.y.z>` or `package_digest: sha256:<64 hex>` (without either, I audit the version the agent serves on dev). Attach a checklist to use another than the one I carry, and attach the stage records the platform does not keep by package: the signed delivery manifests the requirements, architecture, design, test, code, review and security stages left.";

/** The audit, given what was read. The network is reached only through the
 *  platform objects and the ledger and store calls handed in. */
export async function audit({ asked, attached, checklist, dev, prod, files = new Map(), ledger = {}, store = {}, seed = "", now = new Date(), work = "", env = process.env, schemas = null }) {
  const facts = await gather({ asked, attached, dev, prod, now });
  const lines = stageLines(facts);
  const packageMaker = facts.pkg ? runPackageMaker(facts.pkg, { work, env }) : { ran: false, why: "the package's bytes were not read" };
  const ctx = { facts, lines, packageMaker, schemas, files };
  const results = [];
  const findings = [];
  const notChecked = [];
  for (const entry of checklist.checks) {
    const r = runCheck(entry, ctx);
    const lv = levelFor(entry, { firstReleased: facts.firstReleased, now });
    const row = { ...entry, ...r, level_applied: lv.level };
    results.push(row);
    if (r.result === "fail") findings.push({ ...entry, evidence: r.evidence, place: r.place, level: lv.level, level_why: lv.why });
    if (r.result === "not checked") notChecked.push({ id: entry.id, check: entry.check, why: r.why });
  }
  if (!checklist.approved_by) notChecked.push({ id: "the checklist's approval", check: "", why: `${checklist.name} (${checklist.digest}) names nobody under approved_by, so no person has approved this version of it; its checks were run as written` });
  for (const p of checklist.problems) notChecked.push({ id: "the checklist", check: "", why: `an entry is out of shape: ${p}` });
  for (const m of strayManifests(facts)) notChecked.push({ id: `delivery manifest ${m.name}`, check: "", why: `signed by ${m.agent}, which holds no stage the auditor knows, so it was not read as any stage's record` });
  const owed = owedItems({ findings, handle: facts.handle, version: facts.target.version, digest: facts.target.digest, checklistDigest: checklist.digest });
  const filed = await fileOwed(owed, ledger);
  const audited_at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const report = writeReport({ facts, checklist, lines, results, findings, notChecked, filed, audited_at, seed });
  const kept = await fileReport(report.text, { ...store, digest: facts.target.digest, signed: report.signed });
  return { facts, lines, results, findings, notChecked, owed, filed, report, kept, packageMaker };
}

const many = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;

export function replyText({ result, asked, went }) {
  const { facts, report, findings, filed, kept, lines } = result;
  const L = [];
  if (asked) L.push(DECLINE);
  L.push(`I audited ${facts.handle} ${facts.target.version ?? "(no version on record)"}, package ${facts.target.digest ?? "none on record"}: ${report.verdict}. The report${report.signed ? `, signed by ${report.signed_by},` : ", unsigned,"} is filed with the job.`);
  const missing = lines.filter((l) => l.state !== "present").map((l) => `${l.asset} (${l.state})`);
  if (missing.length) L.push(`Stage records not present, signed and bound: ${missing.join(", ")}.`);
  const refuse = findings.filter((f) => f.level === "refuse").map((f) => f.id);
  const warn = findings.filter((f) => f.level === "warn").map((f) => f.id);
  if (refuse.length) L.push(`Refusing findings: ${refuse.join(", ")}.`);
  if (warn.length) L.push(`Warnings: ${warn.join(", ")}.`);
  if (went) L.push(went);
  const f = filed.filter((x) => x.state === "filed").map((x) => `#${x.number}`);
  const a = filed.filter((x) => x.state === "already filed").map((x) => `#${x.number}`);
  const n = filed.filter((x) => x.state === "not filed");
  if (f.length) L.push(`I filed ${many(f.length, "debt")} in the ledger: ${f.join(", ")}.`);
  if (a.length) L.push(`${many(a.length, "finding was", "findings were")} already in the ledger and not filed twice: ${a.join(", ")}.`);
  if (n.length) L.push(`${many(n.length, "finding is", "findings are")} not filed, because ${[...new Set(n.map((x) => x.why))].join("; ")}; the report lists each one.`);
  if (kept.state === "not filed") L.push(`The report is not filed where the gates read it, because ${kept.why}.`);
  else L.push(`The report is ${kept.state === "filed" ? "filed" : "already filed"} where the gates read it: ${kept.read_at}.`);
  return L.join(" ");
}

/** The job, as the runtime requirements start it. */
export async function runJob(argv = [], env = process.env, { fetchImpl, now = new Date() } = {}) {
  const args = fromArgv(argv);
  if (!args.job || !args.records) return { ok: false, code: 2, reply: "This job needs --job <job folder> and --records <records folder>." };
  const text = args.textFile && existsSync(args.textFile) ? readFileSync(args.textFile, "utf8") : "";
  const asked = fromText(text);
  const approve = asksForApproval(text);
  const id = basename(args.job);
  const RECORDS = join(args.records, id);
  mkdirSync(RECORDS, { recursive: true });
  rmSync(join(RECORDS, "went-without.json"), { force: true });
  if (!asked.handle) return { ok: false, code: 3, reply: approve ? `${DECLINE} ${HOW_TO_ASK}` : `I cannot audit yet: no agent was named. ${HOW_TO_ASK}`, declined: approve };
  if (!trim(env.MESH_API_BASE)) return { ok: false, code: 3, reply: "I cannot audit: this host names no address for the platform (MESH_API_BASE), and the agent is read there." };

  const attached = readFiles(args.files);
  for (const u of attached.unread) note(RECORDS, { wanted: u.name, did: "audited without it", why: u.why });
  let checklist;
  if (attached.checklist) checklist = readChecklist(attached.checklist.bytes);
  else checklist = readChecklist(carried("audit-checklist.md"));
  if (!checklist.checks.length) return { ok: false, code: 3, reply: `The checklist ${attached.checklist ? attached.checklist.name : "I carry"} holds no checks I can read: each is a fenced YAML block with id, says, why, kind, check, fixed-by, level, applies and evidence.` };
  let schemas = null;
  try {
    const raw = carried("standing-asset-schemas.json");
    schemas = { digest: sha256(raw), schemas: (JSON.parse(raw.toString("utf8")).schemas ?? []).map((s) => trim(s.schema)) };
  } catch { schemas = null; }

  const files = new Map(args.files.filter((f) => existsSync(f.path)).map((f) => [basename(f.path).replace(/^\d+-[A-Za-z0-9_-]{8}-/, ""), readFileSync(f.path)]));
  const dev = platform({ base: env.MESH_API_BASE, token: env.AUDIT_TOKEN, fetchImpl });
  const prod = trim(env.PROD_API_BASE) ? platform({ base: env.PROD_API_BASE, fetchImpl }) : null;
  const work = args.work ? (mkdirSync(args.work, { recursive: true }), args.work) : RECORDS;
  const result = await audit({
    asked, attached, checklist, dev, prod, files, now, work, env, schemas,
    seed: trim(env.AUDIT_SIGNING_SEED),
    ledger: { base: env.MESH_API_BASE, token: env.LEDGER_TOKEN, ...(fetchImpl ? { fetchImpl } : {}) },
    store: { base: env.MESH_API_BASE, token: env.AUDIT_TOKEN, ...(fetchImpl ? { fetchImpl } : {}) },
  });
  for (const n of result.facts.notes) note(RECORDS, n);
  if (!result.report.signed) note(RECORDS, { wanted: "the auditor's signing key (AUDIT_SIGNING_SEED)", did: "wrote the report unsigned, which the gates do not accept" });
  if (!result.packageMaker.ran) note(RECORDS, { wanted: "the package maker's own checks", did: "read its rules from the signed build record or the Descriptor, as each check says", why: result.packageMaker.why });
  const notFiled = result.filed.filter((x) => x.state === "not filed");
  if (notFiled.length) note(RECORDS, { wanted: "a ledger that would take the findings", did: "listed each finding in the report without filing it", why: notFiled[0].why });

  const listed = fill(args.job, piecesPlan({ report: result.report.text })).map((e) => e.name);
  writeFileSync(join(RECORDS, "filed.json"), `${JSON.stringify({ filed: "v1", report: result.kept, items: result.owed.map((o, i) => ({ finding: o.finding, owed_to: o.owed_to, against: o.against, blocks: o.blocks, ...result.filed[i] })) }, null, 2)}\n`);
  const went = sentence(wentWithout(RECORDS));
  return {
    ok: true, code: 0,
    reply: replyText({ result, asked: approve, went }),
    declined: approve,
    agent: result.facts.handle,
    version: result.facts.target.version,
    package_digest: result.facts.target.digest,
    verdict: result.report.verdict,
    expires_at: result.report.expires_at,
    signed_by: result.report.signed_by,
    checklist_digest: checklist.digest,
    stages: result.lines.map((l) => ({ stage: l.stage, state: l.state })),
    checks: result.results.map((r) => ({ id: r.id, result: r.result, level: r.level_applied })),
    filed: result.filed,
    report_filed: result.kept,
    went_without: wentWithout(RECORDS),
    listed,
  };
}

const startedAsCommand = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (startedAsCommand()) {
  const out = await runJob(process.argv.slice(2)).catch((e) => ({
    ok: false, code: 1, reply: `No audit report was written, and this is what stopped it: ${trim(e?.message ?? e)}`,
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.code ?? 0;
}
