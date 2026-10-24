// The source credit (owner's standard practice, 2026-09-30): anything made
// from somebody's content opens by crediting the source (its title, its
// author, the publisher or site, the date and the link) and links back to it
// at the end. Without it the thing reads as plagiarism.
//
// One copy of this file lives in every package that makes something from
// sources (scripts/credit.mjs). The canonical copy is
// fleet-manager/agentbuilder/shared/credit.mjs, and a services test keeps the
// copies identical and reading pages the way the platform's own reader does
// (services/src/compose/explainer-credit.ts). Node 22, nothing outside node.
//
// A credit is { title, author, publisher, date, url }: author and date are
// null when the source does not say; the rest are required.
//
// Nothing in a credit is cut (2026-10-04, docs/handoff-audit.md E23): a long
// title, author, publisher or address is kept whole. pageMeta reads every
// metadata source a page may carry (og:, article:, twitter:, JSON-LD with
// @graph, mainEntity and @id references, meta author/date/dc.*/citation_*/
// parsely-*, itemprop, rel=author and <time datetime>).

const isRec = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date as YYYY-MM-DD, from an ISO date or time; null when it is not one. */
export function normaliseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "2026-09-29" as a person says it: "September 29, 2026". Empty when it is not a date. */
export function creditDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The site's name from its address: "www.thisisfrontier.ai" reads "thisisfrontier.ai". */
export function siteOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/**
 * The credit cleaned, or the problems with it. Accepts the platform's shape
 * ({title, author, publisher, date, url}) and the transcriber's
 * ({title, author, site, published, link}).
 */
export function readCredit(v) {
  if (!isRec(v)) return { ok: false, problems: ["The credit is missing: the title, the author, the publisher or site, the date and the link."] };
  const url = text(v.url) || text(v.link);
  const credit = {
    title: text(v.title),
    author: text(v.author) || null,
    publisher: text(v.publisher) || text(v.site) || siteOf(url),
    date: normaliseDate(text(v.date) || text(v.published)),
    url,
  };
  const problems = [];
  if (!credit.title) problems.push("The credit needs the source's title.");
  if (!credit.publisher) problems.push("The credit needs the publisher or the site.");
  if (!/^https?:\/\//.test(credit.url)) problems.push("The credit needs the original's link, starting with http.");
  return problems.length ? { ok: false, problems } : { ok: true, credit };
}

/** The credits usable among `list`, each address once, in order. */
export function cleanCredits(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : [list]) {
    const got = readCredit(v);
    if (got.ok && !out.some((c) => c.url === got.credit.url)) out.push(got.credit);
  }
  return out;
}

/**
 * A credit for a bare link, when nothing but the address is known: the page's
 * name from the last part of its path ("Macintosh_128K" reads "Macintosh
 * 128K"), else the site; the site as the publisher; no author, no date.
 */
export function creditFromUrl(url, title = "") {
  const site = siteOf(url);
  if (!site || !/^https?:\/\//.test(String(url))) return null;
  let name = text(title);
  if (!name) {
    try {
      const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
      name = decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    } catch { name = ""; }
  }
  const got = readCredit({ title: name || site, author: null, publisher: site, date: null, url });
  return got.ok ? got.credit : null;
}

/** One credit as the sentence it opens with: "'Title' by Author, published by Site on May 1, 2026". */
export function creditWords(c) {
  const when = creditDate(c.date);
  return `'${c.title}'${c.author ? ` by ${c.author}` : ""}, published by ${c.publisher}${when ? ` on ${when}` : ""}`;
}

/**
 * The opening sentence for what was made: "This brief is based on 'Title' by
 * Author, published by Site on May 1, 2026." With several sources, each is
 * named in turn.
 */
export function creditSentence(credits, what = "This", verb = "is") {
  const list = cleanCredits(credits);
  if (!list.length) return "";
  if (list.length === 1) return `${what} ${verb} based on ${creditWords(list[0])}.`;
  return `${what} ${verb} based on ${list.length} sources: ${list.map(creditWords).join("; ")}.`;
}

/** The credit as plain text lines, to open a text: the sentence, then each link. */
export function creditText(credits, what = "This", verb = "is") {
  const list = cleanCredits(credits);
  if (!list.length) return [];
  return [creditSentence(list, what, verb), ...list.map((c) => `Link: ${c.url}`)];
}

/** The link back as plain text lines, to close a text. */
export function linkBackText(credits) {
  const list = cleanCredits(credits);
  if (!list.length) return [];
  return list.length === 1 ? [`Read the original: ${list[0].url}`] : ["Read the originals:", ...list.map((c) => `- ${c.url}`)];
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/**
 * The credit as the first block of a page. Its data-source-credit attribute
 * holds the credits as JSON, so a checker (and the platform) reads them back
 * without guessing, and the page gains no script.
 */
export function creditHtml(credits, what = "This", verb = "is") {
  const list = cleanCredits(credits);
  if (!list.length) return "";
  const links = list.map((c) => `<li><a href="${esc(c.url)}" rel="noopener">${esc(c.title)}</a>${c.author ? ` by ${esc(c.author)}` : ""}, ${esc(c.publisher)}${c.date ? `, ${esc(creditDate(c.date))}` : ""}</li>`).join("");
  return `<section class="source-credit" data-source-credit="${esc(JSON.stringify(list))}"><p>${esc(creditSentence(list, what, verb))}</p><ul>${links}</ul></section>`;
}

/** The link back as the last block of a page. */
export function linkBackHtml(credits) {
  const list = cleanCredits(credits);
  if (!list.length) return "";
  const one = list.length === 1;
  return `<footer class="source-link" data-source-link><p>${one ? "Read the original" : "Read the originals"}:</p><ul>${list.map((c) => `<li><a href="${esc(c.url)}" rel="noopener">${esc(c.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></li>`).join("")}</ul></footer>`;
}

/** The credits a page declares in its source-credit block; empty when it has none. */
export function pageCredits(html) {
  const m = /<section\b[^>]*\bdata-source-credit\s*=\s*"([^"]*)"/i.exec(String(html ?? ""));
  if (!m) return [];
  try { return cleanCredits(JSON.parse(decode(m[1]))); } catch { return []; }
}

/**
 * Why a page does not credit its source, or nothing. It must carry its
 * credits, open its content with the credit block (nothing a person reads
 * comes before it inside <main>, or <body> when there is no <main>, but the
 * page's own title), and close it with the link back naming every credit's
 * address.
 */
export function pageCreditProblems(html) {
  const s = String(html ?? "");
  const credits = pageCredits(s);
  const p = [];
  if (!credits.length) return ["The page does not credit its source: it needs the title, the author, the publisher or site, the date and the link, first."];
  const body = /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(s)?.[1] ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(s)?.[1] ?? s;
  const at = body.search(/<section\b[^>]*data-source-credit/i);
  const before = at < 0 ? "" : body.slice(0, at).replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, "").replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (at < 0) p.push("The page must open with its credit block.");
  // cut-ok: error text quoting where the page starts; the page itself is unchanged.
  else if (before) p.push(`The page must open with its credit; it opens with "${before.slice(0, 60)}".`);
  const foot = body.search(/<footer\b[^>]*data-source-link/i);
  if (foot < 0) p.push("The page must close with a link back to the original.");
  else {
    const tail = body.slice(foot);
    for (const c of credits) if (!tail.includes(`href="${esc(c.url)}"`)) p.push(`The link back must name ${c.url}.`);
  }
  return p;
}

/**
 * Why a text does not credit its source, or nothing: its first line that is
 * not blank or a heading must say what it is based on, naming each credit's
 * title, and each credit's address must appear again after the last line of
 * content (in its closing lines).
 */
export function textCreditProblems(body, credits) {
  const list = cleanCredits(credits);
  if (!list.length) return ["The text does not credit its source: it needs the title, the author, the publisher or site, the date and the link, first."];
  const lines = String(body ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => !/^#/.test(l)) ?? "";
  const p = [];
  if (!/\bbased on\b/i.test(first)) p.push("The text must open by saying what it is based on.");
  for (const c of list) if (!first.includes(c.title)) p.push(`The opening credit must name '${c.title}'.`);
  const tail = lines.slice(-Math.max(3, list.length + 2)).join("\n");
  for (const c of list) if (!tail.includes(c.url)) p.push(`The text must close with a link back to ${c.url}.`);
  return p;
}

// ── reading the credit off a page's own metadata ────────────────────────────

const decode = (s) => String(s ?? "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Every <meta> tag's value by its name, property or itemprop (lower case), each value in page order. */
function metaLists(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /\b(?:name|property|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = content ? decode(content[1] ?? content[2] ?? "") : "";
    if (!key || !value) continue;
    if (!out.has(key)) out.set(key, []);
    if (!out.get(key).includes(value)) out.get(key).push(value);
  }
  return out;
}

/**
 * Every JSON-LD object on the page, with those inside @graph, mainEntity and
 * mainEntityOfPage, and a map of them by @id so a reference ({"@id": ...})
 * reads as the object it names.
 */
function jsonLd(html) {
  const out = [];
  const byId = new Map();
  const add = (v, depth = 0) => {
    if (depth > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => add(x, depth)); return; }
    if (!isRec(v)) return;
    out.push(v);
    if (typeof v["@id"] === "string" && Object.keys(v).length > 1 && !byId.has(v["@id"])) byId.set(v["@id"], v);
    for (const k of ["@graph", "mainEntity", "mainEntityOfPage"]) if (v[k] && typeof v[k] === "object") add(v[k], depth + 1);
  };
  for (const m of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { add(JSON.parse(m[1])); } catch { /* not JSON */ }
  }
  return { all: out, byId };
}

const ldTypeOf = (o) => [].concat(o?.["@type"] ?? []).map(String).join(" ");

/** The name a JSON-LD value gives: a string, an object's name (an @id reference followed), or a list joined. */
function nameIn(v, byId, depth = 0) {
  if (depth > 3) return "";
  if (typeof v === "string") return /^https?:|^#|^_:/.test(v.trim()) && byId?.has(v.trim()) ? nameIn(byId.get(v.trim()), byId, depth + 1) : decode(v);
  if (Array.isArray(v)) return [...new Set(v.map((x) => nameIn(x, byId, depth + 1)).filter(Boolean))].join(", ");
  if (isRec(v)) {
    if (typeof v.name === "string" && v.name.trim()) return decode(v.name);
    if (typeof v["@id"] === "string" && byId?.has(v["@id"]) && byId.get(v["@id"]) !== v) return nameIn(byId.get(v["@id"]), byId, depth + 1);
    const parts = [v.givenName, v.familyName].filter((x) => typeof x === "string" && x.trim());
    return parts.length ? decode(parts.join(" ")) : "";
  }
  return "";
}

const ITEMPROPS = new Set(["headline", "description", "author", "publisher", "datepublished", "datemodified"]);
/** The values an element carries by itemprop (outside <meta>), for the credit's fields: its content or datetime attribute, else its words. */
function itemprops(html) {
  const s = String(html);
  const out = new Map();
  for (const m of s.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bitemprop\s*=\s*["']([^"']+)["'][^>]*)>/gi)) {
    const keys = m[3].toLowerCase().split(/\s+/).filter((k) => ITEMPROPS.has(k) && !out.has(k));
    if (!keys.length || m[1].toLowerCase() === "meta") continue;
    const attr = /\b(?:content|datetime)\s*=\s*"([^"]*)"|\b(?:content|datetime)\s*=\s*'([^']*)'/i.exec(m[2]);
    let value = attr ? decode(attr[1] ?? attr[2] ?? "") : "";
    if (!value) {
      const close = new RegExp(`</${m[1]}\\s*>`, "gi");
      close.lastIndex = m.index + m[0].length;
      const c = close.exec(s);
      value = c ? decode(s.slice(m.index + m[0].length, c.index).replace(/<[^>]+>/g, " ")) : "";
    }
    if (value) for (const k of keys) out.set(k, value);
  }
  return out;
}

function textLines(html, max = 200) {
  return String(html)
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .split(/<[^>]+>/)
    .map(decode)
    .filter(Boolean)
    // cut-ok: a search window for the byline near the top; nothing is handed on from here but the name found.
    .slice(0, max);
}

const SHORT_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** "Sep 30, 2026" or "September 30, 2026" as YYYY-MM-DD; null when it is not one. */
export function spelledDate(s) {
  const m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? (\d{1,2}),? (20\d{2})\b/i.exec(String(s ?? ""));
  if (!m) return null;
  const key = m[1].toLowerCase();
  const month = SHORT_MONTHS[key.slice(0, key === "sept" ? 4 : 3)] ?? 0;
  return normaliseDate(`${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`);
}

const PERSON = /^[A-Z][\p{L}'.-]+(?: [A-Z][\p{L}'.-]+){1,3}$/u;
/** The author and date the page shows on screen when its metadata does not. */
export function visibleCredit(html) {
  const lines = textLines(html);
  let author = null;
  for (let i = 0; i < lines.length && !author; i++) {
    const l = lines[i];
    const inline = /^(?:by|written by|author:?)\s+(.+)$/i.exec(l);
    if (inline && PERSON.test(inline[1].trim())) author = inline[1].trim();
    else if (/^(author|authors|written by|by)$/i.test(l) && PERSON.test(lines[i + 1] ?? "")) author = lines[i + 1];
  }
  let date = null;
  // cut-ok: a search window for the first date near the top; only the date found is handed on.
  for (const l of lines.slice(0, 80)) { date = spelledDate(l); if (date) break; }
  return { author, date };
}

/** A date read from any form a page writes one in: ISO, or spelled out ("Oct 3, 2026"). */
const anyDate = (s) => normaliseDate(String(s ?? "").trim().replace(/^(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3")) ?? spelledDate(s);

/** The address of the first <link> whose rel names `rel`. */
function linkHref(html, rel) {
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    if (!new RegExp(`\\brel\\s*=\\s*["'][^"']*\\b${rel}\\b`, "i").test(m[0])) continue;
    const href = /\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/i.exec(m[0]);
    if (href) return decode(href[1] ?? href[2] ?? "");
  }
  return "";
}

const absolute = (href, base) => { try { return href ? new URL(href, base).href : ""; } catch { return ""; } };

/**
 * Everything a page says about itself, whole: { title, description, author,
 * publisher, published, modified, canonical, kind }. Read from og: and
 * article: and twitter: tags, JSON-LD (an Article, NewsArticle, BlogPosting
 * or other article type first, else a WebPage, with those inside @graph,
 * mainEntity and mainEntityOfPage, and an author or publisher given by @id
 * followed), meta author, date, dc.*, citation_* and parsely-* tags, itemprop,
 * a rel=author link, <time datetime>, and where the metadata is silent the
 * byline and first date the page shows near its top. published and modified
 * are YYYY-MM-DD. What the page does not say is null; publisher falls back to
 * the site and canonical to the address read.
 */
export function pageMeta(html, url) {
  const s = String(html ?? "");
  const lists = metaLists(s);
  const meta = (k) => lists.get(k)?.[0] ?? "";
  const all = (k) => lists.get(k) ?? [];
  const props = itemprops(s);
  const { all: ld, byId } = jsonLd(s);
  const article = ld.find((o) => /article|posting|report|blog/i.test(ldTypeOf(o)))
    ?? ld.find((o) => /webpage|aboutpage|collectionpage|itempage|profilepage|faqpage|qapage/i.test(ldTypeOf(o)))
    ?? ld.find((o) => o.headline || o.datePublished) ?? {};
  const org = ld.find((o) => /organization|website/i.test(ldTypeOf(o)));
  const name = (v) => nameIn(v, byId);
  const notUrl = (v) => (v && !/^https?:/i.test(v) ? v : "");
  const first = (...vs) => vs.map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean) ?? "";

  const title = first(meta("og:title"), name(article.headline), meta("twitter:title"), meta("citation_title"), meta("dc.title"),
    meta("parsely-title"), props.get("headline"), decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] ?? ""), name(article.name));
  const description = first(meta("description"), meta("og:description"), meta("twitter:description"),
    typeof article.description === "string" ? decode(article.description.replace(/<\/?(p|div|li|ul|ol|br|h[1-6]|tr|td|section|blockquote)\b[^>]*>/gi, " ").replace(/<[^>]+>/g, "")) : "", meta("dc.description"), meta("citation_abstract"), props.get("description"));
  const relAuthor = decode(/<a\b[^>]*rel\s*=\s*["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(s)?.[1]?.replace(/<[^>]+>/g, " ") ?? "");
  const metaAuthor = first(notUrl(meta("author")), all("article:author").map(notUrl).filter(Boolean).join(", "),
    all("citation_author").join("; "), all("dc.creator").join("; "), meta("dc.contributor"), meta("parsely-author"), meta("sailthru.author"),
    notUrl(props.get("author") ?? ""), relAuthor, meta("twitter:creator").replace(/^@/, ""));
  const author = first(notUrl(name(article.author)), metaAuthor) || null;
  const publisher = first(meta("og:site_name"), name(article.publisher), org ? name(org) : "", meta("citation_publisher"),
    meta("citation_journal_title"), meta("dc.publisher"), meta("application-name"), props.get("publisher")) || siteOf(url);
  const published = [meta("article:published_time"), String(article.datePublished ?? ""), meta("og:published_time"), meta("date"), meta("dc.date"),
    meta("dc.date.issued"), meta("dcterms.date"), meta("dcterms.issued"), meta("citation_publication_date"), meta("citation_date"),
    meta("parsely-pub-date"), meta("sailthru.date"), meta("pubdate"), meta("publish-date"), meta("publication_date"), props.get("datepublished"),
    /<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/i.exec(s)?.[1] ?? ""].map(anyDate).find(Boolean) ?? null;
  const modified = [meta("article:modified_time"), meta("og:updated_time"), String(article.dateModified ?? ""), meta("dc.date.modified"),
    meta("dcterms.modified"), meta("last-modified"), props.get("datemodified")].map(anyDate).find(Boolean) ?? null;
  const seen = !author || !published ? visibleCredit(s) : { author: null, date: null };
  const canon = absolute(first(meta("og:url"), linkHref(s, "canonical")), url);
  const kind = first(meta("og:type"), ldTypeOf(article), /\bitemtype\s*=\s*["']https?:\/\/schema\.org\/(\w+)/i.exec(s)?.[1] ?? "") || null;
  return {
    title: title || null,
    description: description || null,
    author: author ?? seen.author ?? null,
    publisher,
    published: published ?? seen.date ?? null,
    modified,
    canonical: /^https?:\/\//.test(canon) ? canon : url,
    kind,
  };
}

/**
 * The credit from a page's own metadata (pageMeta), read the way the
 * platform reads it (compose/explainer-credit.ts creditFromHtml): its title,
 * author, publisher, published date and canonical address. Null when the page
 * gives no title.
 */
export function creditFromHtml(html, url) {
  const m = pageMeta(html, url);
  if (!m.title) return null;
  const got = readCredit({ title: m.title, author: m.author, publisher: m.publisher, date: m.published, url: m.canonical });
  return got.ok ? got.credit : null;
}
