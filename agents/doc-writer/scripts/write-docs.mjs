// Write the documentation: every line a template from templates.mjs, filled
// from one place in one source, and marked with that place.
//
// There is no model here and nothing to tune. What the agent declares is laid
// out for a person who has to use it: what it does, where to send it work,
// what each job takes and hands back and how it is done, what it will not do,
// what it reaches, costs and leaves behind, what verdicts and records say
// about it, and, gathered at the end, everything the sources are silent on.
//
// The declaration is the descriptor when one was given, and otherwise the
// AgentDoc, which carries the descriptor's words in its own sections. The
// identity and the address come only from the AgentDoc.
//
//   needs: node >= 22
//   import { writeDocs, declarationOf, offeringOf } from "./write-docs.mjs"
import { KIND_WORDS, isEmpty, linesOf, resolvePath, textLines } from "./given.mjs";
import { CREDENTIAL, GIVEN, LEGEND, code, esc, render, renderAll, silence } from "./templates.mjs";

export const WRITER = "doc-writer 0.1.0";
/** The most lines of one record shown as an example. */
export const EXAMPLE_LINES = 40;


/** Where the declaration is read from, and the paths of its parts there. */
export function declarationOf(sources) {
  const d = sources.find((s) => s.kind === "descriptor");
  if (d) return { src: d, root: d.json, offerings: "offerings", refusals: "refusals", escalates: "escalates", records: "records", systems: "systems", does: "does" };
  const a = sources.find((s) => s.kind === "agentdoc");
  if (a) return { src: a, root: a.json, offerings: "sections.sells.offerings", refusals: "sections.refuses.statement", escalates: "sections.refuses.hands_over", records: "sections.leaves.records", systems: "sections.reaches.systems", does: "sections.identity.description" };
  return null;
}

const oneLine = (s) => typeof s === "string" && s.trim() !== "" && !/[\r\n]/.test(s);

/** The title and the header's agent and version lines: a source's value only
 *  when it is one line, so a value can never break the header. The check
 *  builds the same lines. */
export function headerOf(sources) {
  const doc = sources.find((s) => s.kind === "agentdoc");
  const dsrc = sources.find((s) => s.kind === "descriptor");
  const name = doc?.json?.sections?.identity?.name;
  const handle = doc?.json?.subject?.handle;
  const version = dsrc?.json?.agent_version ?? (Array.isArray(doc?.json?.sources) ? doc.json.sources : []).find((s) => s?.id === "descriptor")?.agent_version;
  return {
    title: `# ${oneLine(name) ? name.trim() : "The agent"}`,
    agent: `agent: ${oneLine(handle) ? handle.trim() : "not given"}`,
    version: `version: ${oneLine(version) ? version.trim() : "not given"}`,
  };
}

/** A job's heading: its name, or its id, or its number, whichever is one line. */
export function headingOf(o, i) {
  return `### ${oneLine(o?.name) ? o.name.trim() : oneLine(o?.id) ? o.id.trim() : `Job ${i + 1}`}`;
}

/** Is a record the platform's run record (runs, completed, failed). */
export const isRunRecord = (s) => Boolean(s.json && [s.json.runs, s.json.completed, s.json.failed, s.json.window_days].every(Number.isInteger));
/** Is a record a text record headed `# ...`, such as a build record. */
export const isHeaded = (s) => s.json === undefined && /^#\s+\S/.test(String(s.text).split(/\r?\n/)[0] ?? "");
/** Does any line of a record look like a credential. */
export const hasCredential = (s) => CREDENTIAL.test(String(s.text));

/** Which offering a record is a job of, by index, or -1. A record names its
 *  offering by a top-level field (offering, offering_id, skill, job, step),
 *  by its file name, or by an offering's or a step's id quoted in it; with
 *  one offering, any job record is that offering's. Pure, and the check uses
 *  the same reading. */
export function offeringOf(record, offerings = []) {
  if (record.kind !== "record" || isRunRecord(record) || isHeaded(record)) return -1;
  const ids = offerings.map((o) => [o.id, ...(o.steps ?? []).map((s) => s.id)].filter(Boolean));
  const j = record.json && typeof record.json === "object" && !Array.isArray(record.json) ? record.json : {};
  for (const f of ["offering", "offering_id", "skill", "job", "step"]) {
    if (typeof j[f] === "string") { const i = ids.findIndex((l) => l.includes(j[f])); if (i >= 0) return i; }
  }
  // A file name names a job when the job's id stands in it whole, between
  // separators, and the longest id is tried first, so where `make` and
  // `make-a-quiz` are both jobs, `make-a-quiz.json` is make-a-quiz's.
  const pairs = ids.flatMap((l, i) => l.map((id) => [String(id).toLowerCase(), i])).sort((a, b) => b[0].length - a[0].length);
  const lower = record.name.toLowerCase();
  const byName = pairs.find(([id]) => new RegExp(`(^|[^a-z0-9])${esc(id)}([^a-z0-9]|$)`).test(lower));
  if (byName) return byName[1];
  const quoted = ids.map((l, i) => (l.some((id) => String(record.text).includes(`"${id}"`)) ? i : -1)).filter((i) => i >= 0);
  if (quoted.length === 1) return quoted[0];
  return offerings.length === 1 ? 0 : -1;
}

/** The example lines of a record: its own lines, or its JSON laid out. */
export function exampleOf(s) {
  const json = s.json !== undefined;
  const lines = json ? JSON.stringify(s.json, null, 2).split("\n") : textLines(s.text);
  const to = Math.min(lines.length, EXAMPLE_LINES);
  // The fence is longer than any run of backticks a shown line opens with, so
  // no line of the record can close it.
  const run = Math.max(0, ...lines.slice(0, to).map((l) => (/^\s*(`+)/.exec(l)?.[1].length ?? 0)));
  const fence = "`".repeat(Math.max(3, run + 1));
  return {
    mark: `${json ? "json " : ""}L1-L${to}`,
    intro: to === lines.length ? `From ${code(s.name)}:` : `From ${code(s.name)}, lines 1 to ${to} of ${lines.length}:`,
    fence, lang: json ? "json" : "text", lines: lines.slice(0, to),
  };
}

/** Write the documentation. Returns { markdown, silences } or throws when
 *  there is no declaration to write from. Pure but for the clock. */
export function writeDocs({ sources = [], leftOut = [], unreadable = [], now = new Date().toISOString() } = {}) {
  const decl = declarationOf(sources);
  if (!decl) throw new Error("there is no agent descriptor and no AgentDoc to write from");
  const doc = sources.find((s) => s.kind === "agentdoc");
  const rt = sources.find((s) => s.kind === "runtime");
  const verdicts = sources.filter((s) => s.kind === "verdict");
  const records = sources.filter((s) => s.kind === "record");
  const files = records.map((r) => r.name);

  const out = [];
  const notDocumented = [];
  const mark = (src, path) => `[${src.id}: ${path}]`;
  const line = (text, src, path, bullet = "- ") => out.push(`${bullet}${text} ${mark(src, path)}`);
  /** Every line any template gives at a place, by template id, in order. */
  const say = (ids, src, path, bullet = "- ") => {
    const { found, value } = resolvePath(src.json, path);
    if (!found) return false;
    let said = false;
    for (const id of ids) {
      for (const r of render(id, value, path, { files })) { line(r, src, path, bullet); said = true; }
    }
    return said;
  };
  /** Say it with the templates, or, when none can, show the value as written. */
  const sayOr = (ids, src, path, bullet = "- ") => say(ids, src, path, bullet) || say(["as-written"], src, path, bullet);
  /** The source's own words at a place, a line at a time. */
  const words = (src, path, bullet = "- ") => {
    const { found, value } = resolvePath(src.json, path);
    if (!found || typeof value !== "string" || !value.trim()) return false;
    const ls = linesOf(value);
    if (ls.length === 1 && value.trim() === value) line(value, src, path, bullet);
    else ls.forEach((l, i) => line(l, src, `${path}/${i}`, bullet));
    return true;
  };
  /** A silence where the place is missing or empty; where it is there in a
   *  shape nothing reads, its value as written, in the section being written. */
  const silent = (src, path) => {
    const { found, value } = resolvePath(src.json, path);
    if (found && !isEmpty(value)) { say(["as-written"], src, path); return; }
    const s = silence(src.kind, src.json, path);
    if (s) notDocumented.push(`- ${s} [${src.id}: ${path} absent]`);
  };
  const given = (text) => notDocumented.push(`- ${text} [given]`);
  const at = (src, path) => resolvePath(src.json, path);

  // Title and header.
  const dsrc = sources.find((s) => s.kind === "descriptor");
  const head = headerOf(sources);
  out.push(head.title, "");
  out.push(head.agent);
  out.push(head.version);
  out.push(`written_by: ${WRITER}`);
  out.push(`written_at: ${now}`);
  out.push("");
  for (const l of LEGEND) out.push(l);
  out.push("");
  const section = (heading, fill) => {
    const at0 = out.length;
    out.push(heading, "");
    const before = out.length;
    fill();
    if (out.length === before) out.length = at0;
    else out.push("");
  };

  if (!dsrc) given(GIVEN["no-descriptor"]());
  if (!doc) given(GIVEN["no-agentdoc"]());
  if (!rt) given(GIVEN["no-runtime"]());

  section("## What it does", () => {
    if (!words(decl.src, decl.does)) silent(decl.src, decl.does);
    if (doc) say(["identity"], doc, "sections.identity");
    if (dsrc) say(["version"], dsrc, "agent_version");
    if (doc) {
      const i = (doc.json.sources ?? []).findIndex((s) => s.id === "descriptor");
      if (i >= 0) say(["assembled-from"], doc, `sources[${i}].agent_version`);
      say(["assembled-at"], doc, "assembled_at");
    }
  });

  section("## Where to send it work", () => {
    if (!doc) return;
    if (!at(doc, "sections.access").found) silent(doc, "sections.access");
    else sayOr(["access"], doc, "sections.access");
  });

  const offerings = at(decl.src, decl.offerings).value;
  const offs = Array.isArray(offerings) ? offerings : [];
  if (!offs.length) notDocumented.push(`- ${silence(decl.src.kind, decl.root, decl.offerings) ?? `The ${decl.src.kind === "agentdoc" ? "AgentDoc" : "agent descriptor"} declares no job.`} [given]`);
  const byOffering = offs.map(() => []);
  const unplaced = [];
  for (const r of records) {
    if (hasCredential(r)) { given(GIVEN.credential(r.name)); continue; }
    const i = offeringOf(r, offs);
    if (i >= 0) byOffering[i].push(r);
    else if (!isRunRecord(r) && !isHeaded(r)) unplaced.push(r);
  }

  /** Take back a `####` heading that nothing was written under. */
  const dropEmpty = () => {
    let k = out.length;
    while (k > 0 && out[k - 1] === "") k--;
    if (k > 0 && out[k - 1].startsWith("#### ")) out.length = k - 1;
  };
  section("## How to use it", () => {
    offs.forEach((o, i) => {
      const p = `${decl.offerings}[${i}]`;
      out.push(headingOf(o, i), "");
      say(["offering"], decl.src, p);
      if (!words(decl.src, `${p}.does`)) silent(decl.src, `${p}.does`);
      if (o.trial) { say(["trial"], decl.src, `${p}.trial`); if (o.trial.limits) sayOr(["trial-limits"], decl.src, `${p}.trial.limits`); }
      out.push("");

      out.push("#### What to give it", "");
      if (Array.isArray(o.inputs) && o.inputs.length) {
        o.inputs.forEach((inp, j) => {
          const q = `${p}.inputs[${j}]`;
          sayOr(["input"], decl.src, q);
          for (const f of ["description", "about"]) words(decl.src, `${q}.${f}`, "  - ");
          say(["input-one-of", "input-given-by", "input-fields"], decl.src, q, "  - ");
        });
      } else if (Array.isArray(o.inputs)) say(["takes-nothing"], decl.src, `${p}.inputs`);
      else silent(decl.src, `${p}.inputs`);
      out.push("");

      dropEmpty();
      out.push("#### What comes back", "");
      if (Array.isArray(o.outputs) && o.outputs.length) {
        o.outputs.forEach((op, j) => {
          const q = `${p}.outputs[${j}]`;
          sayOr(["output"], decl.src, q);
          for (const f of ["description", "about"]) words(decl.src, `${q}.${f}`, "  - ");
          say(["output-working"], decl.src, q, "  - ");
        });
      } else if (Array.isArray(o.outputs)) say(["hands-back-nothing"], decl.src, `${p}.outputs`);
      else silent(decl.src, `${p}.outputs`);
      out.push("");

      dropEmpty();
      out.push("#### How it is done", "");
      if (!at(decl.src, `${p}.how`).found) silent(decl.src, `${p}.how`);
      else sayOr(["how", "how-words"], decl.src, `${p}.how`);
      out.push("");

      if (Array.isArray(o.steps) && o.steps.length) {
        dropEmpty();
        out.push("#### Its steps", "");
        o.steps.forEach((s, k) => sayOr(["step"], decl.src, `${p}.steps[${k}]`, `${k + 1}. `));
        out.push("");
      }

      dropEmpty();
      out.push("#### Examples", "");
      if (byOffering[i].length) {
        for (const r of byOffering[i]) {
          const declared = at(decl.src, decl.records).value;
          (Array.isArray(declared) ? declared : []).forEach((d, k) => {
            const q = `${decl.records}[${k}]`;
            for (const l of render("record-is", d, q, { files: [r.name] })) line(l, decl.src, q);
          });
          const ex = exampleOf(r);
          out.push(`${ex.intro} [${r.id}: ${ex.mark}]`, "", `${ex.fence}${ex.lang}`, ...ex.lines, ex.fence, "");
        }
      } else {
        given(GIVEN["no-example"](o.id));
        out.pop(); out.pop();
      }
      while (out[out.length - 1] === "") out.pop();
      out.push("");
    });
    while (out.length && out[out.length - 1] === "") out.pop();
  });

  section("## What it will not do", () => {
    const { found, value } = at(decl.src, decl.refusals);
    if (found && typeof value === "string" && value.trim()) words(decl.src, decl.refusals);
    else if (found && Array.isArray(value) && value.length) value.forEach((_, k) => words(decl.src, `${decl.refusals}[${k}]`) || say(["as-written"], decl.src, `${decl.refusals}[${k}]`));
    else silent(decl.src, decl.refusals);
  });

  section("## When it hands work back to a person", () => {
    const { found, value } = at(decl.src, decl.escalates);
    if (found && Array.isArray(value) && value.length) value.forEach((_, k) => words(decl.src, `${decl.escalates}[${k}]`) || say(["as-written"], decl.src, `${decl.escalates}[${k}]`));
    else if (found && Array.isArray(value)) say(["none-handed-back"], decl.src, decl.escalates);
    else silent(decl.src, decl.escalates);
  });

  section("## What it reaches", () => {
    const { found, value } = at(decl.src, decl.systems);
    if (found && Array.isArray(value) && value.length) value.forEach((_, k) => sayOr(["system", "system-leaves"], decl.src, `${decl.systems}[${k}]`));
    else if (found && Array.isArray(value)) say(["none-reached"], decl.src, decl.systems);
    else silent(decl.src, decl.systems);
  });

  section("## What it costs", () => {
    if (!rt) return;
    if (!at(rt, "price").found) silent(rt, "price");
    else if (at(rt, "price.price").found) { sayOr(["price"], rt, "price.price"); say(["price-covers"], rt, "price"); }
    else sayOr(["price-covers"], rt, "price");
    if (!at(rt, "job_seconds").found) silent(rt, "job_seconds");
    else sayOr(["job-seconds"], rt, "job_seconds");
    const c = at(rt, "ceilings").value;
    if (Array.isArray(c) && c.length) c.forEach((_, k) => sayOr(["ceiling"], rt, `ceilings[${k}]`));
  });

  section("## What it leaves behind", () => {
    const { found, value } = at(decl.src, decl.records);
    if (found && Array.isArray(value) && value.length) value.forEach((_, k) => sayOr(["record"], decl.src, `${decl.records}[${k}]`));
    else if (found && Array.isArray(value)) say(["none-left"], decl.src, decl.records);
    else silent(decl.src, decl.records);
  });

  section("## Verdicts", () => {
    for (const v of verdicts) {
      sayOr(["verdict", "verdict-conforms", "verdict-signed"], v, ".");
      (Array.isArray(v.json.cases) ? v.json.cases : []).forEach((_, k) => say(["verdict-case"], v, `cases[${k}]`, "  - "));
    }
  });
  if (!verdicts.length) given(GIVEN["no-verdict"]());

  section("## How it has run", () => {
    for (const r of records.filter((x) => isRunRecord(x) && !hasCredential(x))) say(["runs"], r, ".");
  });
  if (!records.length) given(GIVEN["no-records"]());

  section("## Versions", () => {
    for (const r of records.filter((x) => isHeaded(x) && !hasCredential(x))) {
      out.push(`- ${code(r.name)}: ${String(r.text).split(/\r?\n/)[0].replace(/^#+\s+/, "").trim()} [${r.id}: L1]`);
    }
  });

  for (const r of unplaced) given(GIVEN["no-offering"](r.name));
  for (const u of unreadable) given(GIVEN.unreadable(u.file, u.why));
  for (const l of leftOut) given(GIVEN["left-out"](l.file, l.why));
  if (doc) {
    const ns = at(doc, "not_stated").value;
    (Array.isArray(ns) ? ns : []).forEach((_, k) => {
      const r = render("not-stated", ns[k], `not_stated[${k}]`)[0] ?? render("as-written", ns[k], `not_stated[${k}]`)[0];
      if (r) notDocumented.push(`- ${r} [${doc.id}: not_stated[${k}]]`);
    });
  }

  section("## Not documented", () => { out.push(...notDocumented); });

  section("## Sources", () => {
    for (const s of sources) out.push(`- ${s.id}: ${code(s.name)}, ${KIND_WORDS[s.kind]}, sha256 ${code(s.sha256)}`);
  });

  while (out.length && out[out.length - 1] === "") out.pop();
  return { markdown: `${out.join("\n")}\n`, silences: notDocumented.length };
}


export { renderAll };
