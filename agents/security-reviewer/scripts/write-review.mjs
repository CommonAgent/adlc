// Write the review: Markdown for a person, with a structured header a program
// can read. A step with no judgment in it.
//
// The header is YAML front matter between two `---` lines. Every value in it
// is written as a JSON string or number, which YAML reads as the same value,
// so nothing in a reason can break it. It lists, in this order: the package
// and its digest, the verdict, whether the architecture record was given,
// the owner's spending limit, each reach (system, access, reason), each spend
// ceiling (with its reason), each never-do (with its reason), each permission
// with no recorded reason, and what stopped the package when it was refused.
// The body says the same for a reader, under fixed headings:
//
//   ## Verdict, ## Reaches, ## Spends, ## Never does, ## No reason recorded,
//   ## Programs, ## Parts, ## Accepted knowingly, ## Reasons weighed,
//   ## Not reviewed
//
//   needs: node >= 22
//   import { reviewMarkdown, HEADINGS } from "./write-review.mjs"

export const FORMAT = "security-review-v1";
export const HEADINGS = ["Verdict", "Reaches", "Spends", "Never does", "No reason recorded", "Programs", "Parts", "Accepted knowingly", "Reasons weighed", "Not reviewed"];

const q = (v) => JSON.stringify(String(v ?? ""));
const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** The YAML front matter. */
export function header({ pkg, a, reviewedAt }) {
  const L = ["---", `review: ${q(FORMAT)}`, `package: ${q(pkg.name || "(unnamed)")}`, `version: ${q(pkg.version || "(none)")}`];
  if (pkg.digest) L.push(`digest: ${q(`sha256:${pkg.digest}`)}`);
  L.push(`verdict: ${q(a.verdict)}`, `reviewed_at: ${q(reviewedAt)}`);
  L.push(`architecture_record: ${q(a.architecture?.given ? "given" : "absent")}`);
  L.push(`spending_limit: ${q(a.limit ? `${a.limit.said} (${a.limit.from})` : "none set")}`);
  const list = (key, items, fields) => {
    if (!items.length) { L.push(`${key}: []`); return; }
    L.push(`${key}:`);
    for (const it of items) {
      fields.forEach(([f, k], i) => L.push(`${i === 0 ? "  - " : "    "}${f}: ${q(it[k] ?? "")}`));
    }
  };
  list("reaches", a.reaches, [["system", "system"], ["access", "access"], ["reason", "reason"]]);
  list("spends", a.spends, [["ceiling", "ceiling"], ["limit", "limit"], ["reason", "reason"]]);
  list("never_does", a.neverDos, [["act", "act"], ["reason", "reason"]]);
  list("no_reason_recorded", a.unreasoned, [["permission", "permission"], ["asked_in", "asked_in"], ["flagged", "why_flagged"]]);
  if (a.refusals.length) { L.push("refused_for:"); for (const r of a.refusals) L.push(`  - ${q(r)}`); } else L.push("refused_for: []");
  L.push("---");
  return L.join("\n");
}

/** The whole review. */
export function reviewMarkdown({ pkg, a, traced, weighed = null, reviewedAt, notReviewed = [] }) {
  const L = [header({ pkg, a, reviewedAt }), ""];
  L.push(`# Security review: ${pkg.name || "an unnamed package"} ${pkg.version || ""}`.trimEnd(), "");
  L.push(`Reviewed ${reviewedAt}, before the agent is installed and before any credential is bound to it. This review grants nothing and changes nothing: it says what the agent may reach, what it may spend and what it must never do, and the reason for each.`, "");

  L.push("## Verdict", "");
  if (a.verdict === "passed") {
    L.push("**Passed.** Every permission the package asks for has a recorded reason, its programs reach only what its declaration names, and its owner has set a spending limit.");
  } else {
    L.push(`**Refused.** This package does not pass, for ${a.refusals.length === 1 ? "this reason" : `these ${a.refusals.length} reasons`}:`, "");
    for (const r of a.refusals) L.push(`- ${r}.`);
  }
  L.push("");

  L.push("## Reaches", "");
  if (!a.reaches.length) L.push("It declares no system, command or folder, and its programs reach none.");
  else {
    L.push("| What | Access | Reason | Credential | Caller's material sent to it |", "|---|---|---|---|---|");
    for (const r of a.reaches) L.push(`| ${cell(r.system)} | ${cell(r.access)} | ${cell(r.reason || "**none recorded**")} | ${cell(r.credential ? `\`${r.credential}\` by name, in \`${r.env || "no variable"}\`` : "none")} | ${r.leaves ? "yes" : "no"} |`);
  }
  L.push("");

  L.push("## Spends", "");
  if (!a.limit) L.push("**The owner has set no spending limit.** No package passes without one.", "");
  if (!a.spends.length) L.push("It declares nothing that spends, and no ceiling.");
  else {
    L.push("| Ceiling | Limit | Reason | Held by |", "|---|---|---|---|");
    for (const s of a.spends) L.push(`| ${cell(s.ceiling)} | ${cell(s.limit)} | ${cell(s.reason || "**none recorded**")} | ${cell(s.enforced_by)} |`);
  }
  L.push("");

  L.push("## Never does", "");
  L.push("| Never | Reason | From | Held by |", "|---|---|---|---|");
  for (const n of a.neverDos) L.push(`| ${cell(n.act)} | ${cell(n.reason)} | ${cell(n.from)} | ${cell(n.held_by)} |`);
  L.push("");

  L.push("## No reason recorded", "");
  if (!a.unreasoned.length) L.push("Every permission the package asks for has a recorded reason.");
  else {
    L.push("Each of these is asked for and has no recorded reason. Each one is flagged, and none is passed until somebody records why it is needed or takes it out.", "");
    for (const u of a.unreasoned) L.push(`- **${u.permission}** (asked in ${u.asked_in}): ${u.why_flagged}.`);
  }
  L.push("");

  L.push("## Programs", "");
  const t = traced ?? { traced: [], tests: [], reaches: [], unmatched: [], openFetches: [] };
  if (!t.traced.length) L.push("The package carries no programs. Its skills are instructions a harness reads, so what it reaches is what the harness's own tools reach, and the egress allow-list is what bounds it.");
  else {
    L.push(`${t.traced.length} program${t.traced.length === 1 ? "" : "s"} read${t.tests.length ? `; ${t.tests.length} test file${t.tests.length === 1 ? "" : "s"} left out, since tests are not the agent at work` : ""}.`, "");
    for (const r of t.reaches) L.push(`- ${r.host}: ${r.by} (${r.files.join(", ")}).`);
    for (const u of t.unmatched) L.push(`- **${u.host}: no declared system covers it** (${u.files.join(", ")}).`);
    if (t.openFetches.length) L.push(`- ${t.openFetches.length} call${t.openFetches.length === 1 ? " goes" : "s go"} to an address the program is handed rather than one written down, each taken as a declared reach: ${t.openFetches.map((f) => f.file).join(", ")}.`);
    if (t.unmatchedOpen?.length) L.push(`- **${t.unmatchedOpen.length} call${t.unmatchedOpen.length === 1 ? " goes" : "s go"} to an address the program is handed, and no declared system covers ${t.unmatchedOpen.length === 1 ? "it" : "them"}**: ${t.unmatchedOpen.map((f) => f.file).join(", ")}.`);
    for (const b of t.browsers ?? []) L.push(`- ${b.file} drives a browser${b.routes ? " and routes its requests" : ", and routes none of its requests"}.`);
    for (const c of t.undeclaredCommands ?? []) L.push(`- ${c.file} starts ${c.what}, which the runtime requirements do not declare.`);
    for (const k of t.modelKeys ?? []) L.push(`- ${k.file} reads ${k.name}, the model key the deployment manager places beside AGENT_MODEL for the model it gives the agent.`);
    for (const v of t.credentialVars ?? []) L.push(`- **${v.files.join(", ")} read${v.files.length === 1 ? "s" : ""} ${v.name}, a credential no system declares.**`);
    if (!t.reaches.length && !t.unmatched.length && !t.openFetches.length && !t.unmatchedOpen?.length) L.push("- No program reaches the network.");
  }
  L.push("");

  L.push("## Parts", "");
  if (!a.parts.lockfiles.length && !a.parts.dependencies.length) L.push("It brings in no code it did not write: no lockfile, no declared dependency.");
  else {
    for (const x of a.parts.dependencies) L.push(`- ${x.skill || "a skill"}: \`${x.lockfile}\`${x.sha256 ? `, pinned at sha256 ${x.sha256.slice(0, 12)}` : ""}.`); // cut-ok: the digest's head as a label; the full one is in the package
    for (const l of a.parts.lockfiles.filter((l) => !a.parts.dependencies.some((x) => x.lockfile.endsWith(l)))) L.push(`- \`${l}\`.`);
  }
  L.push("");

  L.push("## Accepted knowingly", "");
  if (!a.accepted.length) L.push("Nothing this review lets through carries a risk it has to name.");
  else for (const x of a.accepted) L.push(`- ${x}`);
  for (const n of a.notes) L.push(`- Note: ${n}`);
  L.push("");

  L.push("## Reasons weighed", "");
  if (!weighed) L.push("No model weighed the reasons, so each reason above is listed as the package states it and nobody has judged whether it accounts for the access.");
  else {
    L.push(`A model read each reason against the access it is given for (${weighed.calls} call${weighed.calls === 1 ? "" : "s"}). This changes no verdict: it says which reasons to read hardest.`, "");
    for (const w of weighed.judgments) L.push(`- **${w.permission}**: ${w.holds === "holds" ? "the reason accounts for it" : w.holds === "thin" ? "the reason is thin" : "the reason does not account for it"}. ${w.says}`);
  }
  L.push("");

  L.push("## Not reviewed", "");
  const nr = [...notReviewed];
  if (!a.architecture?.given) nr.push("No architecture record was given, so nothing checks the package's systems against what the agent was designed to reach; the package's own declaration is the only statement of it.");
  nr.push("The programs were read as text and not run. An address a program builds from parts it computes is not seen here; the egress allow-list is what holds it.");
  for (const n of nr) L.push(`- ${n}`);
  L.push("");
  return L.join("\n");
}
