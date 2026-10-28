// Each finding, filed in the platform's debt ledger once.
//
// The pattern is the impact analyst's (agents/impact-analyst/scripts/ledger.mjs):
// read what is already filed against the agent, then file each item not
// already there, through the ledger's own doors with the ledger's key:
//   GET  <MESH_API_BASE>/v1/operator/debt?against=<handle>&kind=dependency&state=all
//   POST <MESH_API_BASE>/v1/operator/debt/items
//   POST <MESH_API_BASE>/v1/operator/debt/<n>/transition   (a replaced package's items)
//
// The ledger holds two kinds of debt, dependency and technical, and technical
// debt is the platform team's own list (docs/technical-debt.md is written from
// it). An audit finding is owed by the agent's owner, so each one is filed as
// a dependency item against the agent, owed to its owner:
//   - a finding at level refuse is a dependency debt that blocks promote, the
//     act the prod gate refuses until the finding is fixed;
//   - a finding at level warn is an agent debt: the same kind of item against
//     the agent, blocking nothing, so it is on the agent's list and holds
//     nothing back.
// Each item names the stage that fixes it and carries a last line,
// `finding: <check id> on <package digest>`, by which a second audit of the
// same package finds it and files nothing twice, whatever state it is in.
// When the audited package is the one dev serves now, the auditor's still-owed
// items that name another package are closed (closeReplaced, below). A 429
// from the ledger is waited out and asked again (retry.mjs).
//
// A failure to file is said in words and never stops the report.
//
//   needs: node >= 22
//   import { owedItems, fileOwed, closeReplaced } from "./ledger.mjs"

import { fetchRetrying, ONLY_429 } from "./retry.mjs";

const trim = (s) => String(s ?? "").trim();
export const FILED_BY = "agent-auditor";
const PAGE = 500;
const PAGES = 20;

/** Whom an agent's debt is owed to: its owner, the part of the handle after its name. */
export function ownerOf(handle) {
  const h = trim(handle);
  const at = h.indexOf(".");
  return at > 0 ? h.slice(at + 1) : h;
}

export const markOf = (id, digest) => `finding: ${id} on ${digest || "no package digest"}`;

/** The items owed, one per finding. Pure. */
export function owedItems({ findings, handle, version, digest, checklistDigest }) {
  return findings.map((f) => ({
    kind: "dependency",
    against: handle,
    owed_to: ownerOf(handle),
    caused_by: `audit of ${handle} ${version || "?"} (package ${digest || "none on record"}) against checklist ${checklistDigest}`,
    blocks: f.level === "refuse" ? ["promote"] : [],
    what: [
      `**${handle} ${version || "?"}: ${f.id} fails the audit${f.level === "refuse" ? ", and holds back promote" : " (a warning, an agent debt)"}.**`,
      `The rule: ${f.says}`,
      `Found: ${f.evidence}`,
      `Why it matters: ${f.why}`,
      `Fixed at the ${f.fixed_by} stage. Closed when an audit of a package that fixes it passes this check, or the owner accepts it in writing.`,
      markOf(f.id, digest),
    ].join("\n\n"),
    finding: f.id,
  }));
}

/** The API's origin, with /v1 added. */
export function apiRoot(base) {
  const b = trim(base).replace(/\/+$/, "");
  if (!b) return "";
  return /\/v1$/.test(b) ? b : `${b}/v1`;
}

/** The ledger's doors with the ledger's key, waiting out a 429 (retry.mjs).
 *  A call that files something new is asked again after a 429 only. */
function caller({ base, token, fetchImpl = globalThis.fetch, timeoutMs = 20000, sleep } = {}) {
  const root = apiRoot(base);
  return async (method, path, body) => {
    const res = await fetchRetrying(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${trim(token)}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }, { fetchImpl, timeoutMs, ...(sleep ? { sleep } : {}), ...(method === "POST" && path === "/operator/debt/items" ? { codes: ONLY_429 } : {}) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, json };
  };
}

/** Every dependency item against one agent, in every state:
 *  {items} or {why} when the ledger would not list them all. */
async function listAgainst(call, against) {
  const items = [];
  try {
    let offset = 0;
    let last = "";
    for (let n = 0; ; n++) {
      if (n >= PAGES) return { why: `the ledger holds more than ${PAGES * PAGE} items against this agent, more than this reads` };
      const r = await call("GET", `/operator/debt?against=${encodeURIComponent(against)}&kind=dependency&state=all&limit=${PAGE}&offset=${offset}`);
      if (!r.ok) return { why: `the ledger would not list what is already filed (${r.status}${r.json?.error ? `: ${trim(r.json.error).slice(0, 200)}` : ""})` }; // cut-ok: an error message
      const page = Array.isArray(r.json?.items) ? r.json.items : [];
      const total = typeof r.json?.total === "number" ? r.json.total : null;
      if (!page.length) break;
      const sig = JSON.stringify(page.map((x) => x?.number));
      if (sig === last) return { why: "the ledger answered the same page twice" };
      last = sig;
      items.push(...page);
      offset += page.length;
      if (total !== null ? items.length >= total : page.length < PAGE) break;
    }
  } catch (e) {
    return { why: `the ledger did not answer (${trim(e?.name === "TimeoutError" || e?.name === "AbortError" ? "it took too long" : e?.message ?? e)})` };
  }
  return { items };
}

/** File what is owed, once each. One result per item:
 *  {state: "filed" | "already filed" | "not filed", number?, why?}. */
export async function fileOwed(items, { base, token, fetchImpl = globalThis.fetch, who = FILED_BY, timeoutMs = 20000, sleep } = {}) {
  if (!items.length) return [];
  const root = apiRoot(base);
  if (!trim(token) || !root) {
    const why = !trim(token) ? "this host binds no ledger key (the-ledger, LEDGER_TOKEN)" : "this host names no address for the platform (MESH_API_BASE)";
    return items.map(() => ({ state: "not filed", why }));
  }
  const call = caller({ base, token, fetchImpl, timeoutMs, sleep });
  const listed = await listAgainst(call, items[0].against);
  if (!listed.items) return items.map(() => ({ state: "not filed", why: `${listed.why}, so nothing was filed rather than risk filing twice` }));
  const existing = listed.items;
  const out = [];
  for (const it of items) {
    const mark = it.what.split("\n").pop();
    // A dropped item was withdrawn, not answered: a finding still there is owed again.
    const same = existing.find((x) => trim(x?.state) !== "dropped" && trim(x?.owed_to) === it.owed_to && String(x?.what ?? "").split("\n").some((l) => trim(l) === mark));
    if (same) { out.push({ state: "already filed", number: same.number, ledger_state: same.state }); continue; }
    try {
      const r = await call("POST", "/operator/debt/items", { kind: it.kind, against: it.against, owed_to: it.owed_to, caused_by: it.caused_by, what: it.what, blocks: it.blocks, who });
      if (r.ok && r.json?.item?.number) {
        out.push({ state: "filed", number: r.json.item.number, ledger_state: r.json.item.state });
        existing.push({ owed_to: it.owed_to, what: it.what, number: r.json.item.number, state: r.json.item.state });
      } else out.push({ state: "not filed", why: `the ledger refused it (${r.status}${r.json?.error ? `: ${trim(r.json.error).slice(0, 200)}` : ""})` }); // cut-ok: an error message
    } catch (e) {
      out.push({ state: "not filed", why: `the ledger did not answer (${trim(e?.message ?? e)})` });
    }
  }
  return out;
}

// ── A replaced package's items ────────────────────────────────────────────
//
// An agent's package is replaced by its next version, and the items the
// audit filed against the old digest stay owed by nobody: the old package
// no longer runs, and a second audit never sees them, because its mark names
// the new digest. So when the audited package is the one dev serves now, the
// auditor closes its own still-owed items that name another package (or no
// package): resolved where the new package passes the check, dropped as
// superseded where it does not (the finding is owed again on the new
// package, as its own item). Items for this digest are never touched.

const ACTIVE = new Set(["open", "acknowledged"]);
const MARK = /^finding: (\S+) on (.+)$/;

/** The auditor's mark on a filed item: {finding, digest} or null. */
export function markIn(what) {
  const last = String(what ?? "").split("\n").map(trim).filter(Boolean).pop() ?? "";
  const m = MARK.exec(last);
  return m ? { finding: m[1], digest: trim(m[2]) } : null;
}

/**
 * What to close when an agent's package was replaced. Pure. `existing` is
 * every item against the agent; `results` maps a check id to this audit's
 * answer ({result, counted}); `filed` maps a check id to the number of the
 * item it is owed as on the new package. Only the auditor's own items (they
 * carry its mark), still owed (open or acknowledged), owed to the agent's
 * owner, and naming another package than this one:
 *  - this audit passes the check: resolved, the new package fixes it;
 *  - this audit still fails it: dropped, superseded by the item on the new
 *    package, which it names;
 *  - this audit holds no finding for it (not checked, info, or no longer on
 *    the checklist): dropped, superseded, and said so.
 */
export function replacedItems({ existing, handle, digest, version, results, filed, auditedAt }) {
  const owner = ownerOf(handle);
  const day = trim(auditedAt).slice(0, 10);
  const now = `${digest} (version ${version || "?"})`;
  const out = [];
  for (const x of existing ?? []) {
    if (!ACTIVE.has(trim(x?.state)) || trim(x?.owed_to) !== owner) continue;
    const m = markIn(x?.what);
    if (!m || !digest || m.digest === digest) continue;
    const old = m.digest === "no package digest" ? "no package on record" : `the package ${m.digest}`;
    const r = results.get(m.finding);
    if (r?.counted && r.result === "pass") {
      out.push({ number: x.number, finding: m.finding, from_digest: m.digest, to: "resolved", evidence: `${old} was replaced by ${now}; its audit on ${day} passes ${m.finding}.` });
    } else if (r?.counted && r.result === "fail") {
      const n = filed.get(m.finding);
      out.push({ number: x.number, finding: m.finding, from_digest: m.digest, to: "dropped", evidence: `superseded: ${old} was replaced by ${now}; the finding is owed on the new package${n ? ` as #${n}` : ", where its audit report lists it"}.` });
    } else {
      out.push({ number: x.number, finding: m.finding, from_digest: m.digest, to: "dropped", evidence: `superseded: ${old} was replaced by ${now}; its audit on ${day} holds no finding for ${m.finding} (${r ? (r.counted ? r.result : "an info check") : "not on the checklist"}).` });
    }
  }
  return out;
}

/** Close a replaced package's items. One result per item:
 *  {number, finding, from_digest, to, evidence, state: "closed" | "not closed", why?}. */
export async function closeReplaced({ handle, digest, version, results, filed, auditedAt }, { base, token, fetchImpl = globalThis.fetch, who = FILED_BY, timeoutMs = 20000, sleep } = {}) {
  if (!trim(token) || !apiRoot(base) || !digest) return [];
  const call = caller({ base, token, fetchImpl, timeoutMs, sleep });
  const listed = await listAgainst(call, handle);
  if (!listed.items) return [{ state: "not closed", why: `${listed.why}, so no replaced package's item was closed` }];
  const out = [];
  for (const it of replacedItems({ existing: listed.items, handle, digest, version, results, filed, auditedAt })) {
    try {
      const r = await call("POST", `/operator/debt/${it.number}/transition`, { to: it.to, who, evidence: it.evidence });
      out.push(r.ok ? { ...it, state: "closed" } : { ...it, state: "not closed", why: `the ledger refused it (${r.status}${r.json?.error ? `: ${trim(r.json.error).slice(0, 200)}` : ""})` }); // cut-ok: an error message
    } catch (e) {
      out.push({ ...it, state: "not closed", why: `the ledger did not answer (${trim(e?.message ?? e)})` });
    }
  }
  return out;
}
