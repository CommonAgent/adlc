// Read the architecture record, when one was given, and the owner's spending
// limit, wherever it was said. A step with no judgment in it.
//
// The architecture record is the solution architect's (Architecture and
// Design, stage 02): the systems the agent reaches in plain words, the
// product bound to each in each environment, the dependencies, the agent's
// kind, the limits on cost, speed, data and trust, each decision with its
// reason, and the egress beyond the derived set. It is Markdown, written for a
// person, so it is read by its headings: a heading that says systems, limits,
// egress or decisions, and the table rows or bullets under it. Nothing here
// fails on a record laid out another way; what it could not find is said.
//
// The review is made without the record when none is given, and says so: the
// package's own declaration is then the only statement of what it reaches,
// and nothing checks it against what the agent was designed to reach.
//
//   needs: node >= 22
//   import { readArchitecture, spendingLimit } from "./architecture.mjs"

const trim = (s) => String(s ?? "").trim();

/** The record's sections: heading text (lower case) -> the lines under it. */
export function sections(md = "") {
  const out = [];
  let cur = { heading: "", level: 0, lines: [] };
  for (const line of String(md).split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      out.push(cur);
      cur = { heading: h[2].toLowerCase(), level: h[1].length, lines: [] };
    } else cur.lines.push(line);
  }
  out.push(cur);
  return out.filter((s) => s.heading || s.lines.some((l) => trim(l)));
}

/** The lines of every section whose heading matches, sub-sections included. */
function under(secs, re) {
  const lines = [];
  for (let i = 0; i < secs.length; i++) {
    if (!re.test(secs[i].heading)) continue;
    lines.push(...secs[i].lines);
    for (let j = i + 1; j < secs.length && secs[j].level > secs[i].level; j++) lines.push(...secs[j].lines);
  }
  return lines;
}

/** Table rows as arrays of cells, the header and the rule left out. */
function rows(lines) {
  const t = lines.filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map(trim));
  return t.filter((r, i) => !(r.every((c) => /^:?-{2,}:?$/.test(c))) && !(i === 0 && t[1]?.every((c) => /^:?-{2,}:?$/.test(c))));
}
const bullets = (lines) => lines.map((l) => /^\s*[-*+]\s+(.+)$/.exec(l)?.[1]).filter(Boolean).map(trim);
const bare = (s) => trim(s).replace(/^[`*_]+|[`*_]+$/g, "").replace(/[.:]$/, "");

const HOST = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b/gi;
const NOT_A_HOST = /\.(?:md|json|mjs|js|py|sh|txt|html)$/i;

/** The record, as the review uses it. `given` is false when there is none. */
export function readArchitecture(md) {
  if (!trim(md)) return { given: false, systems: [], egress: { hosts: [], none: false, lines: [] }, limits: [], decisions: 0, dependencies: [] };
  const secs = sections(md);
  const sysLines = under(secs, /\bsystems?\b/);
  const fromRows = rows(sysLines).map((r) => bare(r[0])).filter((n) => /^[a-z][a-z0-9-]*$/.test(n));
  const fromBullets = bullets(sysLines).map((b) => bare((/^`([^`]+)`/.exec(b)?.[1]) ?? b.split(/[\s:,(—-]/)[0])).filter((n) => /^[a-z][a-z0-9-]*$/.test(n));
  const systems = [...new Set([...fromRows, ...fromBullets])];

  const egressLines = under(secs, /\begress\b|\bnetwork\b|\bdestinations?\b/);
  const hosts = new Set();
  for (const l of egressLines) for (const m of l.matchAll(HOST)) if (!NOT_A_HOST.test(m[1])) hosts.add(m[1].toLowerCase());
  const none = egressLines.some((l) => /\b(?:needs|reaches|requires)\s+none\b|\bno further destinations?\b|\bnone beyond\b/i.test(l));

  const limitLines = under(secs, /\blimits?\b|\bcost\b|\bspend/).map(trim).filter((l) => l && !/^\|?\s*:?-{2,}/.test(l));
  const limits = limitLines.filter((l) => MONEY.test(l)).map((l) => l.replace(/^[-*+]\s+/, "").replace(/^\||\|$/g, "").replace(/\s*\|\s*/g, " | "));

  const decLines = under(secs, /\bdecisions?\b/);
  const decisions = Math.max(rows(decLines).length, bullets(decLines).length, secs.filter((s) => /^decision\b|^adr\b/.test(s.heading)).length);
  const dependencies = bullets(under(secs, /\bdependenc/)).concat(rows(under(secs, /\bdependenc/)).map((r) => r.join(" — ")));
  return { given: true, systems, egress: { hosts: [...hosts].sort(), none, lines: egressLines.map(trim).filter(Boolean) }, limits, decisions, dependencies };
}

const MONEY = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars?|cents?)\b)/i;

/** The owner's spending limit, as said in the message (`spending limit: 5 USD
 *  a day`), or else in the architecture record's limits. Returns
 *  { said, from } or null. A number in passing is not taken: a limit read off
 *  a sentence that was not stating one is a limit nobody set. */
export function spendingLimit(message = "", arch = null) {
  const m = /^\s*(?:[-*]\s*)?(?:(?:the\s+)?owner'?s?\s+)?(?:spending|spend|budget|cost)\s*(?:limit|ceiling|cap)?\s*[:=]\s*(.+?)\s*$/im.exec(String(message));
  if (m && MONEY.test(m[1])) return { said: bare(m[1]), from: "the message" };
  if (m && /\bnone\b|\bno limit\b|\bunlimited\b/i.test(m[1])) return null;
  const fromRecord = arch?.limits?.find((l) => /spend|cost|budget|limit|ceiling/i.test(l)) ?? arch?.limits?.[0];
  if (fromRecord) return { said: fromRecord, from: "the architecture record's limits" };
  return null;
}
