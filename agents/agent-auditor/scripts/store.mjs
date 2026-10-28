// File the signed report where the gates read it.
//
// The platform keeps audit reports by package digest (AgentMesh
// services/src/audits/). The auditor files each one with the audit key:
//   POST <MESH_API_BASE>/v1/operator/audits   {report}
// and the Deployment Manager and the Catalog read the newest one for a digest
// at GET /v1/audits/<package digest>, which answers current_pass.
//
// A report with no package digest (an agent no package is on record for) or
// with no signature is not filed: the store keys reports by digest and
// refuses an unsigned one. The reply says so. A 429, 502 or 503 is waited
// out and asked again (retry.mjs).
//
//   needs: node >= 22
//   import { fileReport } from "./store.mjs"

import { fetchRetrying } from "./retry.mjs";

const trim = (s) => String(s ?? "").trim();

export async function fileReport(text, { base, token, digest, signed, fetchImpl = globalThis.fetch, timeoutMs = 20000, sleep } = {}) {
  if (!digest) return { state: "not filed", why: "no package digest is on record for this agent, and the platform keeps reports by package digest" };
  if (!signed) return { state: "not filed", why: "the report is unsigned (this host binds no signing key, AUDIT_SIGNING_SEED), and the platform takes signed reports only" };
  const root = trim(base).replace(/\/+$/, "");
  if (!root || !trim(token)) return { state: "not filed", why: !root ? "this host names no address for the platform (MESH_API_BASE)" : "this host binds no audit key (AUDIT_TOKEN)" };
  try {
    const r = await fetchRetrying(`${root}/v1/operator/audits`, {
      method: "POST",
      headers: { authorization: `Bearer ${trim(token)}`, "content-type": "application/json" },
      body: JSON.stringify({ report: text }),
    }, { fetchImpl, timeoutMs, ...(sleep ? { sleep } : {}) });
    let json = null;
    try { json = JSON.parse(await r.text()); } catch { json = null; }
    if (!r.ok) return { state: "not filed", why: `the platform refused it (${r.status}${json?.error ? `: ${trim(json.error)}` : ""})` };
    return { state: json?.already ? "already filed" : "filed", report_digest: json?.filed?.report_digest ?? null, report_url: json?.report_url ?? null, read_at: `${root}/v1/audits/${digest}` };
  } catch (e) {
    return { state: "not filed", why: `the platform did not answer (${trim(e?.message ?? e)})` };
  }
}
