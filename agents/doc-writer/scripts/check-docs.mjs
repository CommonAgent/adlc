// Check every line: the step that stands between the writer and the reader.
//
// It is given the documentation as text and the sources as they were read,
// and it does not trust the writer at all. Every line that says something
// about the agent must end with a mark naming one place in one source, and it
// passes only when one of the templates in templates.mjs, filled from exactly
// that place, gives exactly that line. A silence passes only when the place is
// absent or empty. A line about what was given passes only when the job's
// inventory says so. An example passes only when its lines are the record's
// lines. Then it checks coverage, the role's own test: every job is
// documented, every input and output of it is listed, every refusal is there,
// and every job either has an example from a record or says it has none.
//
// Any finding stops the delivery. Documentation with one invented line in it
// is not documentation with a small fault, because a reader cannot tell which
// line it is.
//
//   needs: node >= 22
//   import { checkDocs } from "./check-docs.mjs"
//   or: DOCS=<documentation.md> GIVEN=<file>... node check-docs.mjs
import { isEmpty, linesOf, rangeOf, resolvePath, sha256 } from "./given.mjs";
import { KIND_WORDS } from "./given.mjs";
import { GIVEN, LEGEND, SECTIONS, SUBSECTIONS, code, esc, looksSecret, renderAll, silence, withheld } from "./templates.mjs";
import { WRITER, declarationOf, hasCredential, headerOf, headingOf, isEmptyRecord, isHeaded, isRunRecord, jobIdOf, offeringOf, offeringsOf, showable } from "./write-docs.mjs";

/** The `####` part of a job a line about the job belongs under: none for the
 *  job's own lines (its name, what it does, its trial), which stand above
 *  the first one. */
function subsectionFor(rest) {
  if (/^\.inputs(\[|$)/.test(rest)) return "#### What to give it";
  if (/^\.outputs(\[|$)/.test(rest)) return "#### What comes back";
  if (/^\.how$/.test(rest)) return "#### How it is done";
  if (/^\.steps(\[|$)/.test(rest)) return "#### Its steps";
  return null;
}

/** The sections a marked line may stand in, by its source and place. A line
 *  true to its place but put under the wrong heading tells a reader something
 *  false, so where a line stands is checked as well as what it says. */
function sectionsFor(src, place, decl) {
  if (src.kind === "verdict") return ["## Verdicts"];
  if (src.kind === "runtime") return ["## What it costs"];
  if (src.kind === "record") {
    if (isRunRecord(src)) return ["## How it has run"];
    if (isHeaded(src)) return ["## Versions"];
    return /^(json )?L\d+(-L\d+)?$/.test(place) ? ["## How to use it"] : [];
  }
  const head = place.split("/")[0];
  if (src === decl.src) {
    if (new RegExp(`^${esc(decl.offerings)}\\[\\d+\\]`).test(head)) return ["## How to use it"];
    if (head === decl.does || head === "agent_version") return ["## What it does"];
    if (head === decl.refusals || head.startsWith(`${decl.refusals}[`)) return ["## What it will not do"];
    if (head === decl.escalates || head.startsWith(`${decl.escalates}[`)) return ["## When it hands work back to a person"];
    if (head === decl.systems || head.startsWith(`${decl.systems}[`)) return ["## What it reaches"];
    if (head === decl.records || head.startsWith(`${decl.records}[`)) return ["## What it leaves behind", "## How to use it"];
  }
  if (src.kind === "agentdoc") {
    if (head.startsWith("not_stated[")) return ["## Not documented"];
    if (head === "sections.access") return ["## Where to send it work"];
    if (head === "sections.identity" || head === "assembled_at" || /^sources\[\d+\]\.agent_version$/.test(head)) return ["## What it does"];
  }
  return [];
}
/** The mark at a line's end: the last ` [S<n>: ` in it, so a source's own
 *  words that happen to hold one do not move it. */
function markOf(text) {
  if (text.endsWith(" [given]")) return { index: text.length - " [given]".length, given: true };
  const at = text.lastIndexOf(" [S");
  const m = at < 0 ? null : /^ \[(S\d+): (.+)\]$/.exec(text.slice(at));
  return m ? { index: at, id: m[1], place: m[2] } : null;
}
const LIST = /^(?:\s*-\s+|\d+\.\s+)/;

/** The lines about what was given that this job's inventory allows. */
function allowedGiven({ sources, leftOut, unreadable, decl, offs }) {
  const has = (k) => sources.some((s) => s.kind === k);
  const records = sources.filter((s) => s.kind === "record");
  const ok = new Set();
  if (!has("descriptor")) ok.add(GIVEN["no-descriptor"]());
  if (!has("agentdoc")) ok.add(GIVEN["no-agentdoc"]());
  if (!has("runtime")) ok.add(GIVEN["no-runtime"]());
  if (!has("verdict")) ok.add(GIVEN["no-verdict"]());
  if (!records.length) ok.add(GIVEN["no-records"]());
  const placed = new Set();
  for (const r of records) {
    if (hasCredential(r)) { ok.add(GIVEN.credential(r.name)); continue; }
    if (isEmptyRecord(r)) { ok.add(GIVEN.empty(r.name)); continue; }
    const i = offeringOf(r, offs);
    if (i >= 0) placed.add(i);
    else if (!isRunRecord(r) && !isHeaded(r)) ok.add(GIVEN["no-offering"](r.name));
  }
  offs.forEach((o, i) => { if (!placed.has(i)) ok.add(GIVEN["no-example"](jobIdOf(o, i))); });
  for (const u of unreadable) ok.add(GIVEN.unreadable(u.file, u.why));
  for (const l of leftOut) ok.add(GIVEN["left-out"](l.file, l.why));
  if (!offs.length) {
    ok.add(silence(decl.src.kind, decl.root, decl.offerings) ?? `The ${decl.src.kind === "agentdoc" ? "AgentDoc" : "agent descriptor"} declares no job.`);
  }
  return ok;
}

/** Check documentation against its sources. Pure. Returns { ok, findings,
 *  trace }, where trace is one entry per line that says something. */
export function checkDocs({ markdown = "", sources = [], leftOut = [], unreadable = [] } = {}) {
  const findings = [];
  const trace = [];
  const find = (n, text, why) => findings.push({ line: n + 1, text, why });
  const decl = declarationOf(sources);
  if (!decl) return { ok: false, findings: [{ line: 0, text: "", why: "there is no agent descriptor and no AgentDoc, so nothing can be checked" }], trace };
  const byId = new Map(sources.map((s) => [s.id, s]));
  const offs = offeringsOf(decl);
  const files = sources.filter((s) => s.kind === "record").map((s) => ({ name: s.name, original: s.original }));
  const given = allowedGiven({ sources, leftOut, unreadable, decl, offs });
  const doc = sources.find((s) => s.kind === "agentdoc");
  const lines = String(markdown).split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const byOffering = new Map();
  for (const r of sources.filter((s) => s.kind === "record" && showable(s))) {
    const i = offeringOf(r, offs);
    if (i >= 0) byOffering.set(i, (byOffering.get(i) ?? new Set()).add(r.name));
  }
  const marks = new Set();
  const marked = (id, path) => marks.add(`${id}: ${path}`);

  // The title and the header.
  const head = headerOf(sources);
  if (lines[0] !== head.title) find(0, lines[0] ?? "", `the title must be "${head.title}", from the AgentDoc's identity`);
  const header = [head.agent, head.version, `written_by: ${WRITER}`];
  let n = 1;
  if (lines[n] === "") n++;
  for (const h of header) { if (lines[n] !== h) find(n, lines[n] ?? "", `the header line must be "${h}"`); n++; }
  if (!/^written_at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(lines[n] ?? "")) find(n, lines[n] ?? "", "the header must end with written_at and a time"); n++;
  if (lines[n] === "") n++;
  for (const l of LEGEND) { if (lines[n] !== l) find(n, lines[n] ?? "", "the legend is not the fixed one"); n++; }

  let section = -1;
  let inOffering = -1;
  let sub = -1;
  const offeringHeads = new Set();
  const examples = new Set();
  const listedSources = new Set();
  for (; n < lines.length; n++) {
    const raw = lines[n];
    if (raw.trim() === "") continue;
    if (raw.startsWith("## ")) {
      const i = SECTIONS.indexOf(raw);
      if (i < 0) find(n, raw, "a section this agent does not write");
      else if (i <= section) find(n, raw, "a section out of order or twice");
      else section = i;
      inOffering = -1;
      sub = -1;
      continue;
    }
    if (raw.startsWith("### ")) {
      const i = offs.findIndex((o, k) => headingOf(o, k) === raw && !offeringHeads.has(k));
      if (SECTIONS[section] !== "## How to use it" || i < 0) find(n, raw, "a heading that is not a job the declaration names");
      else { offeringHeads.add(i); inOffering = i; }
      sub = -1;
      continue;
    }
    if (raw.startsWith("#### ")) {
      const k = SUBSECTIONS.indexOf(raw);
      if (k < 0 || inOffering < 0) find(n, raw, "a heading this agent does not write");
      else if (k <= sub) find(n, raw, "a part of a job out of order or twice");
      else sub = k;
      continue;
    }
    if (/^(`{3,}|~{3,})/.test(raw)) { find(n, raw, "an example block with no line saying which record it is from"); continue; }

    if (SECTIONS[section] === "## Sources") {
      const m = /^- (S\d+): `(.+)`, (.+), sha256 `([0-9a-f]{64})`$/.exec(raw);
      const s = m && byId.get(m[1]);
      const digest = s ? sha256(s.raw ?? Buffer.from(s.text)) : null;
      if (!s || s.name !== m[2] || KIND_WORDS[s.kind] !== m[3] || digest !== m[4]) find(n, raw, "a source line that does not match the file read: its name, its kind or its digest");
      else listedSources.add(m[1]);
      continue;
    }

    const text = raw.replace(LIST, "");
    const mm = markOf(text);
    if (!mm) { find(n, raw, "a line with no mark saying where it came from"); continue; }
    const said = text.slice(0, mm.index);
    if (mm.given) {
      if (SECTIONS[section] !== "## Not documented") find(n, raw, "a line about what was given outside Not documented");
      else if (given.has(said)) trace.push({ line: n + 1, source: "given", verdict: "pass" });
      else find(n, raw, "a line about what was given that the job's inventory does not bear out");
      continue;
    }
    const src = byId.get(mm.id);
    if (!src) { find(n, raw, `${mm.id} is not a source of this job`); continue; }
    let place = mm.place;

    if (/ withheld$/.test(place)) {
      place = place.replace(/ withheld$/, "");
      const r = src.json === undefined ? { found: false } : resolvePath(src.json, place);
      if (SECTIONS[section] !== "## Not documented") find(n, raw, "a withheld value outside Not documented");
      else if (!r.found || !looksSecret(r.value)) find(n, raw, `${src.id} at ${place} holds nothing that looks like a credential, so nothing was withheld`);
      else if (said !== withheld(src.kind, place)) find(n, raw, "a withheld value not in the words this agent says it in");
      else trace.push({ line: n + 1, source: src.id, place, template: "withheld", verdict: "pass" });
      continue;
    }
    if (/ absent$/.test(place)) {
      place = place.replace(/ absent$/, "");
      if (SECTIONS[section] !== "## Not documented") { find(n, raw, "a silence outside Not documented"); continue; }
      const r = src.json === undefined ? { found: false } : resolvePath(src.json, place);
      const expect = silence(src.kind, src.json, place);
      if (r.found && !isEmpty(r.value)) find(n, raw, `${src.id} does say something at ${place}, so it is not a silence`);
      else if (said !== expect) find(n, raw, "a silence that is not in the words this agent says a silence in");
      else trace.push({ line: n + 1, source: src.id, place, template: "silence", verdict: "pass" });
      continue;
    }

    if (!sectionsFor(src, place, decl).includes(SECTIONS[section])) { find(n, raw, `a line from ${src.id} at ${place} under the wrong heading`); continue; }
    if (/^(json )?L\d+(-L\d+)?$/.test(place)) {
      const r = rangeOf(src, place);
      if (!r) { find(n, raw, `${place} is not a range of lines in ${src.id}`); continue; }
      if (!showable(src)) { find(n, raw, `${src.name} is empty or looks like it holds a credential, and is quoted`); continue; }
      let k = n + 1;
      while (k < lines.length && lines[k].trim() === "") k++;
      const fence = /^(`{3,}|~{3,})(json|text)$/.exec(lines[k] ?? "");
      if (fence) {
        const intro = r.from === 1 && r.to === r.of ? `From ${code(src.name)}:` : `From ${code(src.name)}, lines ${r.from} to ${r.to} of ${r.of}:`;
        const end = lines.indexOf(fence[1], k + 1);
        const body = end < 0 ? null : lines.slice(k + 1, end);
        if (said !== intro) find(n, raw, `an example must be introduced as "${intro}"`);
        else if (!body || body.length !== r.lines.length || body.some((l, i) => l !== r.lines[i])) find(n, raw, `the example's lines are not ${src.name}'s lines ${r.from} to ${r.to}`);
        else if (inOffering < 0 || offeringOf(src, offs) !== inOffering) find(n, raw, `${src.name} is not a record of the job it is shown under`);
        else if (SUBSECTIONS[sub] !== "#### Examples") find(n, raw, "an example outside its job's Examples");
        else {
          trace.push({ line: n + 1, source: src.id, place, template: "example", verdict: "pass" });
          examples.add(inOffering);
        }
        n = end < 0 ? lines.length : end;
        continue;
      }
      const heading = r.from === r.to && /^#+\s+/.test(r.lines[0]) ? `${code(src.name)}: ${r.lines[0].replace(/^#+\s+/, "").trim()}` : null;
      if (said !== heading) find(n, raw, `a line marked ${place} must be ${src.name}'s heading as it stands`);
      else trace.push({ line: n + 1, source: src.id, place, template: "heading", verdict: "pass" });
      continue;
    }

    if (src.json === undefined) { find(n, raw, `${src.id} is not JSON, so ${place} is no place in it`); continue; }
    const r = resolvePath(src.json, place);
    if (!r.found) { find(n, raw, `${place} is not in ${src.id}`); continue; }
    const hit = renderAll(r.value, place, { files }).find((c) => c.line === said);
    if (!hit) { find(n, raw, `no template gives this line from ${src.id} at ${place}: it says something that place does not`); continue; }
    if (src === decl.src) {
      const om = new RegExp(`^${esc(decl.offerings)}\\[(\\d+)\\]`).exec(place);
      if (om && Number(om[1]) !== inOffering) { find(n, raw, `a line about job ${Number(om[1]) + 1} under another job's heading`); continue; }
      if (om) {
        const want = subsectionFor(place.split("/")[0].slice(om[0].length));
        const now = sub < 0 ? null : SUBSECTIONS[sub];
        if (want !== now) { find(n, raw, `a line about ${place} under ${now ?? "the job's own lines"}, where it belongs under ${want ?? "the job's own lines"}`); continue; }
      }
      if (!om && SECTIONS[section] === "## How to use it" && hit.id === "record-is" && SUBSECTIONS[sub] !== "#### Examples") { find(n, raw, "a record named outside its job's Examples"); continue; }
      if (SECTIONS[section] === "## How to use it" && !om && hit.id !== "record-is") { find(n, raw, "a line under How to use it that is about no job"); continue; }
      if (SECTIONS[section] === "## How to use it" && hit.id === "record-is" && !(byOffering.get(inOffering) ?? new Set()).has(said.slice(1, said.indexOf("`", 1)))) { find(n, raw, "a record named under a job it is not a record of"); continue; }
    }
    marked(src.id, place);
    trace.push({ line: n + 1, source: src.id, place, template: hit.id, verdict: "pass" });
  }

  // Coverage: the role's own test.
  const d = decl.src.id;
  offs.forEach((o, i) => {
    const p = `${decl.offerings}[${i}]`;
    const id = jobIdOf(o, i);
    if (!offeringHeads.has(i)) findings.push({ line: 0, text: "", why: `the job ${id} is declared and not documented` });
    (Array.isArray(o.inputs) ? o.inputs : []).forEach((_, j) => { if (!marks.has(`${d}: ${p}.inputs[${j}]`)) findings.push({ line: 0, text: "", why: `input ${j + 1} of ${id} is declared and not documented` }); });
    (Array.isArray(o.outputs) ? o.outputs : []).forEach((_, j) => { if (!marks.has(`${d}: ${p}.outputs[${j}]`)) findings.push({ line: 0, text: "", why: `output ${j + 1} of ${id} is declared and not documented` }); });
    if (!examples.has(i) && !String(markdown).includes(`- ${GIVEN["no-example"](id)} [given]`)) findings.push({ line: 0, text: "", why: `the job ${id} has no example and does not say it has none` });
  });
  const ref = resolvePath(decl.root, decl.refusals).value;
  if (typeof ref === "string" && ref.trim()) {
    const ls = linesOf(ref);
    const ok = ls.length === 1 && ref.trim() === ref ? marks.has(`${d}: ${decl.refusals}`) : ls.every((_, k) => marks.has(`${d}: ${decl.refusals}/${k}`));
    if (!ok) findings.push({ line: 0, text: "", why: "a refusal the declaration names is not documented" });
  } else if (Array.isArray(ref)) {
    ref.forEach((item, k) => {
      const q = `${decl.refusals}[${k}]`;
      const ls = typeof item === "string" ? linesOf(item) : [];
      const ok = typeof item === "string" && !(ls.length === 1 && item.trim() === item) ? ls.every((_, i) => marks.has(`${d}: ${q}/${i}`)) : marks.has(`${d}: ${q}`);
      if (!ok) findings.push({ line: 0, text: "", why: `refusal ${k + 1} the declaration names is not documented` });
    });
  }
  for (const s of sources) {
    if (!listedSources.has(s.id)) findings.push({ line: 0, text: "", why: `${s.id} (${s.name}) is not listed under Sources` });
    if (s.kind === "verdict" && !trace.some((t) => t.source === s.id)) findings.push({ line: 0, text: "", why: `the verdict ${s.name} was given and is not documented` });
  }
  if (doc) {
    const ns = resolvePath(doc.json, "not_stated").value;
    (Array.isArray(ns) ? ns : []).forEach((_, k) => { if (!marks.has(`${doc.id}: not_stated[${k}]`)) findings.push({ line: 0, text: "", why: `the AgentDoc's not-stated ${ns[k]} is not shown` }); });
  }
  return { ok: findings.length === 0, findings, trace };
}

