// The watch report a person reads, in Markdown, and the watch record it is
// written from.
//
// The header is `name: value` lines a program can read as well as a person:
// the counts, the spend window and total, and the two answers the Cost stage
// is done on. Then the agents, one table and a section each; the open alerts;
// the spend, per job, per agent, per owner and in total, against what was
// allowed and reconciled or not; what is not known; and every source read.
//
// Every line says where its figure was read. No figure is written that a
// reading did not carry: a count is a count of readings, and a sum of money
// is the spend report's own.
//
//   needs: node >= 22
//   import { writeReport, WATCHER } from "./write-report.mjs"
import { agentName, agentSpendWords, allowedWords, moneyWords } from "./spend.mjs";

export const WATCHER = "watcher 0.1.0";

/** A reason as a sentence of its own: its first letter raised. */
const cap = (s) => { const t = String(s ?? ""); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const yesNo = (state, yes = "yes", no = "no") => (state === "yes" ? yes : state === "no" ? no : "not known");
const limitWord = (state) => (state === "inside" ? "yes" : state === "outside" ? "no" : "not measured");

function totalWords(totals) {
  if (!totals?.length) return "nothing";
  return totals.map((t) => moneyWords(t.spent_micro, t.currency)).join(", ");
}

/** The header block, as `name: value` lines. */
export function header({ watchedAt, account, agents, spend }) {
  const count = (pred) => agents.filter(pred).length;
  return [
    `watched_by: ${WATCHER}`,
    `watched_at: ${watchedAt}`,
    `account: ${account ?? "not known"}`,
    `agents: ${agents.length}`,
    `alive: ${count((a) => a.alive.state === "yes")}`,
    `answering: ${count((a) => a.answering.state === "yes")}`,
    `inside_limits: ${count((a) => a.limits.state === "inside")}`,
    `outside_limits: ${count((a) => a.limits.state === "outside")}`,
    `open_alerts: ${count((a) => a.alert)}`,
    `spend_window: ${spend?.ok && spend.window ? `${spend.window.from} to ${spend.window.to}` : "not read"}`,
    `spend_total: ${spend?.ok ? totalWords(spend.totals) : "not read"}`,
    `every_spend_traced: ${spend?.ok ? (spend.every_spend_traced ? "yes" : "no") : "not known"}`,
    `reconciles: ${spend?.ok ? (spend.reconciles ? "yes" : "no") : "not known"}`,
  ];
}

function agentSection(a) {
  const L = [`### ${a.handle}`, ""];
  // Alive.
  if (a.alive.state === "yes") L.push(`- Alive: yes. The registry's presence is ${a.alive.availability}${a.alive.last_seen_at ? `, and it last checked in at ${a.alive.last_seen_at}` : ""}. Read at ${a.alive.at} from ${a.alive.source}.`);
  else L.push(`- Alive: ${yesNo(a.alive.state)}. ${cap(a.alive.why)}.${a.alive.source ? ` Read at ${a.alive.at} from ${a.alive.source}.` : ""}`);
  // Answering.
  const w = a.answering;
  if (w.state === "yes") {
    L.push(w.as_worker
      ? `- Answering: yes. Asked the worker interface's status at ${w.asked_at}, it answered after ${w.seconds}s at ${w.answered_at}: its job ${w.job ?? "(none named)"} is ${w.job_state ?? "not said"}${w.detail ? ` (${w.detail})` : ""}.`
      : `- Answering: yes. Asked the worker interface's status at ${w.asked_at}, it answered after ${w.seconds}s at ${w.answered_at}, but not as the worker interface: "${w.words}".`);
  } else {
    L.push(`- Answering: ${yesNo(w.state)}. ${cap(w.why)}.${w.asked_at ? ` Asked at ${w.asked_at}.` : ""}`);
  }
  // Limits.
  L.push(`- Inside its limits: ${limitWord(a.limits.state)}.`);
  for (const c of a.limits.checks) {
    const what = c.limit === "time" ? "Time" : c.limit === "money" ? "Money" : c.limit;
    if (c.verdict === "not measured") L.push(`  - ${what}: not measured${c.declared ? ` (declared ${c.declared})` : ""}. ${cap(c.why)}.`);
    else L.push(`  - ${what}: ${c.verdict}. Declared ${c.declared}, from ${c.declared_at}; recorded ${c.observed}, from ${c.observed_at}.${c.why ? ` ${cap(c.why)}.` : ""}`);
  }
  if (a.alert) L.push(`- Open alert: ${a.alert.reasons.join("; ")}.`);
  L.push("");
  return L;
}

function spendSections(spend) {
  const L = ["## Spend", ""];
  if (!spend?.ok) {
    L.push(`The spend was not read: ${spend?.why ?? "no reason given"}. Nothing below is known about what these agents spent.`, "");
    return L;
  }
  L.push(`From the platform's spend report for ${spend.window.from} to ${spend.window.to}, generated at ${spend.generated_at}, read from ${spend.read_from}. Every amount below is the report's own; the watcher added its job lines up again to check the totals.`, "");

  L.push("### In total", "");
  if (!spend.totals.length) L.push("Nothing was spent by these agents in the window.", "");
  else {
    L.push("| Currency | Spent | Traced to a job | Not traced |", "|---|---|---|---|");
    for (const t of spend.totals) L.push(`| ${t.currency} | ${moneyWords(t.spent_micro, t.currency)} | ${moneyWords(t.traced_micro, t.currency)} | ${moneyWords(t.untraced_micro, t.currency)} |`);
    L.push("");
  }

  L.push("### By owner", "");
  if (!spend.owners.length) L.push("No owner spent anything in the window.", "");
  else {
    L.push("| Owner | Agents | Spent | Traced | Not traced |", "|---|---|---|---|---|");
    for (const o of spend.owners) {
      const names = o.agents.map((k) => agentName(spend.agents.find((a) => a.agent === k) ?? { agent: k }));
      const cs = o.currencies ?? [];
      L.push(`| ${cell(o.label ? `${o.label} (${o.owner})` : o.owner)} | ${cell(names.join(", "))} | ${cs.map((c) => moneyWords(c.spent_micro, c.currency)).join(", ") || "nothing"} | ${cs.map((c) => moneyWords(c.traced_micro, c.currency)).join(", ") || "nothing"} | ${cs.map((c) => moneyWords(c.untraced_micro, c.currency)).join(", ") || "nothing"} |`);
    }
    L.push("");
  }

  L.push("### By agent", "");
  L.push("| Agent | Owner | Spent | Allowed |", "|---|---|---|---|");
  for (const a of spend.agents) L.push(`| ${cell(agentName(a))} | ${cell(a.owner)} | ${cell(agentSpendWords(a))} | ${cell(allowedWords(a))} |`);
  L.push("");

  L.push("### By job", "");
  const jobs = [];
  for (const a of spend.agents) for (const c of a.currencies ?? []) for (const d of c.days ?? []) for (const j of d.jobs ?? []) jobs.push({ agent: agentName(a), currency: c.currency, day: d.day, ...j });
  if (!jobs.length) L.push("No job line in the window.", "");
  else {
    L.push("| Day | Agent | Job | Spent | At |", "|---|---|---|---|---|");
    for (const j of jobs) L.push(`| ${j.day} | ${cell(j.agent)} | \`${cell(j.job)}\` | ${moneyWords(j.spent_micro, j.currency)} | ${j.at} |`);
    L.push("");
  }

  L.push("### Untraced", "");
  const untraced = [];
  for (const a of spend.agents) for (const c of a.currencies ?? []) for (const u of c.untraced ?? []) untraced.push({ agent: agentName(a), currency: c.currency, ...u });
  if (!untraced.length) L.push("Every amount spent in the window traces to a job.", "");
  else {
    for (const u of untraced) L.push(`- ${u.agent}, ${u.day}: ${moneyWords(u.amount_micro, u.currency)} traces to no job: ${u.why}.`);
    L.push("");
  }

  L.push("### Against what was allowed", "");
  const lines = [];
  for (const a of spend.agents) {
    const al = a.allowed ?? {};
    if (!al.registered) { lines.push(`- ${agentName(a)}: no allowance is registered, so nothing was allowed or measured against.`); continue; }
    if (al.valid === false) { lines.push(`- ${agentName(a)}: its registered allowance does not hold (${al.reason ?? "no reason given"}).`); continue; }
    for (const c of a.against ?? []) {
      const ceil = `${moneyWords(c.ceiling_micro, al.currency ?? "")} per ${c.scope}`;
      if (c.over?.length) lines.push(`- ${agentName(a)}: over its ${ceil} ceiling ${c.over.length} time${c.over.length === 1 ? "" : "s"} of ${c.checked} measured: ${c.over.map((o) => `${moneyWords(o.spent_micro, al.currency ?? "")}${o.job ? ` in job \`${o.job}\`` : ""}${o.day ? ` on ${o.day}` : ""}`).join("; ")}.`);
      else lines.push(`- ${agentName(a)}: inside its ${ceil} ceiling, ${c.checked} measured.${c.note ? ` ${c.note}.` : ""}`);
    }
    for (const m of a.crossings ?? []) lines.push(`- ${agentName(a)}: the platform marked its ${m.scope} ceiling of ${moneyWords(m.ceiling_micro, m.currency)} crossed at ${m.at}, with ${moneyWords(m.spent_micro, m.currency)} spent.`);
  }
  L.push(...(lines.length ? lines : ["No agent was named."]), "");

  L.push("### Reconciliation", "");
  L.push(`- Every spend traces to a job: ${spend.every_spend_traced ? "yes" : "no"}${spend.every_spend_traced ? "." : ", and each amount that does not is named above with why."}`);
  L.push(`- The totals reconcile: ${spend.reconciles ? "yes" : "no"}. The platform's report says ${spend.platform_reconciles ? "they do" : "they do not"}; the watcher added each day's job lines and untraced amount, each agent's days, and the agents and the owners against the totals${spend.discrepancies.length ? ", and found what is listed below" : ", and found nothing that does not add up"}.`);
  for (const d of spend.discrepancies) L.push(`  - ${d}`);
  L.push("");
  return L;
}

/**
 * The report. `agents` are checks.mjs results; `spend` is readSpend's result
 * with `read_from` set, or { ok: false, why }; `raised` is raise.mjs's result.
 */
export function writeReport({ watchedAt, account, agents, spend, raised = [], notKnown = [], sources = [] }) {
  const L = ["# Watch report", "", ...header({ watchedAt, account, agents, spend }), ""];
  L.push("Each agent was asked one question and read from the platform's own records, and each line says where. Silence counts as a failure. Nothing here was estimated.", "");

  L.push("## Agents", "");
  if (!agents.length) L.push("No agent was watched.", "");
  else {
    L.push("| Agent | Alive | Answering | Inside its limits | Open alert |", "|---|---|---|---|---|");
    for (const a of agents) L.push(`| ${cell(a.handle)} | ${yesNo(a.alive.state)} | ${yesNo(a.answering.state)} | ${limitWord(a.limits.state)} | ${a.alert ? cell(a.alert.reasons.join("; ")) : "none"} |`);
    L.push("");
    for (const a of agents) L.push(...agentSection(a));
  }

  L.push("## Open alerts", "");
  const open = agents.filter((a) => a.alert);
  if (!open.length) L.push("None. Every agent watched is alive, answered, and is inside every limit that was measured.", "");
  else {
    for (const a of open) {
      const r = raised.find((x) => x.agent === a.handle);
      L.push(`### ${a.handle}`, "");
      L.push(`- Opened at ${a.alert.at}: ${a.alert.reasons.join("; ")}.`);
      if (!a.alert.raise) L.push("- Not raised to the incident recorder: the watcher could not ask this agent, which is a gap in the watch, not a failure seen in the agent.");
      else if (!r) L.push("- Not raised to the incident recorder.");
      else if (r.sent) L.push(`- Raised to the incident recorder ${r.to}${r.request_id ? ` as message ${r.request_id}` : ""}, with \`${r.file}\` attached.`);
      else L.push(`- Not raised to the incident recorder: ${r.why}. Its alarm, \`${r.file}\`, is handed back with this report.`);
      L.push("");
    }
  }

  L.push(...spendSections(spend));

  L.push("## Not known", "");
  L.push(...(notKnown.length ? notKnown.map((n) => `- ${n}`) : ["- Nothing the watch covers was left unread."]), "");

  L.push("## Sources", "");
  L.push(...(sources.length ? sources.map((s) => `- ${s.what}: ${s.where}${s.at ? `, read at ${s.at}` : ""}${s.status !== undefined ? ` (${s.status})` : ""}`) : ["- None."]), "");
  return L.join("\n");
}
