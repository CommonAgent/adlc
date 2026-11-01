// The coverage check for a process's test cases: Agent Processes 0.9.0 §21
// test cases read against the document they test, and refused when the suite
// does not hold the process to its own approvals and ways back.
//
// THE RULE. Every phase a person signs (automation: never or supervised) has
// each of its answers, approve, changes and reject, exercised at least once
// across the suite, and every deviation (way back) is taken at least once. A
// suite that misses one is refused, naming what it missed.
//
// A test case is the plain text §21.1 gives, one case to a file:
//
//   TEST: <name>        for: <the document's id>
//                       digest: sha256:<the document's digest>
//   carried: <item> = <value>
//   answer: <phase> = approve | changes: [<deviation key>] <words> | reject: <reason>
//   stand-in: <phase> = <what the phase returns in place of acting>
//   expect: goal reached | goal not reached | ran <phase>, <phase>, ... | <words>
//
// A `changes:` answer takes a way back: the one its words name first in square
// brackets; without a key, the one keyed `changes` that leaves that phase, or
// the only one that does. At a phase that signs and has no way back it sends
// the phase's own work back to it. An answer may be given at a phase a person
// signs, or at a phase a way back leaves (the owner's word on what the phase
// reported, as the process runner takes it).
//
// Each case is also refused when it was written for another document or
// another digest (a runtime refuses it, §21.1), names a phase, an item or a
// way back the document does not have, leaves out an item the trigger
// requires (§5.4), or gives an answer in another form.
//
//   needs: node >= 22
//   node check-cases.mjs --process <document> <case file or folder>...
//   PROCESS=<document> CASES=<folder> [RECORDS=<records folder>] node check-cases.mjs
//   prints one JSON object { ok, cases, covered, missing, problems, reply };
//   with RECORDS it is also kept as RECORDS/cases-checked.json
//   exit 0 the suite covers the rule, 1 it is refused, 2 called wrong, 3 no cases
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, digestOf } from "./process-check.mjs";

export const ANSWERS = ["approve", "changes", "reject"];
export const SIGNED_LEVELS = ["never", "supervised"];
const KEYS = ["TEST", "carried", "answer", "stand-in", "expect"];
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One answer as written: approve, changes: [key] words, or reject: reason. */
export function readAnswer(text) {
  const t = one(text);
  if (/^approve$/i.test(t)) return { answer: "approve" };
  const m = /^(changes|reject)\s*:\s*(.*)$/i.exec(t);
  if (!m) return { error: `"${t}" is not an answer: approve, changes: <words> or reject: <reason>` };
  const kind = m[1].toLowerCase();
  let words = one(m[2]);
  let deviation = null;
  const k = /^\[([^\]]*)\]\s*(.*)$/.exec(words);
  if (kind === "changes" && k) { deviation = one(k[1]); words = one(k[2]); }
  if (!words) return { error: kind === "changes" ? "changes: carries no words saying what is wrong" : "reject: carries no reason" };
  return { answer: kind, words, deviation };
}

/** A test case's text, read. Never throws; what is wrong is in `problems`. */
export function parseCase(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const entries = [];
  const problems = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = /^([A-Za-z][A-Za-z-]*):(?:\s+(.*)|\s*)$/.exec(l);
    if (m && KEYS.includes(m[1])) { entries.push({ key: m[1], text: m[2] ?? "" }); continue; }
    if (/^\s/.test(l) && entries.length) { entries[entries.length - 1].text += ` ${l.trim()}`; continue; }
    problems.push(`"${one(l)}" is not a line a test case carries (TEST:, carried:, answer:, stand-in:, expect:)`);
  }
  const c = { name: "", for: "", digest: "", carried: [], answers: [], standIns: [], expect: { goal: null, ran: null, other: [] }, problems };
  const tests = entries.filter((e) => e.key === "TEST");
  if (!tests.length) problems.push("it has no TEST: line naming the case");
  if (tests.length > 1) problems.push("it has more than one TEST: line; one case to a file");
  if (tests.length) {
    const t = one(tests[0].text);
    const name = /^(\S+)/.exec(t)?.[1] ?? "";
    c.name = /^(for|digest):$/.test(name) ? "" : name;
    c.for = /(?:^|\s)for:\s*(\S+)/.exec(t)?.[1] ?? "";
    c.digest = /(?:^|\s)digest:\s*(\S+)/.exec(t)?.[1] ?? "";
    if (!c.name) problems.push("TEST: names no case");
    else if (!KEBAB.test(c.name)) problems.push(`the case's name ${c.name} is not lowercase and hyphenated`);
    if (!c.for) problems.push("TEST: names no document (for: <id>)");
    if (!c.digest) problems.push("TEST: names no digest (digest: sha256:<the document's digest>)");
  }
  for (const e of entries) {
    const t = one(e.text);
    if (e.key === "carried" || e.key === "answer" || e.key === "stand-in") {
      const m = /^(\S+)\s*=\s*(.*)$/.exec(t);
      if (!m) { problems.push(`"${e.key}: ${t}" is not <key> = <value>`); continue; }
      if (e.key === "carried") c.carried.push({ item: m[1], value: one(m[2]) });
      else if (e.key === "stand-in") { if (!one(m[2])) problems.push(`stand-in: ${m[1]} says nothing it returns`); c.standIns.push({ phase: m[1], text: one(m[2]) }); }
      else {
        const a = readAnswer(m[2]);
        if (a.error) problems.push(`answer: ${m[1]}: ${a.error}`);
        else c.answers.push({ phase: m[1], ...a });
      }
    } else if (e.key === "expect") {
      if (/^goal reached$/i.test(t)) c.expect.goal = true;
      else if (/^goal not reached$/i.test(t)) c.expect.goal = false;
      else if (/^ran\s+/i.test(t)) c.expect.ran = t.replace(/^ran\s+/i, "").split(/\s*,\s*/).map(one).filter(Boolean);
      else c.expect.other.push(t);
    }
  }
  if (!entries.some((e) => e.key === "expect")) problems.push("it has no expect: line saying what must be true when the run ends");
  return c;
}

/** What a suite must cover, read from the document: the phases a person
 *  signs, every way back, and the items the trigger requires. */
export function needsOf(doc) {
  return {
    signed: (doc.phases ?? []).filter((p) => SIGNED_LEVELS.includes(p.automation)).map((p) => ({ phase: p.name, owner: p.owner, automation: p.automation, answers: [...ANSWERS] })),
    deviations: (doc.deviations ?? []).filter((d) => !d.malformed).map((d) => ({ from: d.from, to: d.to, key: d.key ?? `${d.from}->${d.to}`, keyed: d.key !== null, text: d.text })),
    required: (doc.carries ?? []).filter((c) => c.required && c.name).map((c) => c.name),
    items: (doc.carries ?? []).filter((c) => c.name).map((c) => c.name),
  };
}

/** The way back a changes: answer at a phase takes: { key } or { redo } or { error }. */
export function wayBack(needs, phase, deviation) {
  const from = needs.deviations.filter((d) => d.from === phase || d.from === "any");
  if (deviation) {
    const hit = from.find((d) => d.key === deviation);
    if (hit) return { key: hit.key };
    const elsewhere = needs.deviations.find((d) => d.key === deviation);
    return { error: elsewhere ? `the way back [${deviation}] leaves ${elsewhere.from}, not ${phase}` : `the document has no way back [${deviation}]` };
  }
  const keyed = from.find((d) => d.key === "changes");
  if (keyed) return { key: keyed.key };
  if (from.length === 1) return { key: from[0].key };
  if (!from.length) return { redo: true };
  return { error: `${phase} has ${from.length} ways back (${from.map((d) => `[${d.key}]`).join(", ")}) and none keyed changes; write changes: [<key>] <words>` };
}

/** The suite read against the document. `cases` is [{ file, text }]. */
export function checkCases(processText, cases = []) {
  const doc = parseDocument(processText);
  const digest = digestOf(processText);
  const needs = needsOf(doc);
  const problems = [];
  const phases = new Set(doc.phases.map((p) => p.name));
  const signed = new Set(needs.signed.map((s) => s.phase));
  const leaves = new Set(needs.deviations.map((d) => d.from));
  const covered = { signed: Object.fromEntries(needs.signed.map((s) => [s.phase, []])), deviations: [], by: {} };
  const by = (k, who) => { (covered.by[k] ??= []).includes(who) || covered.by[k].push(who); };
  if (!doc.has.PROCESS || !doc.phases.length) problems.push("the document is not a process document with phases, so there is nothing to hold the cases to");
  const names = new Map();
  for (const { file, text } of cases) {
    const c = parseCase(text);
    const who = c.name || file || "a case";
    for (const p of c.problems) problems.push(`${who}: ${p}`);
    if (c.name) {
      if (names.has(c.name)) problems.push(`${c.name}: two cases carry this name (${names.get(c.name)} and ${file}); each case is named once`);
      else names.set(c.name, file);
    }
    if (c.for && doc.id && c.for !== doc.id) problems.push(`${who}: it is written for ${c.for}, and this document is ${doc.id}`);
    if (c.digest && c.digest !== digest) problems.push(`${who}: it is pinned to the digest ${c.digest}, and the document's digest is ${digest}; a runtime refuses a case written for another digest (§21.1)`);
    for (const k of c.carried) if (needs.items.length && !needs.items.includes(k.item)) problems.push(`${who}: carried: ${k.item} is not an item the trigger carries${needs.items.length ? ` (${needs.items.join(", ")})` : ""}`);
    for (const r of needs.required) if (!c.carried.some((k) => k.item === r)) problems.push(`${who}: it does not carry ${r}, an item the trigger marks required, so the run would be refused before it starts`);
    for (const a of c.answers) {
      if (!phases.has(a.phase)) { problems.push(`${who}: answer: ${a.phase} is not a phase of the document`); continue; }
      if (!signed.has(a.phase) && !leaves.has(a.phase) && !leaves.has("any")) { problems.push(`${who}: answer: ${a.phase} is a phase nobody signs and no way back leaves, so nothing waits for that answer`); continue; }
      if (a.answer === "changes") {
        const w = wayBack(needs, a.phase, a.deviation);
        if (w.error) { problems.push(`${who}: answer: ${a.phase} = changes: ${w.error}`); continue; }
        if (w.key && !covered.deviations.includes(w.key)) covered.deviations.push(w.key);
        if (w.key) by(`way back ${w.key}`, who);
        if (w.redo && !signed.has(a.phase)) { problems.push(`${who}: answer: ${a.phase} sends work back, and no way back leaves it`); continue; }
      }
      if (signed.has(a.phase) && !covered.signed[a.phase].includes(a.answer)) covered.signed[a.phase].push(a.answer);
      if (signed.has(a.phase)) by(`${a.phase} ${a.answer}`, who);
    }
    for (const s of c.standIns) if (!phases.has(s.phase)) problems.push(`${who}: stand-in: ${s.phase} is not a phase of the document`);
    for (const p of c.expect.ran ?? []) if (!phases.has(p)) problems.push(`${who}: expect: ran names ${p}, which is not a phase of the document`);
  }
  const missing = [];
  for (const s of needs.signed) for (const a of ANSWERS) if (!covered.signed[s.phase].includes(a)) missing.push(`${s.phase} (automation: ${s.automation}) is never answered ${a}`);
  for (const d of needs.deviations) if (!covered.deviations.includes(d.key)) missing.push(`the way back ${d.from} -> ${d.to} [${d.key}] is never taken`);
  const ok = cases.length > 0 && problems.length === 0 && missing.length === 0;
  return { ok, cases: cases.length, digest, id: doc.id, needs, covered, missing, problems, reply: replyOf({ ok, cases: cases.length, needs, missing, problems }) };
}

/** The verdict in words. */
export function replyOf({ ok, cases, needs, missing, problems }) {
  const rule = `${needs.signed.length} phase${needs.signed.length === 1 ? "" : "s"} a person signs, each answered approve, changes and reject, and ${needs.deviations.length} way${needs.deviations.length === 1 ? "" : "s"} back, each taken`;
  if (ok) return `The suite of ${cases} test case${cases === 1 ? "" : "s"} covers the rule: ${rule}.`;
  const what = [...missing, ...problems];
  return `The coverage check refuses these test cases (${cases} of them). The rule is ${rule}. ${what.length} thing${what.length === 1 ? "" : "s"} stand in the way: ${what.join("; ")}.`;
}

/** The case files under the paths given: each file, and every *.test.txt in a folder. */
export function caseFiles(paths = []) {
  const out = [];
  for (const p of paths) {
    if (!p || !existsSync(p)) continue;
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).filter((x) => x.endsWith(".test.txt")).sort()) out.push({ file: f, text: readFileSync(join(p, f), "utf8") });
    } else out.push({ file: p.replace(/\\/g, "/").split("/").pop(), text: readFileSync(p, "utf8") });
  }
  return out;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(`/${thisFile}`)) {
  const args = process.argv.slice(2);
  let doc = process.env.PROCESS || null;
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--process") doc = args[++i];
    else paths.push(args[i]);
  }
  if (process.env.CASES) paths.push(process.env.CASES);
  if (!doc || !existsSync(doc)) { console.error("usage: node check-cases.mjs --process <document> <case file or folder>... (or PROCESS and CASES)"); process.exit(2); }
  const cases = caseFiles(paths);
  if (!cases.length) { console.log(JSON.stringify({ ok: false, cases: 0, reply: "There are no test cases to check: no *.test.txt file was found." })); process.exit(3); }
  const r = checkCases(readFileSync(doc, "utf8"), cases);
  const out = { ok: r.ok, cases: r.cases, id: r.id, digest: r.digest, covered: r.covered, missing: r.missing, problems: r.problems, reply: r.reply };
  if (process.env.RECORDS) {
    try { writeFileSync(join(process.env.RECORDS, "cases-checked.json"), `${JSON.stringify({ cases_checked: "v1", ...out }, null, 2)}\n`); } catch { /* the reading is still printed */ }
  }
  console.log(JSON.stringify(out));
  process.exit(r.ok ? 0 : 1);
}
