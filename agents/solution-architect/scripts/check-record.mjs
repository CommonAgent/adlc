// Check the record: put the architecture and its bindings together as the
// record, and hold it to the Architecture part's "done when" before it goes.
//
// Two of the three conditions are this step's to check: every system is named
// and bound in each environment the agent will run in, and every decision has
// a reason. The third, that every design step uses only the systems the record
// named, is checked when the design comes back, by the spec writer. A record
// with a question open is delivered, so the person can read it and answer,
// and it says plainly that it is not finished: "done: no" in its header and a
// sentence at its top.
//
// In a revision it also writes what changed: the lines of the record that are
// new or gone, and the reason for each decision that changed.
//
//   needs: node >= 22
//   ASKED=<asked.json> NAMED=<named.json> BOUND=<bound.json> RECORDS=<records folder> node check-record.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bodyOf, parseRecord, renderRecord } from "./architecture-record.mjs";
import { ADDRESS_RE, CREDENTIAL_RE, MODEL_NAME_RE, productWords } from "./standard.mjs";
import { loadSchemas, standardAt, standingAssetsOf, standingProblems } from "./standing.mjs";

const trim = (s) => String(s ?? "").trim();

/** The record's facts, from the three records before it. `table` is the
 *  list of standing-asset kinds and the house rule (standards/
 *  standing-asset-schemas.json), read where this agent pins it. */
export function recordOf({ asked, named, bound, table = loadSchemas() }) {
  const arch = named.architecture ?? {};
  const questions = [];
  const seen = new Set();
  for (const q of [...(named.questions ?? []), ...(bound.questions ?? [])]) {
    if (!seen.has(q.key) && !(q.key in (asked.answers ?? {}) && !/^binding-/.test(q.key))) { seen.add(q.key); questions.push(q); }
  }
  // The binding decisions are code's and come first; a revision's answer
  // carries the earlier record's decisions back, so one said twice is kept once.
  const decisions = [];
  const said = new Set();
  for (const d of [...(bound.decisions ?? []), ...(arch.decisions ?? [])]) {
    const k = trim(d?.decided).toLowerCase();
    if (!k || said.has(k)) continue;
    if (!d.from_binding && /^bind [a-z0-9-]+ to\b/.test(k)) continue;
    said.add(k);
    decisions.push(d);
  }
  const rec = {
    title: trim(arch.title) || "an agent",
    // The person's words are quoted, minus anything a record never carries.
    statement: String(asked.statement ?? "")
      .replace(MODEL_NAME_RE, "(a model's name, left to the binding)")
      .replace(CREDENTIAL_RE, "(a credential, left out)")
      .replace(ADDRESS_RE, "(an address, supplied at Deploy)"),
    environments: bound.environments,
    systems: bound.systems,
    kind: arch.kind,
    dependencies: arch.dependencies ?? [],
    limits: arch.limits ?? {},
    egress: arch.egress ?? [],
    egress_policy: bound.egress_policy ?? {},
    formats: arch.formats ?? [],
    standing_assets: standingAssetsOf(arch.formats ?? [], table, asked.answers?.["standing-assets"]),
    settings: arch.settings ?? [],
    decisions,
    questions,
  };
  rec.done = doneOf(rec).done;
  return rec;
}

/** Whether the record is finished, and every reason it is not. */
export function doneOf(rec, vocabulary = [], table = loadSchemas()) {
  const problems = [];
  const products = productWords(vocabulary);
  for (const s of rec.systems ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(s.name) || products.has(s.name)) problems.push(`${s.name} is not named in plain system words`);
    for (const env of rec.environments ?? []) {
      const b = s.bindings?.[env];
      if (!b || b.unbound) problems.push(`${s.name} is not bound in ${env}`);
      else if (!trim(b.product)) problems.push(`${s.name} has no product in ${env}`);
    }
  }
  for (const d of rec.decisions ?? []) if (!trim(d.why)) problems.push(`the decision "${trim(d.decided)}" has no reason`);
  // A record that could not decide them (the list was not read) is not done.
  problems.push(...standingProblems(rec.standing_assets, table));
  if (!trim(rec.kind?.kind)) problems.push("the kind is not settled");
  if ((rec.questions ?? []).length) problems.push(`${rec.questions.length} question${rec.questions.length === 1 ? " is" : "s are"} open`);
  return { done: problems.length === 0, problems };
}

/** The standards this record was written under, as a run record cites a
 *  standing asset: its schema, the digest of the bytes read, and its layer. */
export function standardsCited() {
  const out = [];
  for (const name of ["architecture-standard.md", "standing-asset-schemas.json"]) {
    const p = standardAt(name);
    if (!p) continue;
    const bytes = readFileSync(p);
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(bytes.toString("utf8"))?.[1] ?? "";
    const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(head)?.[1]?.trim() ?? null;
    // The JSON list has no front matter; its own format word stands in.
    const format = name.endsWith(".json") ? (() => { try { const j = JSON.parse(bytes.toString("utf8")); return j.standing_asset_schemas ? `standing_asset_schemas ${j.standing_asset_schemas}` : null; } catch { return null; } })() : null;
    out.push({ file: name, schema: field("schema"), ...(format ? { format } : {}), version_digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, layer: field("layer") ?? "publisher" });
  }
  return out;
}

/** What the record must never carry, read off its own text. Empty when it
 *  carries none of them. A known standing-asset schema is not an address. */
export function forbiddenIn(text, table = loadSchemas()) {
  const out = [];
  // A standing asset's schema is a name with the version in it, never an
  // address the agent reaches: the known kinds are taken out before the
  // address check reads the text.
  for (const k of table?.schemas ?? []) text = String(text).split(k.schema).join("(schema)");
  for (const m of String(text).matchAll(MODEL_NAME_RE)) out.push(`the record names the model ${m[0]}`);
  for (const m of String(text).matchAll(ADDRESS_RE)) out.push(`the record carries the address ${m[0]}`);
  if ([...String(text).matchAll(CREDENTIAL_RE)].length) out.push("the record carries something that looks like a credential");
  return out;
}

/** The lines of `after` that are not in `before`, and the reverse, in order.
 *  A longest common subsequence over lines, which is all a person needs to
 *  see what moved. */
export function lineChanges(before, after) {
  const a = String(before).split(/\r?\n/);
  const b = String(after).split(/\r?\n/);
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i += 1; j += 1; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { if (trim(b[j])) out.push({ now: b[j] }); j += 1; }
    else { if (trim(a[i])) out.push({ was: a[i] }); i += 1; }
  }
  return out;
}

/** What changed between two records, as Markdown: the changed lines, then
 *  the reason for each decision that is new or different. */
export function whatChanged(beforeText, afterText, rec) {
  const changes = lineChanges(bodyOf(beforeText), bodyOf(afterText));
  const before = bodyOf(beforeText);
  const changedDecisions = (rec.decisions ?? []).filter((d) => !before.includes(trim(d.decided)));
  const lines = ["---", `record: what-changed-v1`, `changed_lines: ${changes.length}`, `changed_decisions: ${changedDecisions.length}`, "---", "", "# What changed in the architecture record", "", "## Changed lines", ""];
  if (!changes.length) lines.push("None. The record reads as it did.");
  for (const c of changes) lines.push(c.now !== undefined ? `- now: ${trim(c.now)}` : `- was: ${trim(c.was)}`);
  lines.push("", "## Why", "");
  if (!changedDecisions.length) lines.push("No decision changed.");
  for (const d of changedDecisions) lines.push(`- ${trim(d.decided)}: ${trim(d.why)}`);
  return { text: lines.join("\n") + "\n", lines: changes.length, decisions: changedDecisions.length };
}

/** What is still open, as Markdown, for the person to answer. */
export function stillOpenText(rec) {
  return ["---", "record: still-open-v1", `questions: ${rec.questions.length}`, "---", "", `# Still open in the architecture record: ${rec.title}`, "", "## Questions", "",
    ...rec.questions.map((q) => `- ${q.key}: ${q.question}`), "", "## How to answer", "",
    "Send the record back with one line per answer, `key: answer`, under the key each question names. Everything else in your message is read as a change.", ""].join("\n");
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { ASKED, NAMED, BOUND, RECORDS } = process.env;
  if (!ASKED || !NAMED || !BOUND || !RECORDS) { console.error("ASKED, NAMED, BOUND and RECORDS are required"); process.exit(2); }
  try {
    const asked = JSON.parse(readFileSync(ASKED, "utf8"));
    const named = JSON.parse(readFileSync(NAMED, "utf8"));
    const bound = JSON.parse(readFileSync(BOUND, "utf8"));
    const rec = recordOf({ asked, named, bound });
    const done = doneOf(rec, asked.defaults?.systems ?? []);
    rec.done = done.done;
    const text = renderRecord(rec);
    const forbidden = forbiddenIn(text);
    if (forbidden.length) {
      console.log(JSON.stringify({ ok: false, code: 1, reply: `The record was not delivered, because ${forbidden.join("; ")}. Nothing a record carries may be a model's name, an address or a credential; this is a fault in this agent, not in what you sent.` }));
      process.exit(1);
    }
    mkdirSync(RECORDS, { recursive: true });
    writeFileSync(join(RECORDS, "record.md"), text);
    if (rec.questions.length) writeFileSync(join(RECORDS, "still-open.md"), stillOpenText(rec));
    let changed = null;
    if (asked.revision && asked.earlier?.text) {
      changed = whatChanged(asked.earlier.text, text, rec);
      // The earlier record may be a person's edited file: what is quoted from it
      // carries nothing a record never carries.
      // A known standing-asset schema is a name and is kept as it is.
      const schemas = (loadSchemas()?.schemas ?? []).map((k) => k.schema);
      let scrubbed = changed.text;
      const mark = (i) => `\u0000schema ${i}\u0000`;
      schemas.forEach((x, i) => { scrubbed = scrubbed.split(x).join(mark(i)); });
      scrubbed = scrubbed.replace(MODEL_NAME_RE, "(a model's name)").replace(CREDENTIAL_RE, "(a credential, left out)").replace(ADDRESS_RE, "(an address)");
      schemas.forEach((x, i) => { scrubbed = scrubbed.split(mark(i)).join(x); });
      writeFileSync(join(RECORDS, "what-changed.md"), scrubbed);
    }
    const header = parseRecord(text);
    writeFileSync(join(RECORDS, "checks.json"), JSON.stringify({
      checks: "v1", done: done.done, problems: done.problems, systems: header.systems, environments: header.environments,
      standing_assets: header.standing_assets,
      standards: standardsCited(),
      record_sha256: createHash("sha256").update(text).digest("hex"),
      ...(changed ? { changed_lines: changed.lines, changed_decisions: changed.decisions } : {}),
    }, null, 2) + "\n");
    console.log(JSON.stringify({ ok: true, code: 0, record: join(RECORDS, "record.md"), done: done.done, problems: done.problems }));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
