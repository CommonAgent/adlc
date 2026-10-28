// The audit report: Markdown with a YAML header the gates read, then the
// four sections TERMS.md names, in order: Stage records, Rule checks,
// Findings, Not checked. Signed by the auditor's key over the whole report
// (keys.mjs signReport): every word of the body is covered, so a finding
// cannot be changed after the report is signed.
//
// The verdict:
//   fail                 any finding at level refuse, as it applies to this agent
//   pass_with_findings   no refusal, and any warning or anything not checked
//   pass                 every check passed and nothing went unchecked
//
//   needs: node >= 22
//   import { verdictOf, writeReport, ABOUT } from "./report.mjs"
import { idFromSeed, signReport } from "./keys.mjs";

const trim = (s) => String(s ?? "").trim();
const yes = (b) => (b ? "yes" : "no");

export const ABOUT = "The signed audit report for one agent version: a YAML header (audit_report, agent, version, package_digest, checklist, checklist_digest, verdict, audited_at, expires_at, signed_by, signature), then `## Stage records`, `## Rule checks`, `## Findings` and `## Not checked`.";
export const DAYS_VALID = 30;

export function verdictOf({ findings, notChecked }) {
  if (findings.some((f) => f.level === "refuse")) return "fail";
  if (findings.length || notChecked.length) return "pass_with_findings";
  return "pass";
}

const one = (s) => trim(s).replace(/\s+/g, " ");

/** The report's text, signed when a seed is given. */
export function writeReport({ facts, checklist, lines, results, findings, notChecked, filed = [], audited_at, seed = "" }) {
  const verdict = verdictOf({ findings, notChecked });
  const expires = new Date(Date.parse(audited_at) + DAYS_VALID * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const key = trim(seed) ? idFromSeed(seed) : "none";
  const t = facts.target;
  const H = [
    "---",
    "audit_report: v1",
    `agent: ${facts.handle}`,
    `version: ${t.version ?? "none"}`,
    `package_digest: ${t.digest ?? "none"}`,
    `checklist: ${checklist.schema}`,
    `checklist_digest: ${checklist.digest}`,
    `verdict: ${verdict}`,
    `audited_at: ${audited_at}`,
    `expires_at: ${expires}`,
    `signed_by: ${key}`,
    "signature: PENDING",
    "---",
    "",
  ];
  const B = [];
  const count = (r) => results.filter((x) => x.result === r).length;
  B.push(`# Audit of ${facts.handle} ${t.version ?? "(no version on record)"}`);
  B.push("");
  B.push(`Verdict: **${verdict}**. ${results.length} checks from ${checklist.name} (${checklist.digest}): ${count("pass")} passed, ${count("fail")} failed, ${count("not checked")} not checked. ${findings.filter((f) => f.level === "refuse").length} finding(s) refuse and ${findings.filter((f) => f.level === "warn").length} warn.`);
  B.push("");
  B.push(`The audited package is ${t.digest ?? "not on record"}, chosen by ${t.how}. The agent was read on ${facts.dev.origin}${facts.prod ? ` and ${facts.prod.origin}` : ""}, registered as ${facts.dev.key ?? "nothing"}. ${facts.firstReleased ? `Its first release on record is ${facts.firstReleased}.` : "No release of it is on record, so it is read as an existing agent."} This report expires ${expires}.`);
  B.push("");

  B.push("## Stage records");
  B.push("");
  B.push("One line per lifecycle stage: whether its record is present, signed by the stage's holder, and bound to this package digest.");
  B.push("");
  for (const l of lines) {
    B.push(`- **${l.asset}** (${l.made_at}): **${l.state}**. Present ${yes(l.present)}, signed by its holder ${yes(l.signed)}, bound to this digest ${yes(l.bound)}. ${one(l.evidence)}`);
  }
  B.push("");

  B.push("## Rule checks");
  B.push("");
  for (const r of results) {
    B.push(`- **${r.id}** (${r.kind}, \`${r.check}\`, ${r.level_applied ?? r.level}): **${r.result}**. ${one(r.evidence)}`);
  }
  B.push("");

  B.push("## Findings");
  B.push("");
  if (!findings.length) B.push("None.");
  findings.forEach((f, i) => {
    const d = filed[i];
    const debt = !d ? "not filed" : d.state === "filed" ? `filed as debt #${d.number}` : d.state === "already filed" ? `already filed as debt #${d.number} (${d.ledger_state})` : `not filed: ${d.why}`;
    B.push(`### ${f.id}`);
    B.push("");
    B.push(`- Place: ${one(f.place) || "the agent"}`);
    B.push(`- Rule: ${one(f.says)}`);
    B.push(`- Found: ${one(f.evidence)}`);
    B.push(`- Consequence: ${one(f.why)}`);
    B.push(`- Level: ${f.level}${f.level_why ? `, ${one(f.level_why)}` : ""}`);
    B.push(`- Fixed by: the ${f.fixed_by} stage`);
    B.push(`- Debt: ${debt}`);
    B.push("");
  });
  if (!findings.length) B.push("");

  B.push("## Not checked");
  B.push("");
  if (!notChecked.length) B.push("Nothing.");
  for (const n of notChecked) B.push(`- **${n.id}**${n.check ? ` (\`${n.check}\`)` : ""}: ${one(n.why)}`);
  B.push("");

  let text = [...H, ...B].join("\n");
  if (trim(seed)) text = text.replace("signature: PENDING", `signature: ${signReport(text.replace(/^signature: PENDING\n/m, ""), seed)}`);
  else text = text.replace("signature: PENDING", "signature: none");
  return { text, verdict, expires_at: expires, signed_by: key, signed: Boolean(trim(seed)) };
}
