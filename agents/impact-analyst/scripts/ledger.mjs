// What is owed, and filing it in the ledger.
//
// For each dependent answered breaking or change of behavior, the role files
// one item in the ledger (https://agentroles.ai/impact-analyst.html, rule 5):
// a dependency debt against the changed agent, owed to the dependent's owner,
// holding back promote and decommission on the changed agent until it is
// closed. The ledger is a platform service, reached at its own door
// (services/src/ledger/requests.ts in the AgentMesh repository):
//   POST <MESH_API_BASE>/v1/operator/debt/items   to file one item
//   GET  <MESH_API_BASE>/v1/operator/debt          to read what is already filed
// with the ledger's key as the bearer. Only the platform files debt, so the
// key is the host's to bind (the-ledger, LEDGER_TOKEN), never a message's.
//
// Filing the same change twice files nothing twice: before filing, the items
// already against the agent are read, and an item with the same cause, owed
// to the same owner, for the same dependent, is the one reported. So a report
// asked for twice leaves the ledger as it left it the first time.
//
// A failure to file is said in words and never stops the report: the report
// is the deliverable, and it lists what is owed whether or not it was filed.
//
//   needs: node >= 22
//   import { owedItems, fileOwed, causeOf } from "./ledger.mjs"
import { createHash } from "node:crypto";
import { canonical } from "./compare.mjs";
import { VERDICT_WORDS } from "./answer.mjs";

const trim = (s) => String(s ?? "").trim();
export const BLOCKS = ["promote", "decommission"];
export const FILED_BY = "impact-analyst";

/** The digest of a declaration, read the same whatever order its keys are in. */
export function digestOf(doc) {
  return createHash("sha256").update(JSON.stringify(canonical(doc))).digest("hex");
}

/** The change, as the ledger's caused_by names it. */
export function causeOf({ subject, before, after }) {
  return `${subject} ${trim(before?.agent_version) || "?"} -> ${trim(after?.agent_version) || "?"} (declaration sha256:${digestOf(after)})`;
}

/** The dependent, as one line the ledger item carries, so a second filing finds the first. */
export const markOf = (a) => `dependent: ${a.kind} ${a.id ?? a.name ?? a.display ?? "unnamed"} of ${trim(a.owner?.org) || trim(a.owner?.name) || "an unnamed owner"}`;

/** Whom the item is owed to: the dependent's owner, by organization when the list names one. */
export function owedTo(a) {
  const o = a.owner ?? {};
  return trim(o.org) || trim(o.name) || (a.kind === "agent" && a.id ? `the owner of ${a.id}` : a.owner_words);
}

/** The items owed, one per dependent answered breaking or change of behavior. Pure. */
export function owedItems({ answered, subject, before, after }) {
  const cause = causeOf({ subject, before, after });
  return answered.filter((a) => a.verdict !== "compatible").map((a) => ({
    kind: "dependency",
    against: subject,
    owed_to: owedTo(a),
    caused_by: cause,
    blocks: BLOCKS,
    what: [
      `**${subject} ${trim(before?.agent_version)} -> ${trim(after?.agent_version)}: ${a.display ?? a.name ?? a.id ?? "a dependent"} (${a.kind}) is answered ${VERDICT_WORDS[a.verdict]}.**`,
      a.reasons.join(" "),
      `Owed to ${a.owner_words}. Closed when the dependent is shown to work with the new version (its own check passing on it), is changed to fit it, or its owner accepts the change in writing.`,
      markOf(a),
    ].join("\n\n"),
    dependent: { kind: a.kind, id: a.id, name: a.name, display: a.display ?? a.name ?? a.id },
  }));
}

/** The API's origin, with /v1 added; a value already ending in /v1 is read as it stands. */
export function apiRoot(base) {
  const b = trim(base).replace(/\/+$/, "");
  if (!b) return "";
  return /\/v1$/.test(b) ? b : `${b}/v1`;
}

/** File what is owed, once. Returns one result per item:
 *  {state: "filed" | "already filed" | "not filed", number?, why?}. */
export async function fileOwed(items, { base, token, fetchImpl = globalThis.fetch, who = FILED_BY, timeoutMs = 20000 } = {}) {
  if (!items.length) return [];
  const root = apiRoot(base);
  if (!trim(token) || !root) {
    const why = !trim(token) ? "this host binds no ledger key (the-ledger, LEDGER_TOKEN)" : "this host names no address for the platform (MESH_API_BASE)";
    return items.map(() => ({ state: "not filed", why }));
  }
  const call = async (method, path, body) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${root}${path}`, {
        method, signal: ctl.signal,
        headers: { authorization: `Bearer ${trim(token)}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { ok: res.ok, status: res.status, json, text };
    } finally { clearTimeout(t); }
  };
  let existing = [];
  try {
    const against = encodeURIComponent(items[0].against);
    const r = await call("GET", `/operator/debt?against=${against}&kind=dependency&state=all&limit=500`);
    if (!r.ok) {
      const why = `the ledger would not list what is already filed (${r.status}${r.json?.error ? `: ${trim(r.json.error).slice(0, 200)}` : ""}), so nothing was filed, rather than risk filing it twice`;
      return items.map(() => ({ state: "not filed", why }));
    }
    existing = Array.isArray(r.json?.items) ? r.json.items : [];
  } catch (e) {
    const why = `the ledger did not answer (${trim(e?.name === "AbortError" ? "it took too long" : e?.message ?? e)})`;
    return items.map(() => ({ state: "not filed", why }));
  }
  const out = [];
  for (const it of items) {
    const mark = it.what.split("\n").pop();
    const same = existing.find((x) => trim(x?.caused_by) === it.caused_by && trim(x?.owed_to) === it.owed_to && String(x?.what ?? "").includes(mark));
    if (same) { out.push({ state: "already filed", number: same.number, ledger_state: same.state }); continue; }
    try {
      const r = await call("POST", "/operator/debt/items", { kind: it.kind, against: it.against, owed_to: it.owed_to, caused_by: it.caused_by, what: it.what, blocks: it.blocks, who });
      if (r.ok && r.json?.item?.number) out.push({ state: "filed", number: r.json.item.number, ledger_state: r.json.item.state });
      else out.push({ state: "not filed", why: `the ledger refused it (${r.status}${r.json?.error ? `: ${trim(r.json.error).slice(0, 200)}` : ""})` });
    } catch (e) {
      out.push({ state: "not filed", why: `the ledger did not answer (${trim(e?.name === "AbortError" ? "it took too long" : e?.message ?? e)})` });
    }
  }
  return out;
}
