// What the audit was asked for, and what came with it.
//
// The message names the agent and the version:
//   agent: <handle>                       required
//   version: <x.y.z>                      or
//   package_digest: sha256:<64 hex>       either, or both; with neither, the
//                                         version the agent serves on dev
// Attached files are known by what they hold, whatever kind they came under:
//   - the checklist (Markdown whose checks are YAML blocks); without one, the
//     checklist this package carries, standards/audit-checklist.md at the
//     version pinned in references/
//   - the package (a .tar.gz), so it need not be fetched
//   - signed records: a delivery manifest (job-manifest-v1) from a lifecycle
//     stage, a build record, a deployment record, a conformance verdict
//   - run records that cite the standing assets a run used
//   - a delivered job's pieces.json with its pieces, as one folder's files
//   - any other Markdown: a records-folder note (records/build-<version>.md),
//     which is read as unsigned
//
//   needs: node >= 22
//   import { fromText, readFiles } from "./read-request.mjs"
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

const trim = (s) => String(s ?? "").trim();

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
  return { handle: handle.toLowerCase(), version: line("version").replace(/^v/, ""), digest, asksToApprove: asksForApproval(t) };
}

/** Whether the message asks the auditor to approve, deploy or list: it never does. */
export function asksForApproval(text = "") {
  return /\b(approve|deploy it|go ahead|list it|publish it|ship it|sign off)\b/i.test(String(text));
}

const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Sort the attached files by what they hold. */
export function readFiles(files = []) {
  const got = { checklist: null, packages: [], manifests: [], buildRecords: [], deployRecords: [], evalRecords: [], runRecords: [], deliveries: [], notes: [], unread: [] };
  for (const f of files) {
    const path = trim(f.path);
    const name = basename(path).replace(/^\d+-[A-Za-z0-9_-]{8}-/, "");
    if (!path || !existsSync(path) || !statSync(path).isFile()) { got.unread.push({ name, why: "the file was not there to read" }); continue; }
    const bytes = readFileSync(path);
    if (isGzip(bytes)) { got.packages.push({ name, bytes }); continue; }
    const text = bytes.toString("utf8");
    let doc = null;
    try { doc = JSON.parse(text); } catch { doc = null; }
    if (doc && typeof doc === "object") {
      const tags = (Array.isArray(doc.signatures) ? doc.signatures : []).map((s) => s?.tag);
      if (doc.format === "job-manifest-v1") got.manifests.push({ name, doc });
      else if (tags.includes("agent-build-record-v1") || (doc.role === "agent-builder" && doc.act === "build")) got.buildRecords.push({ name, doc });
      else if (tags.includes("agent-deployment-record-v1") || doc.role === "deployment-manager") got.deployRecords.push({ name, doc });
      else if (tags.includes("agent-eval-record-v1") || doc.tag === "agent-eval-record-v1") got.evalRecords.push({ name, doc });
      else if (Array.isArray(doc.standing_assets) || Array.isArray(doc.can_use_read) || doc.run_record) got.runRecords.push({ name, doc });
      else if (Array.isArray(doc) && doc.every((p) => p && typeof p === "object" && p.path && p.media_type)) got.deliveries.push({ name, pieces: doc, dir: path.replace(/[\\/][^\\/]+$/, "") });
      else got.unread.push({ name, why: "a JSON file the audit does not read (not a signed record, a delivery manifest or a run record)" });
      continue;
    }
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
