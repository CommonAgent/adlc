// Review a process document (review-a-process): the Security stage of a
// build whose artifact is an Agent Processes document. The document is held
// to the process rules (process-rules.mjs, standards/process-rules.mjs byte
// for byte), with no model, and the review is written as this agent's own
// security-review-v1: what the process reaches (its systems: line), which of
// its phases act in the world and whether a person signs before each, what it
// must never do (its policy), what has no recorded reason, and the verdict.
//
// It refuses a process in which a phase sends to somebody outside, posts,
// publishes, pays or signs with no person's yes before it (§21.3, §7.1), and
// one whose extension lines change the work (§20.1, §20.3), since either lets
// a run act with nobody having said yes. A gate whose document gives no
// reason is flagged under No reason recorded and refuses nothing.
//
//   read the process          processAmong        no model
//   check the process rules   processAssessment   no model
//
//   needs: node >= 22
//   import { reviewProcessJob } from "./review-process.mjs"  (review-package.mjs routes a process here)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { reviewProcess } from "./process-rules.mjs";
import { parseDocument } from "./process-check.mjs";
import { FORMAT } from "./write-review.mjs";

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const MAX_BYTES = 1_000_000;
const UNSAFE = new RegExp("[\u007f-\u009f  ]", "g");
const q = (v) => JSON.stringify(String(v ?? "")).replace(UNSAFE, (c) => "\\u" + `${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const many = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

/** Whether a text is a process document: a PROCESS: line and a phases: part. */
export const isProcess = (text) => /^\s*PROCESS:/m.test(String(text ?? "")) && /^phases:/m.test(String(text ?? "").replace(/\r/g, ""));

/** The process document among the attached files, then in the message ({ name, text }), or null. */
export function processAmong(files = [], message = "") {
  for (const f of files) {
    try {
      if (!existsSync(f.path) || statSync(f.path).size > MAX_BYTES) continue;
      const text = readFileSync(f.path, "utf8");
      if (isProcess(text)) return { name: basename(f.path), text };
    } catch { /* not a text this review reads */ }
  }
  return isProcess(message) ? { name: "the message", text: String(message) } : null;
}

/** The systems a document's systems: line names, each with its access word. */
function systemsOf(line) {
  const out = [];
  const s = squash(line);
  if (!s || /^none\b/i.test(s) || /^<[^<>]*>$/.test(s)) return out;
  let depth = 0, cur = "";
  const items = [];
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
  }
  items.push(cur);
  for (const it of items.map(squash).filter(Boolean)) {
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(it);
    if (m) out.push({ system: squash(m[1]), access: squash(m[2]).split(/[\s;,]/)[0] });
  }
  return out;
}

/** The assessment: the verdict and every list the review writes. */
export function processAssessment(text) {
  const r = reviewProcess(text);
  const d = parseDocument(text);
  const refusals = [];
  for (const f of r.findings.filter((x) => x.rule === "acts-in-the-world")) refusals.push(`${f.claim} (line ${f.line})`);
  for (const f of r.findings.filter((x) => x.rule === "four-tests" && /changes the work|left-out/.test(x.claim))) refusals.push(`${f.claim} (line ${f.line})`);
  const unreasoned = r.findings.filter((x) => x.rule === "approval-level").map((f) => ({ permission: `${f.phase} signed by a person on every run (never)`, asked_in: `line ${f.line}`, why_flagged: f.claim }));
  const reaches = systemsOf(d.bindings.systems).map((s) => ({ ...s, reason: "the process's own systems: line, which every holder is bound under" }));
  const policy = [];
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((l) => /^policy:/.test(l));
  if (at >= 0) {
    for (let i = at + 1; i < lines.length && !/^\S/.test(lines[i]); i++) {
      if (/^ {2}\S/.test(lines[i])) policy.push(squash(lines[i]));
      else if (policy.length && lines[i].trim()) policy[policy.length - 1] += ` ${squash(lines[i])}`;
    }
  }
  const neverDos = policy.map((p) => ({ act: p, reason: "the process's own policy", from: "policy:", held_by: "the holders and the runner, by the document" }));
  const accepted = r.acts.filter((a) => a.gated).map((a) => `${a.phase} ${a.how}, after ${a.by === a.phase ? `a person's yes at its own level (${d.phases.find((p) => p.name === a.phase)?.automation})` : a.by}, which a person signs.`);
  const notes = [
    ...r.findings.filter((x) => x.rule === "outside-extensions").map((f) => `line ${f.line}: ${f.claim}`),
    ...r.findings.filter((x) => x.rule === "conformance").map((f) => `it does not conform: ${f.claim}`),
    ...r.findings.filter((x) => x.rule === "four-tests" && !/changes the work|left-out/.test(x.claim)).map((f) => f.claim),
  ];
  const spends = r.acts.filter((a) => a.how === "pays").map((a) => ({ ceiling: `${a.phase} pays`, limit: "", reason: squash(a.said), enforced_by: a.gated ? `a person's yes before it (${a.by})` : "nobody" }));
  return { verdict: refusals.length ? "refused" : "passed", refusals, unreasoned, reaches, spends, neverDos, accepted, notes, acting: r.acts, signs: r.signs, document: r.document, digest: r.digest, text_digest: r.text_digest };
}

/** The review, as security-review-v1: the same front matter and headings as a package's. */
export function processReviewMarkdown({ a, file, reviewedAt }) {
  const L = ["---", `review: ${q(FORMAT)}`, `package: ${q(a.document.id || "(unnamed)")}`, `version: ${q(a.document.version || "(none)")}`, `digest: ${q(a.digest)}`, `verdict: ${q(a.verdict)}`, `reviewed_at: ${q(reviewedAt)}`, `architecture_record: ${q("absent")}`, `spending_limit: ${q("none set")}`];
  const list = (key, items, fields) => {
    if (!items.length) { L.push(`${key}: []`); return; }
    L.push(`${key}:`);
    for (const it of items) fields.forEach(([f, k], i) => L.push(`${i === 0 ? "  - " : "    "}${f}: ${q(it[k] ?? "")}`));
  };
  list("reaches", a.reaches, [["system", "system"], ["access", "access"], ["reason", "reason"]]);
  list("spends", a.spends, [["ceiling", "ceiling"], ["limit", "limit"], ["reason", "reason"]]);
  list("never_does", a.neverDos, [["act", "act"], ["reason", "reason"]]);
  list("no_reason_recorded", a.unreasoned, [["permission", "permission"], ["asked_in", "asked_in"], ["flagged", "why_flagged"]]);
  if (a.refusals.length) { L.push("refused_for:"); for (const r of a.refusals) L.push(`  - ${q(r)}`); } else L.push("refused_for: []");
  L.push("warnings: []", "---", "");
  L.push(`# Security review: the process ${a.document.id || "(unnamed)"} ${a.document.version || ""}`.trimEnd(), "");
  L.push(`Reviewed ${reviewedAt}, before the process is wired, tested or installed, from the document ${file} (shape ${a.digest}). This review grants nothing and changes nothing: it says what the process reaches, which of its steps act in the world and whether a person says yes before each, and what it must never do.`, "");
  L.push("## Verdict", "");
  if (a.verdict === "passed") L.push("**Passed.** Every step that acts in the world has a person's yes before it, and no extension line changes the work.");
  else { L.push(`**Refused.** This process does not pass, for ${a.refusals.length === 1 ? "this reason" : `these ${a.refusals.length} reasons`}:`, ""); for (const r of a.refusals) L.push(`- ${r}`); }
  L.push("");
  L.push("## Reaches", "");
  if (!a.reaches.length) L.push("Its systems: line names no system.");
  else { L.push("| What | Access | Reason |", "|---|---|---|"); for (const r of a.reaches) L.push(`| ${cell(r.system)} | ${cell(r.access)} | ${cell(r.reason)} |`); }
  L.push("");
  if (!a.acting.length) L.push("No step acts in the world.");
  else {
    L.push("| Step | Acts | Before it |", "|---|---|---|");
    for (const x of a.acting) L.push(`| ${cell(x.phase)} | ${cell(x.how)} | ${x.gated ? cell(x.by === x.phase ? "a person's yes at its own level" : `${x.by}, which a person signs`) : "no person's yes before it"} |`);
  }
  L.push("");
  L.push("## Spends", "");
  if (!a.spends.length) L.push("No step pays.");
  else { L.push("| Ceiling | Limit | Reason | Held by |", "|---|---|---|---|"); for (const s of a.spends) L.push(`| ${cell(s.ceiling)} | ${cell(s.limit)} | ${cell(s.reason)} | ${cell(s.enforced_by)} |`); }
  L.push("");
  L.push("## Never does", "");
  if (!a.neverDos.length) L.push("The document states no policy.");
  else { L.push("| Never | Reason | From | Held by |", "|---|---|---|---|"); for (const n of a.neverDos) L.push(`| ${cell(n.act)} | ${cell(n.reason)} | ${cell(n.from)} | ${cell(n.held_by)} |`); }
  L.push("");
  L.push("## No reason recorded", "");
  if (!a.unreasoned.length) L.push("Every step a person signs says why, or comes before a step that acts in the world.");
  else { L.push("Each of these has a person sign every run with no reason in the document. Each is flagged, and none refuses the process.", ""); for (const u of a.unreasoned) L.push(`- **${u.permission}** (${u.asked_in}): ${u.why_flagged}`); }
  L.push("");
  L.push("## Programs", "");
  L.push("A process document carries no programs. Each step's holder is an agent whose own package is reviewed as a package.", "");
  L.push("No script carries a network address literal (Common Agent 12.10).", "");
  L.push("## Parts", "");
  L.push("It brings in no code.", "");
  L.push("## Accepted knowingly", "");
  if (!a.accepted.length && !a.notes.length) L.push("Nothing this review lets through carries a risk it has to name.");
  for (const x of a.accepted) L.push(`- ${x}`);
  for (const n of a.notes) L.push(`- Note: ${n}`);
  L.push("");
  L.push("## Reasons weighed", "");
  L.push("No model was asked: the process rules decide everything in this review.", "");
  L.push("## Not reviewed", "");
  L.push("- The holders' own packages, each reviewed as a package before it is installed.");
  L.push("- Whether each step's words are true of the work: a reader's judgment.");
  L.push("");
  return L.join("\n");
}

/** The reply, in words. */
export function processReplyText(a) {
  const who = `the process ${a.document.id}${a.document.version ? ` ${a.document.version}` : ""}`;
  const L = [];
  if (a.verdict === "passed") L.push(`I reviewed ${who} and it passes: ${many(a.acting.length, "step")} that ${a.acting.length === 1 ? "acts" : "act"} in the world, each with a person's yes before it.`);
  else L.push(`I reviewed ${who} and it does not pass. What stopped it: ${a.refusals.join("; ")}`);
  if (a.unreasoned.length) L.push(`${many(a.unreasoned.length, "gate")} ${a.unreasoned.length === 1 ? "has" : "have"} no recorded reason and ${a.unreasoned.length === 1 ? "is" : "are"} flagged in the review.`);
  L.push("No model was asked. The review is filed with the job. It grants nothing and changed nothing in the document.");
  return L.join(" ");
}

/** The whole review of a process: the records, the review as the one piece, and the reply. */
export function reviewProcessJob({ job, records, found, reviewedAt = new Date().toISOString() }) {
  mkdirSync(records, { recursive: true });
  const a = processAssessment(found.text);
  const md = processReviewMarkdown({ a, file: found.name, reviewedAt });
  const reviewPath = join(records, "security-review.md");
  writeFileSync(reviewPath, md);
  writeFileSync(join(records, "assessment.json"), JSON.stringify({ process: a.document, digest: a.digest, verdict: a.verdict, refusals: a.refusals, unreasoned: a.unreasoned, reaches: a.reaches, acting: a.acting, signs: a.signs, never_does: a.neverDos, accepted: a.accepted, notes: a.notes, reviewed_at: reviewedAt }, null, 2) + "\n");
  return { a, reviewPath, reply: processReplyText(a) };
}
