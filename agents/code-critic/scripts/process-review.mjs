// Review a process document (review-a-process): a build whose artifact is an
// Agent Processes document is reviewed against the process rules
// (process-rules.mjs, standards/process-rules.mjs byte for byte), with no
// model: the four tests of §20.1, which phases a person signs and whether the
// document says why, which phases act in the world and whether a person signs
// before each, and no line outside the extensions: block. The findings are
// written in this agent's own format (write-findings.mjs): Place, Rule, Claim,
// Consequence, Found by and Answer per finding, and an earlier review sent
// back is answered against, as for a package.
//
//   read the process          processAmong        no model
//   check the process rules   processFindings     no model
//
//   needs: node >= 22
//   import { reviewProcessJob } from "./process-review.mjs"  (job.mjs routes a process here)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { reviewProcess, RULES } from "./process-rules.mjs";
import { answerAgainst, earlierFindings } from "./write-findings.mjs";
import { looksLikeReview } from "./read-change.mjs";

const trim = (s) => String(s ?? "").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const placeText = (p) => `${p.file}${p.line != null ? `:${p.line}` : ""}`;
const firstSentence = (s) => { const t = trim(s); const m = /^(.{20,200}?[.!?])(\s|$)/.exec(t); return m ? m[1] : t.slice(0, 200); };
const MAX_BYTES = 1_000_000;

/** Whether a text is a process document: a PROCESS: line and a phases: part. */
export const isProcess = (text) => /^\s*PROCESS:/m.test(String(text ?? "")) && /^phases:/m.test(String(text ?? "").replace(/\r/g, ""));

/** The process document among what was given ({ name, text }), the attached files first, then the message; null when none is one. */
export function processAmong(files = [], asked = "") {
  for (const f of files) {
    try {
      if (!existsSync(f.path) || statSync(f.path).size > MAX_BYTES) continue;
      const text = readFileSync(f.path, "utf8");
      if (isProcess(text) && !looksLikeReview(text)) return { name: basename(f.path), text };
    } catch { /* not a text this review can read */ }
  }
  return isProcess(asked) ? { name: "the message", text: String(asked) } : null;
}

/** An earlier findings document among the files, as text, or "". */
export function earlierAmong(files = []) {
  for (const f of files) {
    try {
      if (!/\.md$/i.test(f.path) || !existsSync(f.path) || statSync(f.path).size > MAX_BYTES) continue;
      const text = readFileSync(f.path, "utf8");
      if (looksLikeReview(text)) return text;
    } catch { /* unreadable */ }
  }
  return "";
}

/** The process rules' findings, each placed at the document's line, in this agent's terms. */
export function processFindings(text, file) {
  const review = reviewProcess(text);
  const findings = review.findings.map((f) => ({ place: { file, line: f.line || 1 }, rule: f.rule, claim: f.claim, consequence: f.consequence, source: "house rule", ...(f.phase ? { phase: f.phase } : {}) }));
  return { review, findings };
}

/** The findings document, with the same headings as a package's review. */
export function processFindingsDocument({ review, findings = [], earlier = [], file, version = "", now = new Date().toISOString(), reviewer = "code-critic" }) {
  const who = `${review.document.id || "the process"}${review.document.version ? ` ${review.document.version}` : ""}`;
  const open = findings.filter((f) => !trim(f.answer)).length;
  const L = [];
  L.push(`# Review of ${who}`, "");
  L.push(`- package: ${who}`);
  L.push(`- change: the process document ${file} (shape ${review.digest})`);
  L.push(`- findings: ${findings.length}`);
  L.push(`- open: ${open}`);
  L.push(`- reviewed_by: ${reviewer}${version ? ` ${version}` : ""}`);
  L.push(`- reviewed_at: ${now}`, "");
  L.push("## Findings", "");
  if (!findings.length) L.push("None. The document passes the process rules: every phase that acts in the world has a person's yes before it, every gate says why, nothing outside the extensions block is undefined, and the four tests send nothing elsewhere.", "");
  findings.forEach((f, i) => {
    L.push(`### F${i + 1}. ${firstSentence(f.claim)}`, "");
    L.push(`- Place: \`${placeText(f.place)}\``);
    L.push(`- Rule: ${f.rule}${RULES[f.rule] ? ` (${RULES[f.rule]})` : ""}`);
    L.push(`- Claim: ${trim(f.claim)}`);
    L.push(`- Consequence: ${trim(f.consequence)}`);
    L.push(`- Found by: the process rules${f.earlier ? `; ${f.earlier} in the earlier review` : ""}`);
    L.push(`- Answer: ${trim(f.answer) ? `${trim(f.answer)} (carried from the earlier review)` : "open"}`);
    L.push("");
  });
  L.push("## Signed and acting", "");
  L.push("Which phases a person signs (Agent Processes §7) and which act in the world (§21.3), as the rules read them. This is what the findings above stand on, not more findings.", "");
  if (!review.signs.length) L.push("- No phase is signed by a person.");
  for (const s of review.signs) L.push(`- ${s.phase} is signed by ${s.owner || "nobody named"} (${s.automation})${s.why ? `: ${s.why}` : ", and the document says no why"}.`);
  if (!review.acts.length) L.push("- No phase acts in the world.");
  for (const a of review.acts) L.push(`- ${a.phase} ${a.how}, ${a.gated ? `with a person's yes before it (${a.by === a.phase ? `its own level` : a.by})` : "with no person's yes before it"}.`);
  L.push("");
  L.push("## Warnings", "");
  L.push("None: a process document carries no scripts, so no network address is listed.", "");
  L.push("## Answers to the earlier review", "");
  if (!earlier.length) L.push("No earlier findings came with this document.", "");
  else {
    for (const e of earlier) {
      const at = e.place ? ` at \`${placeText(e.place)}\`` : "";
      if (e.outcome === "reason") L.push(`- ${e.id}${at}: answered by a reason: ${e.answer}`);
      else if (e.outcome === "change") L.push(`- ${e.id}${at}: answered by a change; it no longer holds.`);
      else L.push(`- ${e.id}${at}: still open, and found again above.`);
    }
    L.push("");
  }
  L.push("## Outside the change", "");
  L.push("No diff came, so the whole document is the change and nothing is outside it.", "");
  L.push("## Not reviewed", "");
  L.push("- The holders' own packages: each agent a phase names is reviewed as a package of its own.");
  L.push("- Whether the goal is a state, whether the trigger is observable, and whether each phase's words are true of the work: a reader's judgment, not a program's.");
  L.push("");
  L.push("## How to answer", "");
  L.push("Answer each finding by a change or a reason. For a reason, write it after `Answer:` in place of `open`. For a change, change the document. Then send this document back with the process document, and the next review says which findings are answered and which are still open. The review is done when `open` is 0. Whether to accept a finding is yours to decide; nothing here changes the document.");
  L.push("");
  return L.join("\n");
}

/** The reply. */
export function processReply({ review, findings }) {
  const who = `${review.document.id || "the process"}${review.document.version ? ` ${review.document.version}` : ""}`;
  const open = findings.filter((f) => !trim(f.answer)).length;
  const lines = [findings.length ? `Reviewed the process ${who}: ${plural(findings.length, "finding")}, ${open} open.` : `Reviewed the process ${who}: no findings against the process rules.`];
  if (findings.length) {
    lines.push(findings.slice(0, 3).map((f, i) => `F${i + 1} at ${placeText(f.place)}: ${firstSentence(f.claim)}`).join("\n"));
    if (findings.length > 3) lines.push(`The other ${plural(findings.length - 3, "finding")} ${findings.length - 3 === 1 ? "is" : "are"} in the document.`);
  }
  lines.push(open === 0 && findings.length ? "Every finding is answered." : "The findings document has one section per finding; answer each by a change or a reason, and send it back with the process document for the next review.");
  return lines.join("\n\n");
}

export const PROCESS_PIECE = { name: "the findings", step: "check-the-process-rules", path: "out/findings.md", media_type: "text/markdown" };

/** The whole review of a process: records, the findings document as the one piece, and the reply. */
export function reviewProcessJob({ job, records, found, files = [], version = "", now = new Date().toISOString() }) {
  mkdirSync(records, { recursive: true });
  const { review, findings: current } = processFindings(found.text, found.name);
  const { findings, earlier } = answerAgainst(current, earlierFindings(earlierAmong(files)));
  writeFileSync(join(records, "process-review.json"), JSON.stringify({ process_review: "v1", document: review.document, digest: review.digest, text_digest: review.text_digest, conforms: review.conforms, findings, signs: review.signs, acts: review.acts }, null, 2) + "\n");
  const doc = processFindingsDocument({ review, findings, earlier, file: found.name, version, now });
  writeFileSync(join(records, "findings.md"), doc);
  let pieces = null, note = null;
  try {
    mkdirSync(join(job, "out"), { recursive: true });
    writeFileSync(join(job, PROCESS_PIECE.path), doc);
    const entry = { ...PROCESS_PIECE, about: `The review of the process ${review.document.id} ${review.document.version}: ${findings.length} findings, ${findings.filter((f) => !trim(f.answer)).length} open, each with its place, rule, claim, consequence and an Answer line to write a reason on.`, produced_from: ["the process document"] };
    writeFileSync(join(job, "pieces.json"), JSON.stringify([entry], null, 2) + "\n");
    pieces = "pieces.json";
  } catch (e) { note = `the findings were not filed: ${e.message}`; }
  return { ok: true, code: 0, reply: processReply({ review, findings }), pieces, findings: findings.length, open: findings.filter((f) => !trim(f.answer)).length, ...(note ? { note } : {}) };
}
