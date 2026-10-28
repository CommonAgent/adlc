// What the audit was asked for, and what came with it.
//
// The message names the agent and the version:
//   agent: <handle>                       required
//   version: <x.y.z>                      or
//   package_digest: sha256:<64 hex>       either, or both; with neither, the
//                                         version the agent serves on dev
//   <stage>: <file name>                  optional: an attached delivery
//                                         manifest that is this stage's record,
//                                         whoever signed it
// Attached files are known by what they hold, whatever kind they came under:
//   - the checklist (Markdown whose checks are YAML blocks); without one, the
//     checklist this package carries, standards/audit-checklist.md at the
//     version pinned in references/
//   - the package (a .tar.gz), so it need not be fetched
//   - signed records: a delivery manifest (job-manifest-v1) from a lifecycle
//     stage, a build record, a deployment record, a conformance verdict
//   - run records that cite the standing assets a run used
//   - a delivered job's pieces.json with its pieces, as one folder's files
//   - usability reports: Markdown whose front matter says `usability_report`,
//     read for the Usability stage's line with the manifest that lists them
//   - App walk records: JSON that says `"app_walk": "v1"`, the App add-on's
//     recorded verdict for one agent version
//   - any other Markdown: a records-folder note (records/build-<version>.md),
//     which is read as unsigned
//
//   needs: node >= 22
//   import { fromText, readFiles } from "./read-request.mjs"
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

const trim = (s) => String(s ?? "").trim();
/** The stages whose record is a delivery manifest (stages.mjs MANIFEST_STAGES). */
const STAGE_NAMES = ["requirements", "architecture", "design", "impact", "test", "code", "review", "security"];

/** The message's asks. */
export function fromText(text = "") {
  const t = String(text);
  const line = (k) => {
    const m = new RegExp(`(?:^|[\\s,;(])(?:[-*]\\s*)?${k}\\s*:\\s*(\\S+)`, "im").exec(t);
    return m ? m[1].replace(/[.,;]+$/, "") : "";
  };
  let handle = line("agent") || line("handle");
  if (!handle) {
    const m = /\b([a-z0-9][a-z0-9-]*\.[a-z0-9-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i.exec(t);
    handle = m ? m[1] : "";
  }
  let digest = line("package_digest") || line("digest");
  if (digest && /^[0-9a-f]{64}$/i.test(digest)) digest = `sha256:${digest}`;
  digest = digest.toLowerCase();
  // Which attached delivery manifest is which stage's record, when its signer
  // is not the stage's usual holder: `<stage>: <file name>[, <file name>]`.
  const stages = {};
  for (const st of STAGE_NAMES) {
    const m = new RegExp(`^\\s*(?:[-*]\\s*)?${st}\\s*:\\s*(.+)$`, "im").exec(t);
    if (m) stages[st] = m[1].split(",").map((x) => trim(x)).filter(Boolean);
  }
  return { handle: handle.toLowerCase(), version: line("version").replace(/^v/, ""), digest, stages, asksToApprove: asksForApproval(t) };
}

/** Whether the message asks the auditor to approve, deploy or list: it never does. */
export function asksForApproval(text = "") {
  return /\b(approve|deploy it|go ahead|list it|publish it|ship it|sign off)\b/i.test(String(text));
}

/** A usability report's header (agents/usability-tester scripts/report.mjs), or null. */
export function usabilityHeader(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(String(text).replace(new RegExp("^" + String.fromCharCode(0xfeff)), ""));
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (!k) continue;
    let v = k[2].trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { /* as written */ } }
    out[k[1]] = v === "null" ? null : v;
  }
  return out.usability_report ? out : null;
}

const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Sort the attached files by what they hold. */
export function readFiles(files = []) {
  const got = { checklist: null, packages: [], manifests: [], buildRecords: [], deployRecords: [], evalRecords: [], runRecords: [], deliveries: [], usabilityReports: [], appWalks: [], notes: [], unread: [] };
  for (const f of files) {
    const path = trim(f.path);
    let name = basename(path);
    // A file forwarded through a run carries one staged prefix per hop.
    while (/^\d+-[A-Za-z0-9_-]{8}-/.test(name)) name = name.replace(/^\d+-[A-Za-z0-9_-]{8}-/, "");
    if (!path || !existsSync(path) || !statSync(path).isFile()) { got.unread.push({ name, why: "the file was not there to read" }); continue; }
    const bytes = readFileSync(path);
    if (isGzip(bytes)) { got.packages.push({ name, bytes }); continue; }
    const text = bytes.toString("utf8");
    let doc = null;
    try { doc = JSON.parse(text); } catch { doc = null; }
    if (doc && typeof doc === "object") {
      const tags = (Array.isArray(doc.signatures) ? doc.signatures : []).map((s) => s?.tag);
      if (doc.app_walk === "v1") got.appWalks.push({ name, doc });
      else if (doc.format === "job-manifest-v1") got.manifests.push({ name, doc });
      else if (tags.includes("agent-build-record-v1") || (doc.role === "agent-builder" && doc.act === "build")) got.buildRecords.push({ name, doc });
      else if (tags.includes("agent-deployment-record-v1") || doc.role === "deployment-manager") got.deployRecords.push({ name, doc });
      else if (tags.includes("agent-eval-record-v1") || doc.tag === "agent-eval-record-v1") got.evalRecords.push({ name, doc });
      else if (Array.isArray(doc.standing_assets) || Array.isArray(doc.can_use_read) || doc.run_record) got.runRecords.push({ name, doc });
      else if (Array.isArray(doc) && doc.every((p) => p && typeof p === "object" && p.path && p.media_type)) got.deliveries.push({ name, pieces: doc, dir: path.replace(/[\\/][^\\/]+$/, "") });
      else got.unread.push({ name, why: "a JSON file the audit does not read (not a signed record, a delivery manifest or a run record)" });
      continue;
    }
    const front = usabilityHeader(text);
    if (front) { got.usabilityReports.push({ name, text, bytes, header: front }); continue; }
    if (/^```ya?ml\r?\n\s*id:/m.test(text) || /^schema:\s*\S*audit-checklist/m.test(text)) {
      if (got.checklist) got.unread.push({ name, why: "a second checklist; the first one attached is the one used" });
      else got.checklist = { name, bytes };
      continue;
    }
    if (/\.md$/i.test(name) || /^#\s/m.test(text)) { got.notes.push({ name, text }); continue; }
    got.unread.push({ name, why: "not a checklist, a package, a signed record, a run record or a note" });
  }
  return got;
}
