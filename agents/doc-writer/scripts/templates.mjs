// The only sentences this agent can write.
//
// Every line of the documentation that says something about the agent is one
// of these templates filled from one place in one source, and ends with a mark
// naming that place: `[S1: offerings[0].inputs[2]]`. The template is the only
// text that is not the source's own; each value in it is the source's value,
// as it stands, or one of a few fixed words for a fixed value (a `true` that
// reads "required", a `per_task` that reads "with each job").
//
// The check (check-docs.mjs) does not trust the writer: it reads the mark,
// finds the place, renders every template in this file over what is there,
// and passes the line only when one of them gives exactly the line. A word
// the source does not carry, outside this file, fails it.
//
// So adding a kind of sentence is adding a template here, and nowhere else.
//
//   needs: node >= 22
//   import { TEMPLATES, GIVEN, renderAll, silence, LEGEND } from "./templates.mjs"
import { isEmpty } from "./given.mjs";

const str = (v) => (typeof v === "string" ? v : null);
const has = (o, ...keys) => o && typeof o === "object" && !Array.isArray(o) && keys.every((k) => o[k] !== undefined && o[k] !== null && o[k] !== "");
const code = (s) => `\`${s}\``;
const oneLine = (s) => typeof s === "string" && !s.includes("\n") && s.trim() === s && s !== "";

/** Fixed words for fixed values. A value not here is shown as it stands. */
export const WORDS = {
  required: { true: "required", false: "optional" },
  when: { per_task: "with each job", standing: "kept across jobs", per_job: "with each job" },
  given_by: { person: "A person gives it.", agent: "Another agent gives it.", either: "A person or another agent gives it." },
  control: { script: "a program runs it", model: "a model runs it" },
  intelligence: { none: "it calls no model", called: "it calls a model for a judgment", open: "a model works out how" },
  cost: { none: "it has no metered cost", metered: "its cost is metered", unbounded: "its cost is not bounded in advance" },
  contract: { full: "the method is fixed", ends: "the result is fixed and the method is left open" },
  who: { signed_in: "callers who are signed in", anyone: "anyone" },
  access: { read: "reads", write: "writes", trigger: "calls" },
};
const word = (table, v) => (Object.hasOwn(WORDS[table], String(v)) ? WORDS[table][String(v)] : null);

/** Micro-units as an amount: 2000000 is 2.00. */
export const fromMicro = (n) => (Number.isInteger(n) ? (n / 1_000_000).toFixed(2) : null);

/** The templates over a place in a source. Each `render(node, ctx)` gives the
 *  line, or several candidate lines, or null when it does not apply. `at`,
 *  where given, limits a template to places whose path matches it, for
 *  templates over a bare number or a bare string whose meaning is the place. */
export const TEMPLATES = [
  // The source's own words, whole.
  { id: "words", render: (n) => (oneLine(n) ? n : null) },

  // What a job takes.
  { id: "input", render: (n) => (has(n, "name", "kind") && !has(n, "steps") && n.when === undefined
      ? `**${n.name}** (${n.kind}, ${word("required", Boolean(n.required))}).` : null) },
  { id: "input-one-of", render: (n) => (has(n, "name", "kind", "one_of")
      ? `**${n.name}** is one of the ${code(n.one_of)} inputs: give at least one of them.` : null) },
  { id: "input-given-by", render: (n) => (has(n, "name", "kind", "given_by") ? word("given_by", n.given_by) : null) },
  { id: "input-fields", render: (n) => (has(n, "name", "kind") && Array.isArray(n.fields) && n.fields.length && n.fields.every(oneLine)
      ? `It reads ${n.fields.map(code).join(", ")} from **${n.name}**.` : null) },

  // What a job hands back.
  { id: "output", render: (n) => (has(n, "name", "kind", "when")
      ? `**${n.name}** (${n.kind}), ${word("when", n.when) ?? code(n.when)}.` : null) },
  { id: "output-working", render: (n) => (has(n, "name", "kind", "when") && n.working === true
      ? `**${n.name}** is the job's working out, kept so the result can be checked.` : null) },

  // How a job is done.
  { id: "how", render: (n) => (has(n, "control", "intelligence", "cost", "contract")
      ? `Control ${code(n.control)}, intelligence ${code(n.intelligence)}, cost ${code(n.cost)}, contract ${code(n.contract)}.` : null) },
  { id: "how-words", render: (n) => {
      if (!has(n, "control", "intelligence", "cost", "contract")) return null;
      const w = [word("control", n.control), word("intelligence", n.intelligence), word("cost", n.cost), word("contract", n.contract)];
      if (w.some((x) => !x)) return null;
      return `In words: ${w[0]}, ${w[1]}, ${w[2]}, and ${w[3]}.`;
    } },

  // A step of a job.
  { id: "step", render: (n) => (has(n, "id", "name") && !Array.isArray(n.steps)
      ? (oneLine(n.does) ? `**${n.name}** (${code(n.id)}): ${n.does}` : `**${n.name}** (${code(n.id)}).`) : null) },

  // An offering's own heading line and its trial.
  { id: "offering", render: (n) => (has(n, "id", "name") && Array.isArray(n.inputs) && Array.isArray(n.outputs)
      ? `**${n.name}** is ordered as ${code(n.id)}.` : null) },
  { id: "trial", render: (n) => {
      if (!n || typeof n !== "object" || Array.isArray(n) || n.offered === false) return null;
      if (has(n, "who")) return `Its trial is open to ${word("who", n.who) ?? code(n.who)}.`;
      return n.offered === true ? "It offers a trial." : null;
    } },
  { id: "trial-limits", render: (n) => {
      if (!n || typeof n !== "object" || Array.isArray(n)) return null;
      const parts = [];
      if (Number.isInteger(n.per_requester_per_day)) parts.push(`${n.per_requester_per_day} a day for each caller`);
      if (Number.isInteger(n.per_day)) parts.push(`${n.per_day} a day in all`);
      if (Number.isInteger(n.per_requester_ever)) parts.push(`${n.per_requester_ever} for each caller ever`);
      return parts.length && Object.keys(n).every((k) => ["per_requester_per_day", "per_day", "per_requester_ever"].includes(k))
        ? `Trials are limited to ${parts.join(", ")}.` : null;
    } },

  // What it reaches.
  { id: "system", render: (n) => (has(n, "name", "access") && !has(n, "credential") && n.kind === undefined
      ? (oneLine(n.needs) ? `**${n.name}**, which it ${word("access", n.access) ?? code(n.access)}: ${n.needs}` : `**${n.name}**, which it ${word("access", n.access) ?? code(n.access)}.`) : null) },
  { id: "system-leaves", render: (n) => (has(n, "name", "access") && n.leaves === true
      ? `What a job hands it is sent to **${n.name}**, outside this agent.` : null) },

  // What it leaves behind.
  { id: "record", render: (n) => (has(n, "name", "when") && n.kind === undefined && oneLine(n.name)
      ? (oneLine(n.file) ? `${code(n.file)}: ${n.name.replace(/\.$/, "")}, ${word("when", n.when) ?? code(n.when)}.` : `${n.name.replace(/\.$/, "")}, ${word("when", n.when) ?? code(n.when)}.`) : null) },

  // What it costs, from the runtime requirements.
  { id: "price", render: (n) => {
      if (!has(n, "model")) return null;
      if (n.model === "free") return "It is free.";
      if (n.model === "flat" && Number.isInteger(n.amount_micro) && oneLine(n.currency)) return `Each job costs ${fromMicro(n.amount_micro)} ${n.currency}, a flat price.`;
      return null;
    } },
  { id: "price-covers", render: (n) => (has(n, "covers", "price") && Array.isArray(n.covers.offerings) && n.covers.offerings.length
      ? `The price covers ${n.covers.offerings.map(code).join(", ")}.` : null) },
  { id: "job-seconds", at: /^job_seconds$/, render: (n) => (Number.isInteger(n) ? `A job may run for up to ${n} seconds.` : null) },
  { id: "ceiling", render: (n) => (has(n, "system", "per") && Number.isInteger(n.suggested)
      ? `Calls to **${n.system}** are capped at ${n.suggested} a ${n.per}${oneLine(n.enforced_by) ? `, enforced by the ${n.enforced_by}` : ""}.` : null) },

  // From the AgentDoc.
  { id: "identity", render: (n) => (has(n, "name") && Array.isArray(n.from) && oneLine(n.name)
      ? (oneLine(n.operator) ? `**${n.name}**, operated by ${n.operator}.` : `**${n.name}**.`) : null) },
  { id: "access", render: (n) => (has(n, "address", "protocol") && oneLine(n.address)
      ? `Send it work at ${code(n.address)}, over ${n.protocol}.` : null) },
  { id: "assembled-at", at: /^assembled_at$/, render: (n) => (oneLine(n) ? `The AgentDoc was assembled at ${n}.` : null) },
  { id: "assembled-from", at: /^sources\[\d+\]\.agent_version$/, render: (n) => (oneLine(n) ? `The AgentDoc was assembled from descriptor version ${n}.` : null) },
  { id: "not-stated", at: /^not_stated\[\d+\]$/, render: (n) => (oneLine(n) ? `The AgentDoc says ${code(n)} was not stated.` : null) },
  { id: "version", at: /^agent_version$/, render: (n) => (oneLine(n) ? `This documents version ${n}.` : null) },

  // A verdict (agent-eval-record-v1).
  { id: "verdict", render: (n) => {
      if (!(n && n.record === "v1" && n.act === "evaluate" && has(n, "summary"))) return null;
      const s = n.summary;
      if (![s.pass, s.fail, s.inconclusive, s.flagged_for_review].every(Number.isInteger)) return null;
      return `The verdict of ${n.produced_at ?? "an unstated time"}: ${s.pass} passed, ${s.fail} failed, ${s.inconclusive} inconclusive and ${s.flagged_for_review} flagged for review.`;
    } },
  { id: "verdict-conforms", render: (n) => (n && n.record === "v1" && n.act === "evaluate" && typeof n.conforms === "boolean"
      ? (n.conforms ? "It says the agent conforms." : "It says the agent does not conform.") : null) },
  { id: "verdict-signed", render: (n) => (n && n.record === "v1" && n.act === "evaluate" && Array.isArray(n.signatures)
      ? `It carries ${n.signatures.length} signature${n.signatures.length === 1 ? "" : "s"}, which this documentation does not check.` : null) },
  { id: "verdict-case", render: (n) => (has(n, "id", "verdict") && oneLine(n.id)
      ? `${code(n.id)}${oneLine(n.kind) ? ` (${n.kind})` : ""}: ${n.verdict}.` : null) },

  // A list a source declares and leaves empty is a statement, not a silence.
  { id: "none-reached", at: /^(?:systems|sections\.reaches\.systems)$/, render: (n) => (Array.isArray(n) && !n.length ? "It declares that it reaches no system." : null) },
  { id: "none-left", at: /^(?:records|sections\.leaves\.records)$/, render: (n) => (Array.isArray(n) && !n.length ? "It declares that it leaves no record." : null) },
  { id: "none-handed-back", at: /^(?:escalates|sections\.refuses\.hands_over)$/, render: (n) => (Array.isArray(n) && !n.length ? "It declares nothing it hands back to a person." : null) },
  { id: "takes-nothing", at: /\.inputs$/, render: (n) => (Array.isArray(n) && !n.length ? "It takes nothing." : null) },
  { id: "no-ceilings", at: /^ceilings$/, render: (n) => (Array.isArray(n) && !n.length ? "It declares no ceiling on what a job may use." : null) },

  // A record that was given, named as the record the descriptor declares.
  { id: "record-is", render: (n, ctx) => (has(n, "name", "file", "when") && oneLine(n.name)
      ? (ctx.files ?? []).filter((f) => globMatch(n.file, f)).map((f) => `${code(f)} is the record declared as: ${n.name}.`) : null) },

  // The platform's run record for an agent.
  { id: "runs", render: (n) => (n && [n.runs, n.completed, n.failed, n.window_days].every(Number.isInteger)
      ? `In the ${n.window_days} days this record covers it ran ${n.runs} jobs: ${n.completed} completed and ${n.failed} failed${Number.isInteger(n.average_seconds) ? `, taking ${n.average_seconds} seconds each on average` : ""}.` : null) },
];

/** Does a declared record's file pattern (such as `<star>/quiz.json`) name a given file.
 *  Only the last part of the pattern is held against the file's name, since
 *  a given file arrives without the folder it was kept in. */
export function globMatch(pattern, file) {
  const last = String(pattern).split("/").pop();
  // A pattern that is all wildcards names every file, and so names none.
  if (!last || /^[*?]*$/.test(last)) return false;
  const body = last.split("").map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^$(){}|[\]\\]/, "\\$&"))).join("");
  const re = new RegExp(`^${body}$`, "i");
  return re.test(String(file).replace(/^\d+-/, ""));
}

/** Every line the templates give over a node at a path. */
export function renderAll(node, path, ctx = {}) {
  const out = [];
  for (const t of TEMPLATES) {
    if (t.at && !t.at.test(path)) continue;
    let r;
    try { r = t.render(node, ctx); } catch { r = null; }
    for (const line of [r].flat()) if (typeof line === "string" && line) out.push({ id: t.id, line });
  }
  return out;
}

/** Render one template by id, for the writer. Null when it does not apply. */
export function render(id, node, path = "") {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`there is no template ${id}`);
  if (t.at && !t.at.test(path)) return null;
  const r = t.render(node, {});
  return typeof r === "string" ? r : null;
}

// ── Silences ───────────────────────────────────────────────────────────────
//
// A silence is a place a source could speak and does not. Its line is marked
// `[S1: escalates absent]`, and the check passes it only when the place is
// absent or empty in that source and the line is this template's.

const SOURCE_WORDS = { descriptor: "agent descriptor", runtime: "runtime requirements", agentdoc: "AgentDoc" };

const offeringId = (root, i, base) => {
  const offs = base === "sections.sells.offerings" ? root?.sections?.sells?.offerings : root?.offerings;
  return offs?.[Number(i)]?.id ?? `offering ${Number(i) + 1}`;
};

export const LABELS = [
  { re: /^(?:escalates|sections\.refuses\.hands_over)$/, label: () => "when it hands work back to a person" },
  { re: /^(?:refusals|sections\.refuses\.statement)$/, label: () => "what it will not do" },
  { re: /^(?:records|sections\.leaves\.records)$/, label: () => "what it leaves behind" },
  { re: /^(?:systems|sections\.reaches\.systems)$/, label: () => "what it reaches" },
  { re: /^(?:does|sections\.identity\.description)$/, label: () => "what the agent does" },
  { re: /^(offerings|sections\.sells\.offerings)\[(\d+)\]\.does$/, label: (r, m) => `what ${code(offeringId(r, m[2], m[1]))} does` },
  { re: /^(offerings|sections\.sells\.offerings)\[(\d+)\]\.inputs$/, label: (r, m) => `what ${code(offeringId(r, m[2], m[1]))} takes` },
  { re: /^(offerings|sections\.sells\.offerings)\[(\d+)\]\.outputs$/, label: (r, m) => `what ${code(offeringId(r, m[2], m[1]))} hands back` },
  { re: /^(offerings|sections\.sells\.offerings)\[(\d+)\]\.how$/, label: (r, m) => `how ${code(offeringId(r, m[2], m[1]))} is done` },
  { re: /^(offerings|sections\.sells\.offerings)\[(\d+)\]\.steps$/, label: (r, m) => `the steps of ${code(offeringId(r, m[2], m[1]))}` },
  { re: /^price$/, label: () => "its price" },
  { re: /^job_seconds$/, label: () => "how long a job may run" },
  { re: /^ceilings$/, label: () => "any ceiling on what a job may use" },
  { re: /^sections\.access$/, label: () => "where to send it work" },
];

/** The silence line for a place, or null when the place has no label. */
export function silence(kind, root, path) {
  for (const l of LABELS) {
    const m = l.re.exec(path);
    if (m) return `The ${SOURCE_WORDS[kind] ?? "source"} says nothing about ${l.label(root, m)}.`;
  }
  return null;
}

// ── Lines about what was given ─────────────────────────────────────────────
//
// Marked `[given]`. These say what this job had and did not have, and the
// check holds each one against the job's inventory.

export const GIVEN = {
  "no-descriptor": () => "No agent descriptor was given, so what it offers is taken from the AgentDoc, which carries the descriptor's words.",
  "no-agentdoc": () => "No AgentDoc was given, so its identity and where to send it work are not documented here.",
  "no-runtime": () => "No runtime requirements were given, so its price and how long a job may run are not documented here.",
  "no-verdict": () => "No verdict was given, so nothing here says whether it passed a conformance check.",
  "no-records": () => "No records were given, so nothing here says how it has run.",
  "no-example": (id) => `No record of a job of ${code(id)} was given, so there is no example of it.`,
  "unreadable": (file, why) => `${code(file)} was given and could not be read (${why}), so nothing from it is here.`,
  "left-out": (file, why) => `${code(file)} was left out: ${why}.`,
  "credential": (file) => `${code(file)} is not quoted, because a line in it looks like a credential.`,
  "no-offering": (file) => `${code(file)} was given; it names none of the jobs above.`,
};

/** The legend under the header: the one paragraph that is about this
 *  documentation rather than about the agent. */
export const LEGEND = [
  "Every line below ends with the place it came from: `[S1: does]` is the field `does` of source S1, listed under Sources at the end.",
  "Nothing here was written without a source. Where the sources say nothing, the section Not documented says so.",
];

/** The section headings, in order. An offering adds `### <name>` under How to use it. */
export const SECTIONS = [
  "## What it does",
  "## Where to send it work",
  "## How to use it",
  "## What it will not do",
  "## When it hands work back to a person",
  "## What it reaches",
  "## What it costs",
  "## What it leaves behind",
  "## Verdicts",
  "## How it has run",
  "## Versions",
  "## Other records given",
  "## Not documented",
  "## Sources",
];
export const SUBSECTIONS = ["#### What to give it", "#### What comes back", "#### How it is done", "#### Its steps", "#### Examples"];

/** Does a line look like a credential. */
export const CREDENTIAL = /(-----BEGIN [A-Z ]*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bamt_[A-Za-z0-9]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abpr]-[A-Za-z0-9-]{10,}|\bSU[A-Z2-7]{50,}|-----BEGIN NATS USER JWT|"(?:password|secret|api_key|apikey|access_token|token)"\s*:\s*"[^"]{8,}")/i;

export { isEmpty };
