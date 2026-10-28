// The reply: what the record says, what is still open, and what the job went
// without.
//
// The record always goes, finished or not. A record with a question open is
// most of the work, and reading it is what lets somebody answer the question;
// holding it back to ask first costs a round trip and gives nothing. What must
// never happen is the other thing: a record that arrives looking finished when
// a binding, a limit or a destination in it was filled in for somebody.
//
//   needs: node >= 22
//   RECORDS=<records folder> node reply.mjs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord, questionsIn } from "./architecture-record.mjs";
import { paragraph } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const many = (n, one, more) => `${WORDS[n] ?? n} ${n === 1 ? one : more ?? `${one}s`}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** One sentence per system: what stands behind it, and where that came from. */
export function bindingLine(header) {
  const out = [];
  for (const s of header.systems) {
    const per = header.environments.map((e) => {
      const b = header.bindings?.[s]?.[e];
      return !b || b.unbound ? `${e} unbound` : `${e} ${b.product}${b.provided_by === "customer" ? " (yours)" : " (platform default)"}`;
    });
    out.push(`${s}: ${per.join(", ")}`);
  }
  return out.length ? `Bindings: ${out.join("; ")}.` : "It reaches no system outside its own folder, so nothing is bound.";
}

/** The whole reply. */
export function replyText({ recordText, checks = {}, wentWithout = "", changed = null, findings = [], notes = [] } = {}) {
  const header = parseRecord(recordText);
  const questions = questionsIn(recordText);
  const lines = [];
  const systems = header.systems.length ? `names ${many(header.systems.length, "system")} (${list(header.systems)})` : "names no system";
  lines.push(`The architecture record ${systems} for ${list(header.environments)}, with the agent's kind (${header.kind}), its dependencies, limits, egress, formats and settings, and every decision with its reason.`);
  if (changed) lines.push(`This revises the earlier record: ${many(changed.changed_lines ?? 0, "line")} changed and ${many(changed.changed_decisions ?? 0, "decision")} with ${changed.changed_decisions === 1 ? "its" : "their"} reason, listed in what changed.`);
  lines.push(bindingLine(header));
  if (!header.done && !questions.length) {
    lines.push(`The record is not finished: ${(checks.problems ?? []).join("; ") || "its check did not pass"}.`);
  } else if (questions.length) {
    lines.push(`${cap(many(questions.length, "thing"))} ${questions.length === 1 ? "is" : "are"} still open, and the record is not finished until ${questions.length === 1 ? "it is" : "they are"} answered. I have not filled ${questions.length === 1 ? "it" : "any of them"} in: a binding nobody chose, a spending limit, a destination beyond the derived set and access the statement never asked for are all commitments somebody would be held to.`);
    lines.push(questions.map((q) => `\n${q.key}: ${q.question}`).join("") + "\n");
    lines.push("Answer with one line per question, key: answer, and send the record back with it.");
  } else {
    lines.push("The record is finished: every system is named and bound in each environment, and every decision has its reason. The Design takes it next, and designs only with these systems.");
  }
  if (findings.length) lines.push(`The architecture was asked for twice and ${findings.length === 1 ? "this still stands" : "these still stand"}: ${findings.join("; ")}.`);
  if (notes.length) lines.push(`Put right in code rather than taken from the model: ${notes.join("; ")}.`);
  if (trim(wentWithout)) lines.push(trim(wentWithout));
  return lines.join(" ");
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  if (!RECORDS) { console.error("RECORDS is required"); process.exit(2); }
  try {
    const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
    const recordText = readFileSync(join(RECORDS, "record.md"), "utf8");
    const checks = readJson(join(RECORDS, "checks.json")) ?? {};
    const named = readJson(join(RECORDS, "named.json")) ?? {};
    const asked = readJson(join(RECORDS, "asked.json")) ?? {};
    const reply = replyText({
      recordText, checks, findings: named.findings ?? [], notes: named.notes ?? [],
      changed: asked.revision ? checks : null, wentWithout: paragraph(RECORDS),
    });
    console.log(JSON.stringify({ ok: true, code: 0, reply, done: checks.done === true, still_open: questionsIn(recordText).map((q) => q.key) }));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
