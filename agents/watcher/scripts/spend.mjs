// The Cost half: what was spent, by whom, against what was allowed.
//
// The platform's spend report (GET /v1/accounts/:id/spend-report, format
// spend-report-v1) already carries every figure: per job, per day, per
// agent, per owner and in total, the ceilings of each registered allowance,
// and its own answers to the stage's two checks, `every_spend_traced` and
// `reconciles`. This file computes no figure of its own. It reads the report
// and checks its arithmetic again, line by line, from the report's own job
// lines up, so that a total that does not add up is caught here even when the
// report says it reconciles. Each check that fails is a discrepancy, named,
// and the report is said not to reconcile.
//
//   needs: node >= 22
//   import { readSpend, moneyWords } from "./spend.mjs"

export const FORMAT = "spend-report-v1";

const sum = (xs) => xs.reduce((t, x) => t + x, 0);
const n = (v) => (Number.isFinite(v) ? v : NaN);

/** micro-units as a person reads them: 1650000000 XCR micro is "1650 XCR".
 *  The same words the platform's report uses, so a figure here can be
 *  found there. */
export function moneyWords(micro, currency) {
  const whole = micro / 1_000_000;
  const text = Number.isInteger(whole) ? String(whole) : whole.toFixed(6).replace(/0+$/, "");
  return `${text} ${currency}`;
}

/** The report's own name for an agent: its handle, else its label, else its key. */
export function agentName(a) {
  return a?.handle || a?.label || a?.agent || "an agent with no name";
}

/** Check a spend-report-v1 body and return what the report section needs.
 *  Never throws on a malformed body: what cannot be read is a discrepancy. */
export function readSpend(body) {
  const problems = [];
  if (!body || typeof body !== "object" || body.format !== FORMAT) {
    return { ok: false, why: `the spend report is not ${FORMAT}${body?.format ? ` (it says ${body.format})` : ""}` };
  }
  const agents = Array.isArray(body.agents) ? body.agents : [];
  const owners = Array.isArray(body.owners) ? body.owners : [];
  const totals = Array.isArray(body.totals) ? body.totals : [];

  // Day by day, then agent by agent, from the job lines up.
  const byCurrencyAgents = new Map();
  for (const a of agents) {
    const who = agentName(a);
    if (a.read === "failed") problems.push(`${who}: its spend could not be read (${a.read_failed ?? "no reason given"})`);
    for (const c of a.currencies ?? []) {
      const days = c.days ?? [];
      for (const d of days) {
        const jobs = sum((d.jobs ?? []).map((j) => n(j.spent_micro)));
        if (jobs + n(d.untraced_micro) !== n(d.spent_micro)) {
          problems.push(`${who} ${c.currency} on ${d.day}: the day says ${d.spent_micro} micro, its job lines ${jobs} and its untraced amount ${d.untraced_micro}, which do not add up`);
        }
      }
      const dayTotal = sum(days.map((d) => n(d.spent_micro)));
      if (dayTotal !== n(c.spent_micro)) problems.push(`${who} ${c.currency}: its days add up to ${dayTotal} micro and it says ${c.spent_micro}`);
      if (n(c.traced_micro) + n(c.untraced_micro) !== n(c.spent_micro)) {
        problems.push(`${who} ${c.currency}: traced ${c.traced_micro} and untraced ${c.untraced_micro} micro do not add up to the ${c.spent_micro} it says`);
      }
      const untracedParts = sum((c.untraced ?? []).map((u) => n(u.amount_micro)));
      if (untracedParts !== n(c.untraced_micro)) {
        problems.push(`${who} ${c.currency}: the untraced parts named add up to ${untracedParts} micro and it says ${c.untraced_micro}`);
      }
      const t = byCurrencyAgents.get(c.currency) ?? { spent: 0, traced: 0, untraced: 0 };
      t.spent += n(c.spent_micro); t.traced += n(c.traced_micro); t.untraced += n(c.untraced_micro);
      byCurrencyAgents.set(c.currency, t);
    }
  }

  // The totals equal the sum of the agents, and the sum of the owners.
  const byCurrencyOwners = new Map();
  for (const o of owners) for (const c of o.currencies ?? []) {
    const t = byCurrencyOwners.get(c.currency) ?? { spent: 0, traced: 0, untraced: 0 };
    t.spent += n(c.spent_micro); t.traced += n(c.traced_micro); t.untraced += n(c.untraced_micro);
    byCurrencyOwners.set(c.currency, t);
  }
  const currencies = new Set([...byCurrencyAgents.keys(), ...byCurrencyOwners.keys(), ...totals.map((t) => t.currency)]);
  for (const cur of currencies) {
    const total = totals.find((t) => t.currency === cur) ?? { spent_micro: 0, traced_micro: 0, untraced_micro: 0 };
    const ag = byCurrencyAgents.get(cur) ?? { spent: 0, traced: 0, untraced: 0 };
    const ow = byCurrencyOwners.get(cur) ?? { spent: 0, traced: 0, untraced: 0 };
    for (const [part, field] of [["spent", "spent_micro"], ["traced", "traced_micro"], ["untraced", "untraced_micro"]]) {
      if (ag[part] !== n(total[field])) problems.push(`${cur} ${part}: the agents add up to ${ag[part]} micro and the total says ${total[field]}`);
      if (ow[part] !== n(total[field])) problems.push(`${cur} ${part}: the owners add up to ${ow[part]} micro and the total says ${total[field]}`);
    }
  }

  // What the platform said, beside what was checked here.
  const theirs = Array.isArray(body.discrepancies) ? body.discrepancies : [];
  const allProblems = [...theirs.map((d) => `the platform: ${d}`), ...problems.map((p) => `the watcher: ${p}`)];
  const reconciles = body.reconciles === true && allProblems.length === 0;
  const traced = body.every_spend_traced === true;

  // Every ceiling crossed, per agent: the report's `against` and its marks.
  const crossed = [];
  for (const a of agents) {
    for (const c of a.against ?? []) for (const o of c.over ?? []) {
      crossed.push({ agent: agentName(a), key: a.agent, scope: c.scope, ceiling_micro: c.ceiling_micro, spent_micro: o.spent_micro, day: o.day ?? null, job: o.job ?? null, context_id: o.context_id ?? null, currency: a.allowed?.currency ?? a.currencies?.[0]?.currency ?? "" });
    }
    for (const m of a.crossings ?? []) {
      // The platform's own once-per-crossing mark (spend-rollup.ts ExceededMark).
      crossed.push({ agent: agentName(a), key: a.agent, mark: true, scope: m.scope, ceiling_micro: m.ceiling_micro, spent_micro: m.spent_micro, day: m.day ?? null, job: m.task_id ?? null, context_id: m.context_id ?? null, at: m.at ?? null, currency: m.currency ?? "" });
    }
  }

  return {
    ok: true,
    window: body.window ?? null,
    generated_at: body.generated_at ?? null,
    agents, owners, totals,
    every_spend_traced: traced,
    platform_reconciles: body.reconciles === true,
    reconciles,
    discrepancies: allProblems,
    crossed,
  };
}

/** One agent's line in the report: what it spent in each currency. */
export function agentSpendWords(a) {
  const cs = a?.currencies ?? [];
  if (a?.read === "failed") return "not read";
  if (!cs.length) return "nothing on record";
  return cs.map((c) => moneyWords(c.spent_micro, c.currency)).join(", ");
}

/** What was allowed for one agent, in words. */
export function allowedWords(a) {
  const al = a?.allowed ?? {};
  if (!al.registered) return "no allowance registered";
  if (al.valid === false) return `an allowance that does not hold (${al.reason ?? "no reason given"})`;
  const cs = al.ceilings ?? [];
  if (!cs.length) return "an allowance with no ceilings";
  return cs.map((c) => `${moneyWords(c.amount_micro, al.currency ?? "")} per ${c.scope}${c.task_id ? ` (job ${c.task_id})` : ""}${c.context_id ? ` (context ${c.context_id})` : ""}`).join("; ");
}
