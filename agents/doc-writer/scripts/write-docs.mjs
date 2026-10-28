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
import { isEmpty, linesOf, resolvePath } from "./given.mjs";
import { CREDENTIAL, GIVEN, LEGEND, globMatch, render, renderAll, silence } from "./templates.mjs";

export const WRITER = "doc-writer 0.1.0";
/** The most lines of one record shown as an example. */
export const EXAMPLE_LINES = 40;

const code = (s) => `\`${s}\``;

/** Where the declaration is read from, and the paths of its parts there. */
export function declarationOf(sources) {
  const d = sources.find((s) => s.kind === "descriptor");
  if (d) return { src: d, root: d.json, offerings: "offerings", refusals: "refusals", escalates: "escalates", records: "records", systems: "systems", does: "does" };
  const a = sources.find((s) => s.kind === "agentdoc");
  if (a) return { src: a, root: a.json, offerings: "sections.sells.offerings", refusals: "sections.refuses.statement", escalates: "sections.refuses.hands_over", records: "sections.leaves.records", systems: "sections.reaches.systems", does: "sections.identity.description" };
  return null;
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
  const byName = ids.findIndex((l) => l.some((id) => record.name.toLowerCase().includes(String(id).toLowerCase())));
  if (byName >= 0) return byName;
  const quoted = ids.map((l, i) => (l.some((id) => String(record.text).includes(`"${id}"`)) ? i : -1)).filter((i) => i >= 0);
  if (quoted.length === 1) return quoted[0];
  return offerings.length === 1 ? 0 : -1;
}

/** The example lines of a record: its own lines, or its JSON laid out. */
export function exampleOf(s) {
  const json = s.json !== undefined;
  const lines = json ? JSON.stringify(s.json, null, 2).split("\n") : String(s.text).split(/\r?\n/);
  while (!json && lines.length && lines[lines.length - 1] === "") lines.pop();
  const to = Math.min(lines.length, EXAMPLE_LINES);
  const fence = lines.slice(0, to).some((l) => /^\s*```/.test(l)) ? "````" : "```";
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
      const r = render(id, value, path);
      if (r) { line(r, src, path, bullet); said = true; }
    }
    return said;
  };
  /** The source's own words at a place, a line at a time. */
  const words = (src, path, bullet = "- ") => {
    const { found, value } = resolvePath(src.json, path);
    if (!found || typeof value !== "string" || !value.trim()) return false;
    const ls = linesOf(value);
    if (ls.length === 1 && value.trim() === value) line(value, src, path, bullet);
    else ls.forEach((l, i) => line(l, src, `${path}/${i}`, bullet));
    return true;
  };
  const silent = (src, path) => {
    const s = silence(src.kind, src.json, path);
    if (s) notDocumented.push(`- ${s} [${src.id}: ${path} absent]`);
  };
  const given = (text) => notDocumented.push(`- ${text} [given]`);
  const at = (src, path) => resolvePath(src.json, path);

  // Title and header.
  const name = doc ? at(doc, "sections.identity.name").value : undefined;
  const handle = doc ? at(doc, "subject.handle").value : undefined;
  const dsrc = sources.find((s) => s.kind === "descriptor");
  const version = dsrc?.json?.agent_version ?? (doc?.json?.sources ?? []).find((s) => s.id === "descriptor")?.agent_version;
  out.push(`# ${typeof name === "string" && name.trim() ? name.trim() : "The agent"}`, "");
  out.push(`agent: ${typeof handle === "string" ? handle : "not given"}`);
  out.push(`version: ${typeof version === "string" ? version : "not given"}`);
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
    if (!words(decl.src, decl.does, "")) silent(decl.src, decl.does);
    if (doc) say(["identity"], doc, "sections.identity");
    if (dsrc) say(["version"], dsrc, "agent_version");
    if (doc) {
      const i = (doc.json.sources ?? []).findIndex((s) => s.id === "descriptor");
      if (i >= 0) say(["assembled-from"], doc, `sources[${i}].agent_version`);
      say(["assembled-at"], doc, "assembled_at");
    }
  });

  section("## Where to send it work", () => {
    if (doc && !say(["access"], doc, "sections.access", "")) silent(doc, "sections.access");
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

  section("## How to use it", () => {
    offs.forEach((o, i) => {
      const p = `${decl.offerings}[${i}]`;
      out.push(`### ${o.name ?? o.id}`, "");
      say(["offering"], decl.src, p, "");
      if (!words(decl.src, `${p}.does`, "")) silent(decl.src, `${p}.does`);
      if (o.trial) { say(["trial"], decl.src, `${p}.trial`, ""); if (o.trial.limits) say(["trial-limits"], decl.src, `${p}.trial.limits`, ""); }
      out.push("");

      out.push("#### What to give it", "");
      if (Array.isArray(o.inputs) && o.inputs.length) {
        o.inputs.forEach((inp, j) => {
          const q = `${p}.inputs[${j}]`;
          say(["input"], decl.src, q);
          for (const f of ["description", "about"]) words(decl.src, `${q}.${f}`, "  - ");
          say(["input-one-of", "input-given-by", "input-fields"], decl.src, q, "  - ");
        });
      } else if (Array.isArray(o.inputs)) say(["takes-nothing"], decl.src, `${p}.inputs`);
      else silent(decl.src, `${p}.inputs`);
      out.push("");

      out.push("#### What comes back", "");
      if (Array.isArray(o.outputs) && o.outputs.length) {
        o.outputs.forEach((op, j) => {
          const q = `${p}.outputs[${j}]`;
          say(["output"], decl.src, q);
          for (const f of ["description", "about"]) words(decl.src, `${q}.${f}`, "  - ");
          say(["output-working"], decl.src, q, "  - ");
        });
      } else silent(decl.src, `${p}.outputs`);
      out.push("");

      out.push("#### How it is done", "");
      if (!say(["how", "how-words"], decl.src, `${p}.how`, "")) silent(decl.src, `${p}.how`);
      out.push("");

      if (Array.isArray(o.steps) && o.steps.length) {
        out.push("#### Its steps", "");
        o.steps.forEach((s, k) => say(["step"], decl.src, `${p}.steps[${k}]`, `${k + 1}. `));
        out.push("");
      }

      out.push("#### Examples", "");
      if (byOffering[i].length) {
        for (const r of byOffering[i]) {
          const declared = at(decl.src, decl.records).value;
          (Array.isArray(declared) ? declared : []).forEach((d, k) => {
            if (d && typeof d.file === "string" && globMatch(d.file, r.name)) line(`${code(r.name)} is the record declared as: ${d.name}.`, decl.src, `${decl.records}[${k}]`);
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
    else if (found && Array.isArray(value) && value.length) value.forEach((_, k) => words(decl.src, `${decl.refusals}[${k}]`));
    else silent(decl.src, decl.refusals);
  });

  section("## When it hands work back to a person", () => {
    const { found, value } = at(decl.src, decl.escalates);
    if (found && Array.isArray(value) && value.length) value.forEach((_, k) => words(decl.src, `${decl.escalates}[${k}]`));
    else if (found && Array.isArray(value)) say(["none-handed-back"], decl.src, decl.escalates);
    else silent(decl.src, decl.escalates);
  });

  section("## What it reaches", () => {
    const { found, value } = at(decl.src, decl.systems);
    if (found && Array.isArray(value) && value.length) value.forEach((_, k) => say(["system", "system-leaves"], decl.src, `${decl.systems}[${k}]`));
    else if (found && Array.isArray(value)) say(["none-reached"], decl.src, decl.systems);
    else silent(decl.src, decl.systems);
  });

  section("## What it costs", () => {
    if (!rt) return;
    if (!say(["price"], rt, "price.price")) silent(rt, "price");
    say(["price-covers"], rt, "price");
    if (!say(["job-seconds"], rt, "job_seconds")) silent(rt, "job_seconds");
    const c = at(rt, "ceilings").value;
    if (Array.isArray(c) && c.length) c.forEach((_, k) => say(["ceiling"], rt, `ceilings[${k}]`));
  });

  section("## What it leaves behind", () => {
    const { found, value } = at(decl.src, decl.records);
    if (found && Array.isArray(value) && value.length) value.forEach((_, k) => say(["record"], decl.src, `${decl.records}[${k}]`));
    else if (found && Array.isArray(value)) say(["none-left"], decl.src, decl.records);
    else silent(decl.src, decl.records);
  });

  section("## Verdicts", () => {
    for (const v of verdicts) {
      say(["verdict", "verdict-conforms", "verdict-signed"], v, ".");
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
      const r = render("not-stated", ns[k], `not_stated[${k}]`);
      if (r) notDocumented.push(`- ${r} [${doc.id}: not_stated[${k}]]`);
    });
  }

  section("## Not documented", () => { out.push(...notDocumented); });

  section("## Sources", () => {
    for (const s of sources) out.push(`- ${s.id}: ${code(s.name)}, ${KIND_LABEL[s.kind]}, sha256 ${code(s.sha256)}`);
  });

  while (out.length && out[out.length - 1] === "") out.pop();
  return { markdown: `${out.join("\n")}\n`, silences: notDocumented.length };
}

export const KIND_LABEL = {
  descriptor: "the agent descriptor",
  runtime: "the runtime requirements",
  agentdoc: "the AgentDoc",
  verdict: "a verdict",
  record: "a record",
};

export { renderAll };
