// What the tests share: a platform that answers the watcher's reads from a
// script, a spend report built the way the platform builds one, and a host
// laid out the way the builder lays the package out.
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIX = join(AGENT, "test", "fixtures");
export const FAKE_BIN = join(AGENT, "test", "fake-agentmesh.mjs");
export const json = (p) => JSON.parse(readFileSync(p, "utf8"));
export const TOKEN = "amt_testtokenthatonlyreads";
export const ACCOUNT = "acct-watch-1";

/** A storefront as the platform serves one. */
export function storefront(handle, { key = `U${handle.length}KEY`, availability = "online", lastSeen = "2026-10-28T05:00:00Z" } = {}) {
  return { agent_id: key, visibility: "public", name: handle.split(".")[0], ...(availability ? { availability } : {}), card: { card: { handle, presence: lastSeen ? { state: availability, last_seen_at: lastSeen } : null }, listing: { handle, last_seen_at: null } } };
}

/** An AgentDoc carrying one offering's ceilings. */
export function agentdoc(handle, ceilings = null) {
  return { agentdoc: "v1", subject: { handle }, sections: { sells: { offerings: [{ id: "do-the-job", ...(ceilings ? { ceilings } : {}) }] } } };
}

/** One agent's spend, as spend-report-v1 carries it: days of job lines. */
export function agentSpend({ key, handle, owner = ACCOUNT, days = [], currency = "XCR", allowed = { registered: false }, against = [], crossings = [] }) {
  const sum = (xs) => xs.reduce((t, x) => t + x, 0);
  const rows = days.map((d) => {
    const traced = sum(d.jobs.map((j) => j.spent_micro));
    return { day: d.day, spent_micro: traced + (d.untraced ?? 0), jobs: d.jobs.map((j) => ({ at: `${d.day}T10:00:00.000Z`, ...j })), untraced_micro: d.untraced ?? 0 };
  });
  const spent = sum(rows.map((r) => r.spent_micro));
  const traced = sum(rows.map((r) => sum(r.jobs.map((j) => j.spent_micro))));
  return {
    agent: key, handle, label: null, owner, read: "ok",
    currencies: rows.length ? [{ currency, spent_micro: spent, traced_micro: traced, untraced_micro: spent - traced, days: rows,
      untraced: rows.filter((r) => r.untraced_micro).map((r) => ({ day: r.day, amount_micro: r.untraced_micro, why: "accounted before the platform kept a line per job" })),
      total_ever_micro: spent, older_than_kept_micro: 0, oldest_kept_day: rows[0]?.day ?? null, window_reaches_past_kept: false }] : [],
    allowed, against, crossings,
  };
}

/** A whole report from agents' spend, totals and owners added the way the platform adds them. */
export function spendReport(agents, { from = "2026-10-01", to = "2026-10-28" } = {}) {
  const totals = new Map();
  const owners = new Map();
  for (const a of agents) {
    for (const c of a.currencies) {
      const t = totals.get(c.currency) ?? { currency: c.currency, spent_micro: 0, traced_micro: 0, untraced_micro: 0 };
      t.spent_micro += c.spent_micro; t.traced_micro += c.traced_micro; t.untraced_micro += c.untraced_micro;
      totals.set(c.currency, t);
    }
    const o = owners.get(a.owner) ?? { owner: a.owner, label: null, agents: [], currencies: [] };
    o.agents.push(a.agent);
    for (const c of a.currencies) {
      let oc = o.currencies.find((x) => x.currency === c.currency);
      if (!oc) { oc = { currency: c.currency, spent_micro: 0, traced_micro: 0, untraced_micro: 0 }; o.currencies.push(oc); }
      oc.spent_micro += c.spent_micro; oc.traced_micro += c.traced_micro; oc.untraced_micro += c.untraced_micro;
    }
    owners.set(a.owner, o);
  }
  const all = [...totals.values()];
  return {
    format: "spend-report-v1", generated_at: "2026-10-28T06:00:00.000Z", window: { from, to },
    agents, owners: [...owners.values()], totals: all,
    every_spend_traced: all.every((t) => t.untraced_micro === 0), reconciles: true, discrepancies: [], says: [],
  };
}

/** A platform on a local port, answering from `world`:
 *  { cards: {handle: body | 404}, records: {handle: body}, docs: {handle: body}, spend: body, strangers: [handle], scopes: [..] } */
export async function fakePlatform(world) {
  const seen = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    seen.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization ?? null });
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const m = /^\/a\/([^/]+)(\/record\.json|\/agentdoc\.json)?$/.exec(url.pathname);
    if (m) {
      const h = decodeURIComponent(m[1]);
      const table = m[2] === "/record.json" ? world.records : m[2] === "/agentdoc.json" ? world.docs : world.cards;
      const body = table?.[h];
      if (body === undefined || body === 404) return send(404, { error: "unknown handle" });
      return send(200, body);
    }
    if (url.pathname === "/v1/token-info") {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "Authentication required" });
      return send(200, { accountId: ACCOUNT, scopes: world.scopes ?? ["credits:read"], label: "watcher", id: "tok-1" });
    }
    if (url.pathname === `/v1/accounts/${ACCOUNT}/spend-report`) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "Authentication required" });
      const names = (url.searchParams.get("agents") ?? "").split(",").filter(Boolean);
      const stranger = names.find((n) => (world.strangers ?? []).includes(n));
      if (stranger) return send(404, { error: `${stranger} is not one of this account's agents` });
      return send(200, world.spend);
    }
    return send(404, { error: "Not found" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, seen, close: () => new Promise((r) => server.close(r)) };
}

/** A host: the package laid out as the builder lays it out, a records
 *  folder, a work folder, and the fake agentmesh with its script. */
export function host(script = {}) {
  const root = mkdtempSync(join(tmpdir(), "watcher-"));
  const pkg = "watcher";
  const plugin = json(join(AGENT, "plugin.json"));
  const skills = plugin.extensions["net.agentdoc.package"].build.skills;
  for (const [slug, { scripts = [], references = [] }] of Object.entries(skills)) {
    for (const s of [...scripts, ...references]) {
      const to = join(root, "home", pkg, "skills", slug, s);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(AGENT, s)));
    }
  }
  for (const d of ["records", "work", "jobs"]) mkdirSync(join(root, d), { recursive: true });
  const mesh = join(root, "fake-mesh.json");
  writeFileSync(mesh, JSON.stringify(script));
  return { root, home: join(root, "home"), pkg, records: join(root, "records"), work: join(root, "work"), mesh, log: join(root, "fake-mesh.log") };
}
