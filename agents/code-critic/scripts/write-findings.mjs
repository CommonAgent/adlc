// Write the findings: one Markdown document for a person, with a light
// header, and the reply.
//
// The document is the review. Its header says what was reviewed, how many
// findings there are and how many are still open; then one section per
// finding, each with its place, rule, claim, consequence and an Answer line
// that starts as open. The stage is done when every finding is answered, by
// a change or a reason (agenticdevelopment.ai, stage 07), so the document is
// also the form the answers are written on: a person writes a reason after
// Answer, or changes the code, and sends the document back with the package.
// The next review reads it and says, finding by finding, which were answered
// by a reason, which by a change (the finding no longer holds), and which are
// still open.
//
// The reply leads with the count and the open number, names the first few
// findings by place, says what the job went without, and says, when the
// message asked for a fix, that this role does not make one.
//
//   needs: node >= 22
//   RECORDS=<this job's records folder> [NOW=<ISO time>] [VERSION=<this agent's version>] node write-findings.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RULES } from "./house-rules.mjs";
import { paragraph } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const placeText = (p) => `${p.file}${p.line != null ? `:${p.line}` : ""}`;

/** The findings of an earlier review this agent wrote: [{id, place, rule, claim, answer}]. */
export function earlierFindings(text) {
  const out = [];
  const blocks = String(text ?? "").replace(/\r/g, "").split(/^### /m).slice(1);
  for (const b of blocks) {
    const head = /^(F\d+)\.\s*(.*)$/m.exec(b);
    if (!head) continue;
    const field = (k) => { const m = new RegExp(`^-\\s*${k}:\\s*(.*)$`, "mi").exec(b); return m ? trim(m[1]) : ""; };
    const place = /`?([^`\s]+?):(\d+)`?/.exec(field("Place"));
    const answer = field("Answer");
    out.push({
      id: head[1], title: trim(head[2]),
      place: place ? { file: place[1], line: Number(place[2]) } : null,
      rule: (field("Rule").split(/[\s(]/)[0] || "general").toLowerCase(),
      claim: field("Claim"),
      answer: /^(open\b|$)/i.test(answer) ? "" : answer,
    });
  }
  return out;
}

const near = (a, b) => a && b && a.file === b.file && Math.abs((a.line ?? 0) - (b.line ?? 0)) <= 5;

/** Each current finding with its answer carried from the earlier review,
 *  and each earlier finding with what became of it. */
export function answerAgainst(current, earlier) {
  const used = new Set();
  const findings = current.map((f) => {
    const twin = earlier.find((e) => !used.has(e.id) && e.rule === f.rule && near(e.place, f.place));
    if (!twin) return { ...f, answer: "" };
    used.add(twin.id);
    return { ...f, earlier: twin.id, answer: twin.answer };
  });
  const earlierOutcome = earlier.map((e) => {
    const now = findings.find((f) => f.earlier === e.id);
    if (e.answer) return { ...e, outcome: "reason" };
    if (!now) return { ...e, outcome: "change" };
    return { ...e, outcome: "open" };
  });
  return { findings, earlier: earlierOutcome };
}

const firstSentence = (s) => { const t = trim(s); const m = /^(.{20,160}?[.!?])(\s|$)/.exec(t); return m ? m[1] : t.slice(0, 160); };

/** The document. */
export function findingsDocument({ read, findings = [], outside = [], dropped = [], earlier = [], leftOut = [], wentWithout = "", reviewer = "code-critic", version = "", now = new Date().toISOString(), modelError = null }) {
  const who = `${read.package?.name ?? "the package"}${read.package?.version ? ` ${read.package.version}` : ""}`;
  const open = findings.filter((f) => !trim(f.answer)).length;
  const change = read.change?.scope === "diff"
    ? `the diff ${read.change.diff ?? ""} (${plural(read.change.files.length, "file")}), with the declarations as part of it`.replace("  ", " ")
    : "the whole package (no diff came)";
  const L = [];
  L.push(`# Review of ${who}`, "");
  L.push(`- package: ${who}`);
  L.push(`- change: ${change}`);
  L.push(`- findings: ${findings.length}`);
  L.push(`- open: ${open}`);
  L.push(`- reviewed_by: ${reviewer}${version ? ` ${version}` : ""}`);
  L.push(`- reviewed_at: ${now}`);
  L.push("");
  L.push("## Findings", "");
  if (!findings.length) L.push(modelError ? "The house-rule check found nothing, and the model's review could not be had (see Not reviewed)." : "None. Nothing in the change breaks a house rule, and the review found nothing worth a person's time.", "");
  findings.forEach((f, i) => {
    L.push(`### F${i + 1}. ${firstSentence(f.claim)}`, "");
    L.push(`- Place: \`${placeText(f.place)}\``);
    L.push(`- Rule: ${f.rule}${RULES[f.rule] ? ` (${RULES[f.rule]})` : " (general code quality)"}`);
    L.push(`- Claim: ${trim(f.claim)}`);
    L.push(`- Consequence: ${trim(f.consequence)}`);
    L.push(`- Found by: ${f.source === "house rule" ? "the house-rule check" : "the review"}${f.earlier ? `; ${f.earlier} in the earlier review` : ""}`);
    L.push(`- Answer: ${trim(f.answer) ? `${trim(f.answer)} (carried from the earlier review)` : "open"}`);
    L.push("");
  });
  if (earlier.length) {
    L.push("## Answers to the earlier review", "");
    for (const e of earlier) {
      const at = e.place ? ` at \`${placeText(e.place)}\`` : "";
      if (e.outcome === "reason") L.push(`- ${e.id}${at}: answered by a reason: ${e.answer}`);
      else if (e.outcome === "change") L.push(`- ${e.id}${at}: answered by a change; it no longer holds.`);
      else L.push(`- ${e.id}${at}: still open, and found again above.`);
    }
    L.push("");
  }
  if (read.change?.scope === "diff") {
    L.push("## Outside the change", "");
    if (!outside.length) L.push("Nothing.");
    for (const f of outside) L.push(`- \`${placeText(f.place)}\` (${f.rule}): ${trim(f.claim)}`);
    L.push("");
  }
  L.push("## Not reviewed", "");
  const notes = [];
  const skipped = read.files.filter((f) => !["declaration", "script", "test"].includes(f.role)).map((f) => f.path);
  if (skipped.length) notes.push(`Read as context and not reviewed: ${skipped.join(", ")}.`);
  if (leftOut.length) notes.push(`Left out of the model's review for room: ${leftOut.join(", ")}. The house-rule check read them.`);
  if (!read.files.some((f) => f.role === "test")) notes.push("No tests came with the change, so nothing here says whether the code is tested.");
  if (!read.account) notes.push("The Code stage's account did not come, so the code was not held to what its writer says it did.");
  if (dropped.length) notes.push(`${plural(dropped.length, "thing")} the model said ${dropped.length === 1 ? "was" : "were"} dropped, each for naming no place or grading the work; they are in the job's records (checked.json) with the reason.`);
  for (const n of read.notes ?? []) notes.push(`${trim(n).replace(/\.$/, "")}.`);
  if (trim(wentWithout)) notes.push(trim(wentWithout));
  L.push(notes.length ? notes.map((n) => `- ${n}`).join("\n") : "Nothing was left out.", "");
  L.push("## How to answer", "");
  L.push("Answer each finding by a change or a reason. For a reason, write it after `Answer:` in place of `open`. For a change, change the code. Then send this document back with the package, and the next review says which findings are answered and which are still open. The review is done when `open` is 0. Whether to accept a finding is yours to decide; nothing here changes the code.");
  L.push("");
  return L.join("\n");
}

const FIX_ASK = /\b(fix|patch|rewrite|apply the fix|change the code|open (a |an )?(pull request|pr)\b|make it pass)\b/i;

/** The reply. */
export function replyText({ read, findings = [], wentWithout = "", modelError = null }) {
  const who = `${read.package?.name ?? "the package"}${read.package?.version ? ` ${read.package.version}` : ""}`;
  const open = findings.filter((f) => !trim(f.answer)).length;
  const lines = [];
  const scope = read.change?.scope === "diff" ? "the change" : "the whole package";
  lines.push(findings.length
    ? `Reviewed ${scope} of ${who}: ${plural(findings.length, "finding")}, ${open} open.`
    : `Reviewed ${scope} of ${who}: no findings${modelError ? " from the house-rule check, and the model's review could not be had" : ""}.`);
  if (findings.length) {
    lines.push(findings.slice(0, 3).map((f, i) => `F${i + 1} at ${placeText(f.place)}: ${firstSentence(f.claim)}`).join("\n"));
    if (findings.length > 3) lines.push(`The other ${plural(findings.length - 3, "finding")} ${findings.length - 3 === 1 ? "is" : "are"} in the document.`);
  }
  if (FIX_ASK.test(read.asked ?? "")) lines.push("You asked for a change to the code. This role does not make one: it reports findings, and the change is for whoever owns the code.");
  if (trim(wentWithout)) lines.push(trim(wentWithout));
  lines.push(open === 0 && findings.length ? "Every finding is answered." : "The findings document has one section per finding; answer each by a change or a reason, and send the document back with the package for the next review.");
  return lines.join("\n\n");
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  if (!RECORDS) { console.error("RECORDS is required"); process.exit(2); }
  const readJson = (n) => { const p = join(RECORDS, n); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
  const read = readJson("read.json");
  const house = readJson("house-rules.json") ?? { findings: [], outside_the_change: [] };
  const checked = readJson("checked.json") ?? { kept: [], outside_the_change: [], dropped: [] };
  const rev = readJson("review.json") ?? {};
  const earlierText = existsSync(join(RECORDS, "earlier-review.md")) ? readFileSync(join(RECORDS, "earlier-review.md"), "utf8") : "";
  const current = [...(house.findings ?? []), ...(checked.kept ?? [])];
  const { findings, earlier } = answerAgainst(current, earlierFindings(earlierText));
  const wentWithout = paragraph(RECORDS);
  const doc = findingsDocument({
    read, findings, outside: [...(house.outside_the_change ?? []), ...(checked.outside_the_change ?? [])],
    dropped: checked.dropped ?? [], earlier, leftOut: rev.left ?? [], wentWithout, modelError: rev.error ?? null,
    version: process.env.VERSION ?? "", now: process.env.NOW || new Date().toISOString(),
  });
  writeFileSync(join(RECORDS, "findings.md"), doc);
  const reply = replyText({ read, findings, wentWithout, modelError: rev.error ?? null });
  console.log(JSON.stringify({ ok: true, code: 0, findings: findings.length, open: findings.filter((f) => !trim(f.answer)).length, reply }));
}
