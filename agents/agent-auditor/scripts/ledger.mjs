// Each finding, filed in the platform's debt ledger once.
//
// The pattern is the impact analyst's (agents/impact-analyst/scripts/ledger.mjs):
// read what is already filed against the agent, then file each item not
// already there, through the ledger's own doors with the ledger's key:
//   GET  <MESH_API_BASE>/v1/operator/debt?against=<handle>&kind=dependency&state=all
//   POST <MESH_API_BASE>/v1/operator/debt/items
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
//
// A failure to file is said in words and never stops the report.
//
//   needs: node >= 22
//   import { owedItems, fileOwed } from "./ledger.mjs"

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

/** File what is owed, once each. One result per item:
 *  {state: "filed" | "already filed" | "not filed", number?, why?}. */
export async function fileOwed(items, { base, token, fetchImpl = globalThis.fetch, who = FILED_BY, timeoutMs = 20000 } = {}) {
  if (!items.length) return [];
  const root = apiRoot(base);
  if (!trim(token) || !root) {
    const why = !trim(token) ? "this host binds no ledger key (the-ledger, LEDGER_TOKEN)" : "this host names no address for the platform (MESH_API_BASE)";
    return items.map(() => ({ state: "not filed", why }));
  }
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${root}${path}`, {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${trim(token)}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, json };
  };
  const existing = [];
  try {
    const against = encodeURIComponent(items[0].against);
    let offset = 0;
    let last = "";
    for (let n = 0; ; n++) {
      if (n >= PAGES) return items.map(() => ({ state: "not filed", why: `the ledger holds more than ${PAGES * PAGE} items against this agent, more than this reads, so nothing was filed rather than risk filing twice` }));
      const r = await call("GET", `/operator/debt?against=${against}&kind=dependency&state=all&limit=${PAGE}&offset=${offset}`);
      if (!r.ok) {
        const why = `the ledger would not list what is already filed (${r.status}${r.json?.error ? `: ${trim(r.json.error).slice(0, 200)}` : ""}), so nothing was filed rather than risk filing twice`; // cut-ok: an error message
        return items.map(() => ({ state: "not filed", why }));
      }
      const page = Array.isArray(r.json?.items) ? r.json.items : [];
      const total = typeof r.json?.total === "number" ? r.json.total : null;
      if (!page.length) break;
      const sig = JSON.stringify(page.map((x) => x?.number));
      if (sig === last) return items.map(() => ({ state: "not filed", why: "the ledger answered the same page twice, so nothing was filed rather than risk filing twice" }));
      last = sig;
      existing.push(...page);
      offset += page.length;
      if (total !== null ? existing.length >= total : page.length < PAGE) break;
    }
  } catch (e) {
    const why = `the ledger did not answer (${trim(e?.name === "TimeoutError" || e?.name === "AbortError" ? "it took too long" : e?.message ?? e)})`;
    return items.map(() => ({ state: "not filed", why }));
  }
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
