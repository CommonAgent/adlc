// What the watcher reads from the platform, and nothing else.
//
// Every read is a GET, and every one is either public or covered by the one
// credential the install places, an account API token with the `credits:read`
// scope (WATCH_TOKEN). That scope reads the account's statement and the spend
// report and nothing more: it cannot buy credits, change a budget or spend.
//
//   GET <base>/a/<handle>                 public: the agent's storefront, with
//                                         `availability` (the registry's live
//                                         presence) and the card's last check-in
//   GET <base>/a/<handle>/record.json     public: the platform's own count of
//                                         the agent's runs over 30 days, failed
//                                         ones and the average time
//   GET <base>/a/<handle>/agentdoc.json   public: the AgentDoc, where the
//                                         ceilings each offering declares are
//   GET <base>/v1/token-info              the token: which account it is for
//   GET <base>/v1/accounts/<id>/spend-report?agents=…&from=…&to=…
//                                         credits:read: what the named agents
//                                         spent, job by job, against ceilings
//
// Each answer is kept as read, with the address and the time, so the report
// can name where every line came from. A read that fails is said, never
// filled in.
//
//   needs: node >= 22
//   import { platform } from "./platform.mjs"

const trim = (s) => String(s ?? "").trim();

/** One GET, with a clock. Returns { ok, status, body, url, at, error }. */
async function get(url, { token = "", fetchImpl = globalThis.fetch, timeoutMs = 20_000, now = () => new Date() } = {}) {
  const at = now().toISOString();
  try {
    const r = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    const error = r.ok ? null : (body?.error ? String(body.error) : `the platform answered ${r.status}`);
    return { ok: r.ok, status: r.status, body, url, at, error };
  } catch (e) {
    return { ok: false, status: 0, body: null, url, at, error: `no answer from the platform (${trim(e?.message ?? e)})` };
  }
}

/** The platform the watcher reads, bound to its origin and its token. */
export function platform({ base = "", token = "", fetchImpl, now } = {}) {
  const root = trim(base).replace(/\/+$/, "");
  const opts = { fetchImpl, now };
  const enc = (h) => encodeURIComponent(h);
  return {
    root,
    hasToken: Boolean(trim(token)),
    /** The storefront: presence and the card. */
    card: (handle) => get(`${root}/a/${enc(handle)}`, opts),
    /** The platform's run counts for the agent. */
    record: (handle) => get(`${root}/a/${enc(handle)}/record.json`, opts),
    /** The AgentDoc, for the ceilings each offering declares. */
    agentdoc: (handle) => get(`${root}/a/${enc(handle)}/agentdoc.json`, opts),
    /** Which account the token is for. */
    tokenInfo: () => get(`${root}/v1/token-info`, { ...opts, token }),
    /** The spend report for the named agents. */
    spendReport: (account, agents, { from = null, to = null } = {}) => {
      const q = new URLSearchParams({ agents: agents.join(",") });
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      return get(`${root}/v1/accounts/${enc(account)}/spend-report?${q}`, { ...opts, token });
    },
  };
}

/** What the storefront says about presence: { availability, last_seen_at, key }. */
export function presenceOf(cardBody) {
  const b = cardBody ?? {};
  const listing = b.card?.listing ?? {};
  const card = b.card?.card ?? {};
  const seen = card.presence?.last_seen_at ?? listing.presence?.last_seen_at ?? listing.last_seen_at ?? null;
  return {
    key: typeof b.agent_id === "string" ? b.agent_id : null,
    availability: typeof b.availability === "string" ? b.availability : null,
    last_seen_at: typeof seen === "string" ? seen : null,
  };
}

/** The ceilings the AgentDoc carries for each offering, as declared:
 *  [{ offering, limit, most, place }]. */
export function declaredCeilings(agentdoc) {
  const out = [];
  const offerings = agentdoc?.sections?.sells?.offerings;
  if (!Array.isArray(offerings)) return out;
  offerings.forEach((o, i) => {
    const c = o?.ceilings;
    if (!c || typeof c !== "object") return;
    for (const [limit, v] of Object.entries(c)) {
      if (v && typeof v === "object" && v.most !== undefined) out.push({ offering: o.id ?? `offering ${i}`, limit, most: v.most, place: `sections.sells.offerings[${i}].ceilings.${limit}` });
    }
  });
  return out;
}
