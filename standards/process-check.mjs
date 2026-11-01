#!/usr/bin/env node
// Checks a process document against Agent Processes 0.9.2
// (agentprocesses.ai/spec.html; the source is CommonAgent/common-agent-standards
// processes/SPEC.md). It reads the document and says two things:
//
//   failures  each §17.1 conformance item the document fails, by the section
//             that states it. A document with none conforms. Only what a
//             program can read from the document is checked: whether a goal is
//             a state rather than an activity, whether a trigger names an
//             observable event, and whether a runs process phase names
//             something the inner document's goal says exists are a reader's
//             judgment, and are not reported either way.
//   findings  what the four tests of §20.1 send somewhere else, where a
//             program can see it:
//               undefined-line         a line the specification does not define,
//                                      outside the extensions: block (§20.3)
//               carries-not-unique     two items the trigger carries with one name (§5.4)
//               handoff-unknown-phase  a handoff naming a phase the document does
//                                      not declare (§8.2)
//               gate-without-holder    a phase a person must sign (automation:
//                                      never) that names nobody to sign it (§6.4, §7.1)
//             A document with none is clean.
//
// The grammar is the process runner's (jeffrschneider/AgentMesh
// packages/runner/process-runner/scripts/parse-process.mjs): top-level parts
// at column 0, entries by indent, a phase line `name - form: what` with
// owner:/after:/by:/automation: read across the whole entry, after: split on
// `+`, handoffs and deviations `a -> b / c [key]: text`, blanks `<...>`. Unlike
// the runner it reads what 0.9.0 added (carries:, example:, extensions:,
// keyless handoffs) and 0.9.2's `limit: <n>` at the end of a deviation line
// (§6.7.1), and reads every line it cannot place as a finding rather than a
// note. Nothing here is imported from AgentMesh.
//
// A document inside a Markdown page is read from its fenced block. The digest
// a test case is pinned to (§21.1) is the digest of the document's SHAPE: the
// sha256 of its text with the `bindings:` block left out, so swapping or
// upgrading the agent that holds a role does not change it. The text's own
// digest is reported beside it, for whatever pins the exact text. Both are
// taken with every line ending written as \n, so a checkout that turns line
// endings into \r\n changes neither.
//
//   node standards/process-check.mjs <document> [--inner <document>]... [--json]
//
//   --inner   another process document a phase of this one runs (§6.3.1), so
//             a chain of runs process lines can be followed back to this one
//   --json    print { conforms, clean, digest, text_digest, failures,
//             findings, document }; digest is the shape digest
//
//   exits 0 when the document conforms and has no findings, 1 when it does
//   not, 2 when it could not start
//   needs: node >= 22
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SPEC_VERSION = "0.9.2";
export const LEVELS = ["manual", "assisted", "supervised", "autonomous", "never"];
/** The parts a document may carry at column 0 (§3, §4, §6.7.1, §13.6a, §18.3, §20.2). */
export const TOP_KEYS = ["PROCESS", "id", "from", "owner", "effective", "confidential-under", "bounded-by", "trigger", "concurrency", "goal", "example",
  "phases", "run-scoped", "handoffs", "deviations", "bindings", "policy", "measures", "records", "amendments", "extensions",
  // The lines that cite another process by its id, which §4 names.
  "fed by", "feeds"];
/** The keys a phase entry may carry (§6.4, §6.4.1, §6.5, §6.6, §6.6.1, §7, §9.4). */
export const PHASE_KEYS = ["owner", "after", "by", "not-before", "automation", "under", "every", "until"];
/** The keys a run-scoped line may carry (§9.1 to §9.3). */
export const SCOPED_KEYS = ["owner", "every", "from", "until", "on", "cap", "by", "automation"];
/** The lines the trigger may carry under its sentence (§5.1, §5.4). */
export const TRIGGER_KEYS = ["carries", "watch"];
/** The binding lines (§10). */
export const BINDING_KEYS = ["roster", "systems", "data"];
export const ACCESS = ["read", "write", "trigger", "revoke"];

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isKebab = (s) => KEBAB.test(String(s ?? ""));
export const isBlank = (s) => /^<[^<>]*>$/.test(squash(s));
const indentOf = (l) => l.length - l.trimStart().length;
const LINE_KEY = /^\s*([A-Za-z][A-Za-z-]*):(?=\s|$)/;

/** The sha256 of a text, line endings as \n: the text's own digest. */
export function digestOf(text) {
  return `sha256:${createHash("sha256").update(String(text ?? "").replace(/\r\n?/g, "\n")).digest("hex")}`;
}

/** The document's shape (§21.1): its text with the `bindings:` block left
 *  out, meaning the `bindings:` line at column 0 and every line after it up
 *  to the next line that starts at column 0. Line endings as \n. */
export function shapeOf(text) {
  const out = [];
  let inBindings = false;
  for (const l of documentText(text).split("\n")) {
    if (/^\S/.test(l)) inBindings = /^bindings:/.test(l);
    if (!inBindings) out.push(l);
  }
  return out.join("\n");
}

/** The digest a test case pins (§21.1): the sha256 of the document's shape. */
export function shapeDigestOf(text) {
  return digestOf(shapeOf(text));
}

/** The document out of what was read: a Markdown page's fenced block that
 *  opens with PROCESS:, or the text as it is. */
export function documentText(text) {
  return documentAt(text).text;
}

/** The document and the number of lines above it in what was read, so a
 *  line is reported by its number in the file. */
export function documentAt(text) {
  const t = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!/^```/m.test(t)) return { text: t, offset: 0 };
  for (const m of t.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) {
    if (/^\s*PROCESS:/.test(m[1])) return { text: m[1], offset: t.slice(0, m.index).split("\n").length };
  }
  return { text: t, offset: 0 };
}

/** Group lines into entries: a line at the shallowest indent opens one, and
 *  deeper lines continue it. Each line keeps its number. */
function entries(lines) {
  const nonEmpty = lines.filter((l) => l.text.trim());
  if (!nonEmpty.length) return [];
  const base = Math.min(...nonEmpty.map((l) => indentOf(l.text)));
  const out = [];
  for (const l of nonEmpty) {
    if (indentOf(l.text) === base || !out.length) out.push([l]);
    else out[out.length - 1].push(l);
  }
  return out;
}

/** "key: value  key: value" over known keys, values running to the next key. */
function scanKeys(text, keys) {
  const re = new RegExp(`(?:^|\\s)(${keys.join("|")}):(?=\\s|$)`, "g");
  const found = [];
  for (let m = re.exec(text); m; m = re.exec(text)) found.push({ key: m[1], start: m.index + (m[0].length - m[1].length - 1), end: m.index + m[0].length });
  const values = {};
  found.forEach((f, i) => { if (!(f.key in values)) values[f.key] = squash(text.slice(f.end, i + 1 < found.length ? found[i + 1].start : undefined)); });
  return { values, firstAt: found.length ? found[0].start : -1 };
}

/** Split on separators that sit outside parentheses and angle brackets. */
function splitTop(s, sep = ",") {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of String(s)) {
    if (ch === "(" || ch === "<") depth++;
    else if (ch === ")" || ch === ">") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map(squash).filter(Boolean);
}

/** How a phase resolves (§6.3), from the words after the dash. */
function formOf(what) {
  const w = squash(what);
  let m;
  if ((m = /^harness:\s*(.*)$/.exec(w))) return { form: "harness", output: m[1] };
  if (/^runs\s+process\b/.test(w)) {
    m = /^runs\s+process\s+(\S+)\s+(v\d+)\s*:\s*(.*)$/.exec(w);
    return m ? { form: "runs-process", inner: { id: m[1], version: m[2] }, output: m[3] } : { form: "runs-process", inner: null, output: "" };
  }
  if ((m = /^runs\s+([a-z0-9-]+)\s*:\s*(.*)$/.exec(w))) return { form: "harness", earlier: m[1], output: m[2] };
  if ((m = /^runs\s+([a-z0-9-]+)$/.exec(w))) return { form: "harness", earlier: m[1], output: "" };
  if ((m = /^convenes\s+([a-z0-9-]+)\s*:\s*(.*)$/.exec(w))) return { form: "convenes", pattern: m[1], output: m[2] };
  if ((m = /^system:\s*(.*)$/.exec(w))) return { form: "system", output: m[1] };
  if ((m = /^human:\s*(.*)$/.exec(w))) return { form: "human", output: m[1] };
  return { form: null, output: "" };
}

/** One after: value: the keyword trigger, a phase (with ? when the run may
 *  never enter it, §6.5.2), an exception edge (§6.5.1), or qualifying prose. */
export function afterValue(v) {
  const s = squash(v);
  if (s === "trigger") return { kind: "trigger" };
  let m;
  if ((m = /^([a-z0-9]+(?:-[a-z0-9]+)*)(\?)?$/.exec(s))) return { kind: "phase", name: m[1], optional: Boolean(m[2]) };
  if ((m = /^([a-z0-9-]+(?:\s+or\s+[a-z0-9-]+)*)\s*,\s*(\S.*)$/.exec(s))) return { kind: "exception", names: m[1].split(/\s+or\s+/), when: m[2] };
  if (!/\s/.test(s)) return { kind: "phase", name: s, optional: false, malformed: true };
  return { kind: "prose", text: s };
}

const ARROW = /^(.+?)\s+->\s+(.+?)\s*(?:\[([^\]]*)\])?\s*:(?:\s+([\s\S]*))?$/;

/** Read the document into a plain structure. Never throws: what cannot be
 *  placed is kept under `undefined_lines` and `problems`, for checkProcess. */
export function parseDocument(text) {
  const at = documentAt(text);
  const raw = at.text.split("\n");
  const sections = [];
  const undefinedLines = [];
  const malformed = [];
  raw.forEach((t, i) => {
    const line = { n: i + 1 + at.offset, text: t };
    if (!t.trim()) return;
    if (!/^\s/.test(t)) {
      const m = /^([A-Za-z][A-Za-z -]*?):(?:\s+(.*)|\s*)$/.exec(t);
      if (m && TOP_KEYS.includes(m[1])) { sections.push({ key: m[1], head: m[2] ?? "", lines: [], n: i + 1 + at.offset }); return; }
      undefinedLines.push(line);
      return;
    }
    if (!sections.length) { undefinedLines.push(line); return; }
    sections[sections.length - 1].lines.push(line);
  });
  const all = (key) => sections.filter((s) => s.key === key);
  const sec = (key) => all(key)[0] ?? null;
  // An entry's continuation lines: until a line opens with one of the
  // entry's own keys, a line is its sentence wrapping, even one that opens
  // with a word and a colon; after one, a line that opens with any other
  // key is a line of its own.
  const keyLines = (lines, allowed) => {
    let keyed = false;
    for (const l of lines) {
      const k = LINE_KEY.exec(l.text);
      if (!k) continue;
      if (allowed.includes(k[1])) keyed = true;
      else if (keyed) undefinedLines.push(l);
    }
  };
  const textOf = (s) => (s ? squash([s.head, ...s.lines.map((l) => l.text)].join(" ")) : "");

  // The header (§4).
  const proc = sec("PROCESS");
  const headText = [textOf(proc), textOf(sec("id")) ? `id: ${textOf(sec("id"))}` : ""].join(" ");
  const idm = /(?:^|\s)id:\s*(<[^<>]*>\/\S+|\S+)(?:\s+(v\d+)\b)?/.exec(headText);
  const name = proc ? squash(proc.head.split(/\s{2,}id:|\sid:/)[0]) : "";
  const ownerVals = scanKeys(`owner: ${textOf(sec("owner"))} ${sec("effective") ? `effective: ${textOf(sec("effective"))}` : ""}`, ["owner", "effective"]).values;
  const id = idm ? idm[1] : "";

  // The trigger, its watch: lines and the items it carries (§5, §5.1, §5.4).
  const trig = sec("trigger");
  const sentence = trig ? [trig.head] : [];
  const watches = [];
  const carries = [];
  let open = null;
  for (const l of trig?.lines ?? []) {
    const t = l.text.trim();
    const m = /^(?:(and|or)\s+)?watch:\s*(.*)$/.exec(t);
    if (/^carries:/.test(t)) { open = { kind: "carries", indent: indentOf(l.text), n: l.n, parts: [t.replace(/^carries:\s*/, "")] }; carries.push(open); continue; }
    if (m) { open = { kind: "watch", indent: indentOf(l.text), n: l.n, join: m[1] ?? null, parts: [m[2]] }; watches.push(open); continue; }
    if (open && indentOf(l.text) > open.indent) { open.parts.push(t); continue; }
    open = null;
    // Before the first carries: or watch: line a line is the sentence, even
    // one that opens with a word and a colon; among them it is a line of its own.
    const k = LINE_KEY.exec(l.text);
    if (k && (carries.length || watches.length) && !TRIGGER_KEYS.includes(k[1])) { undefinedLines.push(l); continue; }
    sentence.push(t);
  }
  const items = carries.map((c) => {
    const whole = squash(c.parts.join(" "));
    const m = /^(.+?)\s+-\s+(.*?)(?:,\s*(required|optional))?\s*$/.exec(whole);
    return m ? { name: m[1], what: m[2], required: m[3] === "required", stated: m[3] ?? null, line: c.n, text: whole }
      : { name: "", what: "", required: false, stated: null, line: c.n, text: whole, malformed: true };
  });

  // Phases (§6).
  const phases = [];
  const phaseSec = sec("phases");
  for (const e of entries(phaseSec?.lines ?? [])) {
    const m = /^\s*(\S+)\s+-\s+(.*)$/.exec(e[0].text);
    if (!m) { malformed.push({ section: "§6.1", text: `line ${e[0].n} in phases: names no phase (a phase line is two spaces, a name, a dash and how it resolves): "${squash(e[0].text)}"` }); continue; }
    keyLines(e.slice(1), PHASE_KEYS);
    const whole = squash([m[2], ...e.slice(1).map((l) => l.text)].join(" "));
    const scanned = scanKeys(whole, PHASE_KEYS);
    const what = scanned.firstAt < 0 ? whole : squash(whole.slice(0, scanned.firstAt));
    const v = scanned.values;
    phases.push({
      name: m[1], line: e[0].n, ...formOf(what),
      owner: v.owner ?? null, after: v.after !== undefined ? v.after.split(/\s*\+\s*/).map(squash).filter(Boolean) : null,
      automation: v.automation ?? null, by: v.by ?? null, notBefore: v["not-before"] ?? null, under: v.under ?? null,
    });
  }

  // Run-scoped lines (§9).
  const runScoped = [];
  for (const e of entries(sec("run-scoped")?.lines ?? [])) {
    const m = /^\s*(\S+)\s+-\s+(.*)$/.exec(e[0].text);
    if (!m) { malformed.push({ section: "§9.1", text: `line ${e[0].n} in run-scoped: names no line: "${squash(e[0].text)}"` }); continue; }
    keyLines(e.slice(1), [...SCOPED_KEYS, "after"]);
    const whole = squash([m[2], ...e.slice(1).map((l) => l.text)].join(" "));
    const scanned = scanKeys(whole, [...SCOPED_KEYS, "after"]);
    const what = scanned.firstAt < 0 ? whole : squash(whole.slice(0, scanned.firstAt));
    runScoped.push({ name: m[1], line: e[0].n, ...formOf(what), ...Object.fromEntries(Object.entries(scanned.values)) });
  }

  // Handoffs and deviations share a line (§8.1, §6.7.1).
  // A deviation line may end with `limit: <n>` (§6.7.1), at the end of its
  // last line or as a line of its own; nothing else under a handoff or a
  // deviation is a line this specification defines.
  const arrows = (key) => {
    const out = [];
    for (const e of entries(sec(key)?.lines ?? [])) {
      const lastAt = e.length - 1;
      e.forEach((l, i) => {
        if (i === 0 || !/^\s+[a-z][a-z-]*:(?=\s)/.test(l.text)) return;
        if (key === "deviations" && i === lastAt && /^\s+limit:\s+\S+\s*$/.test(l.text)) return;
        undefinedLines.push(l);
      });
      let whole = squash(e.map((l) => l.text).join(" "));
      let limitText = null;
      if (key === "deviations") {
        const lm = /\s+limit:\s+(\S+)$/.exec(whole);
        if (lm) { limitText = lm[1]; whole = whole.slice(0, lm.index); }
      }
      const m = ARROW.exec(whole);
      if (!m) { out.push({ line: e[0].n, malformed: true, whole }); continue; }
      out.push({ line: e[0].n, fromText: squash(m[1]), toText: squash(m[2]), key: m[3] !== undefined ? squash(m[3]) : null, text: squash(m[4] ?? ""), limitText });
    }
    return out;
  };
  const handoffs = arrows("handoffs").map(({ limitText: _l, ...h }) => (h.malformed ? h : { ...h, from: h.fromText.split(/\s*\+\s*/).map(squash).filter(Boolean), to: h.toText.split(/\s+\/\s+|\/(?=[a-z])/).map(squash).filter(Boolean) }));
  const deviations = arrows("deviations").map(({ limitText, ...d }) => {
    if (d.malformed) return d;
    const limit = limitText === null || limitText === undefined ? null : /^[1-9]\d*$/.test(limitText) ? Number(limitText) : NaN;
    return { ...d, from: d.fromText, to: d.toText, limit, ...(Number.isNaN(limit) ? { limitText } : {}) };
  });

  // Bindings (§10).
  const bindings = { roster: null, systems: null, data: null, systemsText: "" };
  const bindSec = sec("bindings");
  for (const e of entries(bindSec?.lines ?? [])) {
    const whole = squash(e.map((l) => l.text).join(" "));
    const m = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(whole);
    // A binding's own continuation lines are its prose, wrapped: only a line
    // at the bindings' own indent can be a line of its own.
    if (!m || !BINDING_KEYS.includes(m[1])) { undefinedLines.push(e[0]); continue; }
    bindings[m[1]] = m[2];
  }
  if (bindings.systems !== null) bindings.systemsText = bindings.systems;

  const measures = entries(sec("measures")?.lines ?? []).map((e) => {
    const whole = squash(e.map((l) => l.text).join(" "));
    const m = /^([^:]+):\s*(.*)$/.exec(whole);
    return m ? { name: squash(m[1]), text: m[2] } : { name: "", text: whole };
  });
  const records = entries(sec("records")?.lines ?? []).map((e) => {
    const whole = squash(e.map((l) => l.text).join(" "));
    const m = /^(\S+)\s+-\s+(.*)$/.exec(whole);
    return m ? { key: m[1], text: m[2], line: e[0].n } : { key: "", text: whole, line: e[0].n, malformed: true };
  });
  const extensions = entries(sec("extensions")?.lines ?? []).map((e) => {
    const m = /^\s*(\S+)\s+(v\d+)\s*$/.exec(e[0].text);
    return { name: m ? m[1] : squash(e[0].text), version: m ? m[2] : null, line: e[0].n, lines: e.slice(1).map((l) => l.text) };
  });

  return {
    name, id, version: idm?.[2] ?? "",
    // A reference process: an id under ref/, or the two blanks that mark a
    // document as not yet anyone's process, owner: <who> and effective: <date> (§4).
    isReference: /^ref\//.test(id) || (isBlank(ownerVals.owner ?? "") && isBlank(ownerVals.effective ?? "")),
    from: textOf(sec("from")) || null,
    owner: ownerVals.owner ?? (sec("owner") ? "" : null),
    effective: ownerVals.effective ?? null,
    confidentialUnder: all("confidential-under").map(textOf),
    example: sec("example") ? textOf(sec("example")) : null,
    trigger: trig ? { text: squash(sentence.join(" ")), watches: watches.map((w) => ({ join: w.join, text: squash(w.parts.join(" ")), line: w.n })) } : null,
    carries: items,
    concurrency: sec("concurrency") ? textOf(sec("concurrency")) : null,
    goal: sec("goal") ? textOf(sec("goal")) : null,
    phases, runScoped, handoffs, deviations, bindings, measures, records, extensions,
    has: Object.fromEntries(TOP_KEYS.map((k) => [k, all(k).length])),
    order: sections.map((s) => s.key),
    undefined_lines: undefinedLines.sort((a, b) => a.n - b.n).map((l) => ({ line: l.n, text: l.text })),
    problems: malformed,
  };
}

const parseCache = (text) => (typeof text === "string" ? parseDocument(text) : text);

/**
 * Check a document. `inner` is a list of other documents (text or parsed) a
 * phase of this one may run, so a chain of runs process lines can be
 * followed. Returns { conforms, clean, digest, text_digest, failures,
 * findings, document }: digest is the shape digest a test case pins (§21.1).
 */
export function checkProcess(text, { inner = [] } = {}) {
  const d = parseDocument(text);
  const failures = [...d.problems];
  const findings = [];
  const fail = (section, msg) => failures.push({ section, text: msg });
  const find = (test, section, msg) => findings.push({ test, section, text: msg });
  const phaseNames = new Set(d.phases.map((p) => p.name));
  const scopedNames = new Set(d.runScoped.map((r) => r.name));
  const ref = d.isReference;

  // §3, §4: the parts and the header.
  for (const part of ["PROCESS", "trigger", "goal", "phases", "handoffs"]) {
    if (!d.has[part]) fail("§3", `the document carries no ${part}: line; a document must carry PROCESS:, id:, trigger:, goal:, phases: and handoffs:`);
  }
  if (!d.id) fail("§3", "the document carries no id: (write it on the PROCESS: line, `id: <team>/<slug>   v1`)");
  else if (!/^ref\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.id) && !/^(?:<[^<>]+>|[a-z0-9][a-z0-9._-]*)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.id)) {
    fail("§4", `the id ${d.id} is not of the form <team>/<slug>, lowercase, with no spaces`);
  }
  if (d.has.PROCESS && !d.name) fail("§4", "PROCESS: names no process");
  if (d.id && !d.version) fail("§4", `the document carries no version beside its id (write \`id: ${d.id}   v1\`)`);
  if (d.owner === null) fail("§4", "the document names no owner (an owner: line is required)");
  else if (ref && !isBlank(d.owner)) fail("§4", `a reference process names no owner, and this one names ${d.owner}; write owner: <who>`);
  else if (!ref && (!d.owner || isBlank(d.owner))) fail("§4", `the document names no owner (owner: is ${d.owner ? `the blank ${d.owner}` : "empty"}); only a reference process leaves it blank`);
  if (ref && d.effective && !isBlank(d.effective)) fail("§4", `a reference process carries no effective date, and this one carries ${d.effective}`);
  if (!d.has.concurrency || !d.concurrency) fail("§4", "the document carries no concurrency: line saying whether runs may overlap (§5.2)");
  if (d.has.goal && !d.goal) fail("§4", "goal: is empty; it states what exists when a run is done");
  if (d.from !== null) {
    const refForm = /^ref\/[a-z0-9-]+\/[a-z0-9-]+\s+v(\d+|<[^<>]*>)$/;
    const orgForm = /^\S+\s+(?:<[^<>]+>|[a-z0-9][a-z0-9._-]*)\/[a-z0-9-]+\s+v(\d+|<[^<>]*>)$/;
    if (!refForm.test(d.from) && !orgForm.test(d.from)) fail("§4", `from: ${d.from} names neither a reference process (ref/<domain>/<slug> v<n>) nor another organization's document (<owner> <id> v<n>)`);
  }
  if (ref && (d.from === null || !/^ref\//.test(d.from) || (/^ref\//.test(d.id) && squash(d.from) !== `${d.id} ${d.version}`))) {
    fail("§4", `a reference process carries from: naming itself and its version (from: ${/^ref\//.test(d.id) ? d.id : "ref/<domain>/<slug>"} ${d.version || "v<n>"})`);
  }
  if (ref && d.example !== null) fail("§4", "a reference process carries no example:, because it has no runs");
  if (d.confidentialUnder.length > 1) fail("§4", `confidential-under: is carried ${d.confidentialUnder.length} times; a document carries it no more than once`);
  for (const c of d.confidentialUnder) {
    if (isBlank(c)) continue;
    if (ref) fail("§4", "a reference process leaves confidential-under: as a blank");
    else if (!/^\S+\s+v\d+\s+sha256:[0-9a-f]{64}$/.test(c)) fail("§4", `confidential-under: ${c} is not an agreement's identifier, its version v<n> and its digest sha256:<64 lowercase hex digits>`);
  }

  // §5: the trigger, its watch: lines and what it carries.
  if (d.trigger && !d.trigger.text) fail("§5", "trigger: names no event");
  d.trigger?.watches.forEach((w, i) => { if (i > 0 && !w.join) fail("§5.1", `the trigger carries ${d.trigger.watches.length} watch: lines, and the one on line ${w.line} is not joined to the one before by and or or`); });
  const seenItems = new Map();
  for (const c of d.carries) {
    if (c.malformed) { fail("§5.4", `line ${c.line}: "carries: ${c.text}" is not an item: a name, a dash, what it is, and required or optional`); continue; }
    if (!isKebab(c.name)) fail("§5.4", `the trigger's item ${c.name} (line ${c.line}) is not a key: lowercase letters and digits joined by single hyphens`);
    if (!c.stated) fail("§5.4", `the trigger's item ${c.name} (line ${c.line}) does not say required or optional`);
    if (!c.what) fail("§5.4", `the trigger's item ${c.name} (line ${c.line}) does not say what it is`);
    if (seenItems.has(c.name)) {
      fail("§5.4", `the trigger carries two items named ${c.name} (lines ${seenItems.get(c.name)} and ${c.line}); every item's name is unique`);
      find("carries-not-unique", "§5.4", `the trigger carries two items named ${c.name} (lines ${seenItems.get(c.name)} and ${c.line}), so a run cannot say which one it was handed`);
    } else seenItems.set(c.name, c.line);
  }

  // §6: the phases.
  const seen = new Map();
  let anyTrigger = false;
  for (const p of d.phases) {
    if (!isKebab(p.name)) fail("§6.1", `the phase ${p.name} (line ${p.line}) is not named in lowercase kebab: lowercase letters and digits joined by single hyphens`);
    if (seen.has(p.name)) fail("§6.1", `the phase ${p.name} is declared more than once (lines ${seen.get(p.name)} and ${p.line})`);
    else seen.set(p.name, p.line);
    if (!p.form) fail("§6.3", `the phase ${p.name} does not resolve to one of the five forms (harness:, runs process <id> v<n>:, convenes <pattern>:, system:, human:) named right after its dash`);
    if (p.form === "harness" && !p.output) fail("§6.3", `the harness phase ${p.name} names no output the agent hands back`);
    if (p.form === "runs-process") {
      if (!p.inner) fail("§6.3.1", `the phase ${p.name} runs a process without citing it by id and version (runs process <team>/<slug> v<n>: <what comes out>)`);
      else {
        if (!p.output) fail("§6.3.1", `the phase ${p.name} runs ${p.inner.id} and names nothing that comes out of it`);
        if (p.inner.id === d.id) fail("§6.3.1", `the phase ${p.name} runs this process itself (${d.id}); no process runs itself`);
      }
      if (p.automation === "never") fail("§6.3.1", `the phase ${p.name} runs a process and is written at never; a gate on what the inner run produced is a phase of its own, after it`);
    }
    if (!p.owner) {
      fail("§6.4", `the phase ${p.name} carries no owner:`);
      if (p.automation === "never") find("gate-without-holder", "§7.1", `the gate ${p.name} (automation: never) names nobody to sign it: it has no owner:, so a run would stop there with nobody to act`);
    } else if (p.automation === "never" && isBlank(p.owner) && !ref) {
      find("gate-without-holder", "§7.1", `the gate ${p.name} (automation: never) names its holder only as the blank ${p.owner}, so nobody is named to sign it`);
    }
    if (p.after === null) fail("§6.5", `the phase ${p.name} carries no after:`);
    for (const a of p.after ?? []) {
      const v = afterValue(a);
      if (v.kind === "trigger") { anyTrigger = true; continue; }
      if (v.kind === "phase" && !phaseNames.has(v.name)) fail("§6.5", `the phase ${p.name} waits for ${v.name}${v.optional ? "?" : ""}, which is not a phase of this document`);
      if (v.kind === "exception") for (const n of v.names) if (!phaseNames.has(n)) fail("§6.5.1", `the phase ${p.name} is entered when ${n} cannot complete, and ${n} is not a phase of this document`);
    }
    if (p.automation === null) fail("§7", `the phase ${p.name} carries no automation:`);
    else if (!LEVELS.includes(p.automation) && !isBlank(p.automation)) fail("§7", `the phase ${p.name} is at automation: ${p.automation}, which is not one of ${LEVELS.join(", ")}`);
  }
  if (d.phases.length && !anyTrigger) fail("§6.5", "no phase has after: trigger, so nothing in the graph ever begins");

  // §6.3.1: no chain of runs process lines comes back to this document.
  const docs = new Map(inner.map(parseCache).filter((x) => x.id).map((x) => [x.id, x]));
  const runsOf = (doc) => (doc?.phases ?? []).filter((p) => p.form === "runs-process" && p.inner).map((p) => p.inner.id);
  const chain = (fromId, path) => {
    for (const next of runsOf(fromId === d.id ? d : docs.get(fromId))) {
      if (next === d.id) return [...path, next];
      if (path.includes(next)) continue;
      const c = chain(next, [...path, next]);
      if (c) return c;
    }
    return null;
  };
  for (const p of d.phases.filter((x) => x.form === "runs-process" && x.inner && x.inner.id !== d.id)) {
    const c = chain(p.inner.id, [d.id, p.inner.id]);
    if (c) fail("§6.3.1", `the phase ${p.name} starts a chain of processes that comes back to this one: ${c.join(" runs ")}`);
  }

  // §6.7.2: no cycle in after:.
  const preds = new Map(d.phases.map((p) => [p.name, (p.after ?? []).map(afterValue).filter((v) => v.kind === "phase" && phaseNames.has(v.name)).map((v) => v.name)]));
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "open") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "open");
    for (const n of preds.get(id) ?? []) { const c = visit(n, [...path, id]); if (c) return c; }
    state.set(id, "done");
    return null;
  };
  for (const id of phaseNames) { const c = visit(id, []); if (c) { fail("§6.7.2", `the after: lines make a cycle, so these phases wait for each other on every run: ${c.join(" -> ")}`); break; } }

  // §8.6, §13.7: one key namespace.
  // One handoff may be written on several lines, one per receiving phase,
  // instead of once with / (§8.3: stating it once is a permission); those
  // lines leave the same sending side and keep the one key. Any other second
  // use of a string is a second thing under one key.
  const keys = new Map();
  const takeKey = (key, where, sender = null) => {
    if (!isKebab(key)) { fail("§8.6", `the key ${key} (${where}) is not lowercase and hyphen-separated`); return; }
    const had = keys.get(key);
    if (had && !(sender !== null && had.sender === sender)) fail("§8.6", `the key ${key} is used twice (${had.where} and ${where}); handoff, deviation and record keys and run-scoped names are one namespace, each string once`);
    else if (!had) keys.set(key, { where, sender });
  };
  const rosterText = String(d.bindings.roster ?? "").toLowerCase();
  const sideName = (s) => squash(s);

  // §8: handoffs.
  for (const h of d.handoffs) {
    if (h.malformed) { fail("§8.1", `line ${h.line} in handoffs: is not a handoff (<sending side> -> <receiving side>: <what crosses>): "${h.whole}"`); continue; }
    const where = `the handoff on line ${h.line}`;
    if (!h.text) fail("§8.1", `${where} (${h.fromText} -> ${h.toText}) does not say what crosses`);
    if (/\//.test(h.fromText)) fail("§8.3", `${where} writes / on its sending side (${h.fromText}); several senders are joined with +`);
    if (/\+/.test(h.toText)) fail("§8.3", `${where} writes + on its receiving side (${h.toText}); several receivers are separated with /`);
    const check = (side, s) => {
      const n = sideName(s);
      if (n.includes("?")) { fail("§6.5.2", `${where} writes ${n}; the ? marker belongs only in an after: value`); return; }
      if (n === "trigger") { fail("§8.2", `${where} names the trigger on its ${side} side; what the trigger carries is stated in the trigger`); return; }
      if (scopedNames.has(n)) { fail("§8.2", `${where} names the run-scoped line ${n}, which has no edges`); return; }
      if (/^[a-z0-9-]+$/.test(n) || !/\s/.test(n)) {
        if (!phaseNames.has(n)) {
          fail("§8.2", `${where} names ${n} on its ${side} side, which is not a phase of this document`);
          find("handoff-unknown-phase", "§8.2", `${where} names ${n} on its ${side} side, and the document declares no phase ${n}: a handoff ${side === "sending" ? "from it never arrives" : "to it is a promise nobody can keep"}`);
        }
        return;
      }
      if (side === "sending") {
        const bare = n.replace(/\s*\(person\)\s*$/i, "").toLowerCase();
        if (!rosterText.includes(n.toLowerCase()) && !rosterText.includes(bare)) fail("§8.2", `${where} is sent by ${n}, which is neither a phase of this document nor a role the roster names`);
      }
    };
    for (const s of h.fromText.split(/\s*[+/]\s*/)) check("sending", s);
    for (const s of h.toText.split(/\s+\/\s+|\s*\+\s*|\/(?=[a-z])/)) check("receiving", s);
    if (h.key !== null) takeKey(h.key, where, h.fromText);
  }

  // §6.7.1: deviations.
  for (const x of d.deviations) {
    if (x.malformed) { fail("§6.7.1", `line ${x.line} in deviations: is not a deviation (<phase> -> <phase> [key]: <what happened>): "${x.whole}"`); continue; }
    const where = `the deviation on line ${x.line}`;
    if (`${x.from} ${x.to}`.includes("?")) fail("§6.5.2", `${where} writes ${x.from} -> ${x.to}; the ? marker belongs only in an after: value`);
    if (x.from !== "any" && !phaseNames.has(x.from)) fail("§6.7.1", `${where} leaves ${x.from}, which is not a phase of this document`);
    if (!phaseNames.has(x.to)) fail("§6.7.1", `${where} goes to ${x.to}, which is not a phase of this document`);
    if (!x.text) fail("§6.7.1", `${where} (${x.from} -> ${x.to}) does not say what happened`);
    if (Number.isNaN(x.limit)) fail("§6.7.1", `${where} (${x.from} -> ${x.to}) ends with limit: ${x.limitText}, and a limit is a whole number of times, at least 1`);
    if (x.key !== null) takeKey(x.key, where);
  }

  // §9: run-scoped lines.
  for (const r of d.runScoped) {
    const where = `the run-scoped line ${r.name}`;
    takeKey(r.name, where);
    if (!r.form) fail("§9.1", `${where} does not resolve to one of the forms a phase does`);
    if (r.form === "runs-process") fail("§9.1", `${where} runs a process; a process that runs on a cadence has a trigger of its own`);
    if (!r.owner) fail("§9.1", `${where} names no owner`);
    if (!r.from || !r.until) fail("§9.1", `${where} must carry from: and until:`);
    if (r.after !== undefined) fail("§9.4", `${where} carries after:; a run-scoped line has no place in the graph`);
    const ph = (v, k) => {
      if (!v) return;
      if (v.includes("?")) fail("§6.5.2", `${where} writes ${k}: ${v}; the ? marker belongs only in an after: value`);
      else if (/^[a-z0-9-]+$/.test(v) && v !== "trigger" && !phaseNames.has(v)) fail("§9.3", `${where} names ${v} in ${k}:, which is not a phase of this document`);
    };
    ph(r.from, "from");
    if (r.until !== "run close") ph(r.until, "until");
  }

  // §10: bindings.
  for (const k of BINDING_KEYS) if (d.bindings[k] === null) fail("§10", `the bindings carry no ${k}: line; a document carries roster:, systems: and data:`);
  if (d.bindings.systems !== null && !/^none\b/i.test(d.bindings.systems) && !isBlank(d.bindings.systems)) {
    for (const item of splitTop(d.bindings.systems.replace(/,\s*$/, ""))) {
      const m = /^(.*?)\s*\((.*)\)\s*$/.exec(item);
      if (!m) { fail("§10.2", `the system ${item} carries no access word (read, write, trigger or revoke) in parentheses`); continue; }
      for (const grant of splitTop(m[2], ";")) {
        const word = /^([A-Za-z<][^\s,:]*)/.exec(grant)?.[1] ?? "";
        if (!ACCESS.includes(word) && !isBlank(word)) fail("§10.2", `the system ${squash(m[1])} carries the grant "${grant}", whose access word is not one of ${ACCESS.join(", ")}`);
        for (const part of splitTop(grant)) {
          const q = /^(from|until):\s*(\S+)$/.exec(part);
          if (q && q[2] !== "trigger" && !phaseNames.has(q[2])) fail("§10.5", `the system ${squash(m[1])} grants access ${q[1]}: ${q[2]}, which is not a phase of this document`);
        }
      }
    }
  }

  // §12.2: a quality gate.
  if (!d.measures.some((m) => m.name.toLowerCase() === "quality gate" && m.text)) fail("§12.2", "the document names no quality gate (measures: then `quality gate: <a condition a run meets or does not>`)");

  // §13.7: record keys.
  for (const r of d.records) {
    if (r.malformed) fail("§13.7", `line ${r.line} in records: is not a record (<key> - <what it is>)`);
    else takeKey(r.key, `the record on line ${r.line}`);
  }

  // §20.2: the extensions block.
  if (d.has.extensions) {
    const last = d.order[d.order.length - 1];
    if (last !== "extensions") fail("§20.2", `extensions: is not the last block of the document (${last}: comes after it)`);
    for (const e of d.extensions) if (!e.version) fail("§20.2", `the extension on line ${e.line} (${e.name}) does not name the version of its definition (<extension> v<n>)`);
  }

  // §20.3: lines this specification does not define, outside extensions:.
  // Text with no PROCESS: line is not a process document at all, and its
  // lines are not read as a document's.
  for (const l of d.has.PROCESS ? d.undefined_lines : []) {
    find("undefined-line", "§20.3", `line ${l.line}: "${squash(l.text)}" is not a line Agent Processes ${SPEC_VERSION} defines; outside the extensions: block it belongs in an extension, or out of the document`);
  }

  return { conforms: failures.length === 0, clean: findings.length === 0, digest: shapeDigestOf(text), text_digest: digestOf(documentText(text)), failures, findings, document: d };
}

/** The result in words, one line each. */
export function report(r, label = "the document") {
  const out = [];
  if (r.conforms && r.clean) out.push(`${label} conforms to Agent Processes ${SPEC_VERSION} and has no findings (${r.digest}).`);
  else {
    out.push(r.conforms ? `${label} conforms to Agent Processes ${SPEC_VERSION} (${r.digest}).` : `${label} does not conform to Agent Processes ${SPEC_VERSION} (${r.digest}):`);
    for (const f of r.failures) out.push(`  ${f.section.padEnd(7)} ${f.text}`);
    if (r.findings.length) {
      out.push("Findings against the four tests of §20.1:");
      for (const f of r.findings) out.push(`  [${f.test}] ${f.section} ${f.text}`);
    }
  }
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const inner = [];
  let file = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--inner") inner.push(args[++i]);
    else if (args[i] !== "--json") file = file ?? args[i];
  }
  if (!file) { console.error("usage: node process-check.mjs <document> [--inner <document>]... [--json]"); process.exit(2); }
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { console.error(`could not read ${file}: ${e.message}`); process.exit(2); }
  let innerTexts;
  try { innerTexts = inner.map((p) => readFileSync(p, "utf8")); } catch (e) { console.error(`could not read an inner document: ${e.message}`); process.exit(2); }
  const r = checkProcess(text, { inner: innerTexts });
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else console.log(report(r, file));
  process.exit(r.conforms && r.clean ? 0 : 1);
}
