// The Monitor half: whether each agent is alive, answering, and inside its
// limits, each answer with the reading it rests on and where that was read.
//
// Pure: readings in, verdicts out. Nothing here reads the network or a clock;
// watch.mjs does the reading and hands everything over with the time it was
// read.
//
//   alive       the registry's live presence, as the agent's storefront shows
//               it (`availability`), with the last check-in beside it. It says
//               whether the agent's node is connected, and nothing more.
//   answering   whether the agent answered the worker interface's `status`
//               question within the wait (ask.mjs). This is the one that
//               matters: silence is a failure, never no news.
//   limits      what the agent declared against what the platform recorded:
//               the time a job may take (an offering's `job_seconds` ceiling in
//               its AgentDoc) against the platform's 30-day average and the
//               job it says it is running now; and the money it may spend (the
//               ceilings of the allowance its owner registered) against what
//               the spend report says each day and each job spent, and the
//               platform's own marks of a ceiling crossed. A limit with no
//               reading to hold it against is said to be not measured.
//
// An agent that is not alive, did not answer, or is outside a limit gets an
// open alert naming each reason. So does an agent the watcher could not ask
// (held at its door, refused, or no way to send): it has no current answer,
// and the stage is done only when each agent has a current answer or an open
// alert. Only the first kind is raised to the incident recorder: an agent the
// watcher could not ask has not been seen failing, and recording an incident
// against it would record the watcher's own gap as the agent's.
//
//   needs: node >= 22
//   import { checkAgent } from "./checks.mjs"
import { readAnswer } from "./ask.mjs";
import { declaredCeilings, presenceOf } from "./platform.mjs";
import { agentName, moneyWords } from "./spend.mjs";

const UP = new Set(["online", "busy", "degraded", "live"]);

function alive(cardRead) {
  if (!cardRead) return { state: "unknown", why: "its storefront was not read", source: null };
  if (cardRead.status === 404) return { state: "no", why: "the platform does not know this handle", source: cardRead.url, at: cardRead.at };
  if (!cardRead.ok) return { state: "unknown", why: `its storefront could not be read: ${cardRead.error}`, source: cardRead.url, at: cardRead.at };
  const p = presenceOf(cardRead.body);
  const base = { availability: p.availability, last_seen_at: p.last_seen_at, source: cardRead.url, at: cardRead.at };
  if (!p.availability) return { state: "unknown", why: "its storefront carries no presence (an agent that is not listed publicly shows none)", ...base };
  return UP.has(p.availability.toLowerCase())
    ? { state: "yes", ...base }
    : { state: "no", why: `the registry says it is ${p.availability}`, ...base };
}

function answering(asked, waitSeconds) {
  if (!asked) return { state: "unknown", why: "it was not asked", raise: false };
  const base = { asked_at: asked.sent_at, source: "agentmesh messages send, the worker interface's status" };
  if (asked.outcome === "answered") {
    const a = readAnswer(asked.reply);
    return { state: "yes", answered_at: asked.answered_at, seconds: asked.seconds ?? null, ...base,
      as_worker: a.worker, ...(a.worker ? { job: a.job, job_state: a.state, detail: a.detail } : { words: a.words }) };
  }
  if (asked.outcome === "silent") return { state: "no", why: asked.why ? asked.why.replace(/^no answer/, "it did not answer") : `it did not answer within ${waitSeconds}s`, gave_up_at: asked.gave_up_at, ...base, raise: true };
  if (asked.outcome === "held") return { state: "unknown", why: `the question was held at its door for its owner, so it was never asked: ${asked.why}`, gave_up_at: asked.gave_up_at, ...base, raise: false };
  if (asked.outcome === "refused") return { state: "unknown", why: `its door refused the question: ${asked.why}`, gave_up_at: asked.gave_up_at, ...base, raise: false };
  if (asked.outcome === "unsent") return { state: "unknown", why: `the question was never sent: ${asked.why}`, gave_up_at: asked.gave_up_at ?? asked.sent_at, ...base, raise: false };
  return { state: "unknown", why: `the question could not be sent: ${asked.why}`, gave_up_at: asked.gave_up_at ?? asked.sent_at, ...base, raise: false };
}

/** "running for 412s" from the worker interface's detail, in seconds. */
const runningFor = (detail) => { const m = /running for (\d+)s/.exec(String(detail ?? "")); return m ? Number(m[1]) : null; };

function timeChecks({ ceilings, recordRead, answer, agentdocRead }) {
  const out = [];
  const times = ceilings.filter((c) => c.limit === "job_seconds" && Number.isFinite(Number(c.most)));
  if (!times.length) return out;
  const most = Math.max(...times.map((c) => Number(c.most)));
  const declared = `${most}s a job (${times.map((c) => `${c.offering}: ${c.most}s`).join(", ")})`;
  const declaredAt = `${agentdocRead.url} ${times.map((c) => c.place).join(", ")}`;
  const rec = recordRead?.ok ? recordRead.body : null;
  if (rec && Number.isFinite(rec.average_seconds) && Number(rec.runs) > 0) {
    const avg = Number(rec.average_seconds);
    out.push({
      limit: "time", declared, declared_at: declaredAt,
      observed: `an average of ${avg}s over ${rec.runs} run${rec.runs === 1 ? "" : "s"} in ${rec.window_days ?? 30} days`,
      observed_at: recordRead.url, at: recordRead.at,
      verdict: avg > most ? "outside" : "inside",
      ...(avg > most ? { keys: ["time:average"] } : {}),
      ...(avg > most ? { why: `its average job took ${avg}s, longer than the longest it declares, ${most}s` } : {}),
    });
  } else {
    out.push({ limit: "time", declared, declared_at: declaredAt, verdict: "not measured",
      why: recordRead?.ok ? "the platform recorded no runs in its window" : `its run record could not be read${recordRead?.error ? `: ${recordRead.error}` : ""}` });
  }
  if (answer?.state === "yes" && answer.as_worker && answer.job_state === "working") {
    const s = runningFor(answer.detail);
    if (s !== null) {
      out.push({
        limit: "time", declared, declared_at: declaredAt,
        observed: `a job running for ${s}s when asked`, observed_at: answer.source, at: answer.answered_at,
        verdict: s > most ? "outside" : "inside",
        ...(s > most ? { keys: [`time:running:${answer.job ?? ""}`] } : {}),
        ...(s > most ? { why: `it said a job had been running for ${s}s, past the ${most}s it declares` } : {}),
      });
    }
  }
  return out;
}

function moneyChecks({ spendAgent, spendRead, spendWhy }) {
  if (!spendAgent) return [{ limit: "money", verdict: "not measured", why: spendWhy || "its spend was not read" }];
  const al = spendAgent.allowed ?? {};
  if (!al.registered) return [{ limit: "money", verdict: "not measured", why: "its owner registered no allowance, so nothing was allowed or measured against", observed_at: spendRead?.url }];
  if (al.valid === false) return [{ limit: "money", verdict: "not measured", why: `its registered allowance does not hold: ${al.reason ?? "no reason given"}`, observed_at: spendRead?.url }];
  const out = [];
  for (const c of spendAgent.against ?? []) {
    const declared = `${moneyWords(c.ceiling_micro, al.currency ?? "")} per ${c.scope}${c.task_id ? ` (job ${c.task_id})` : ""}${c.context_id ? ` (context ${c.context_id})` : ""}`;
    if (!c.checked) {
      out.push({ limit: "money", declared, declared_at: "its registered allowance, as the spend report carries it", verdict: "not measured", why: c.note || "nothing in the window to measure it against", observed_at: spendRead?.url });
      continue;
    }
    const over = c.over ?? [];
    out.push({
      limit: "money", declared, declared_at: "its registered allowance, as the spend report carries it",
      observed: `${c.checked} ${c.scope === "task" ? "job" : c.scope}${c.checked === 1 ? "" : "s"} in the window`, observed_at: spendRead?.url, at: spendRead?.at,
      verdict: over.length ? "outside" : "inside",
      ...(over.length ? { keys: over.map((o) => `money:${c.scope}:${o.job ?? o.day ?? o.context_id ?? ""}`) } : {}),
      ...(over.length ? { why: over.map((o) => `${moneyWords(o.spent_micro, al.currency ?? "")} spent${o.job ? ` in job ${o.job}` : ""}${o.day ? ` on ${o.day}` : ""}${o.context_id ? ` in context ${o.context_id}` : ""}, over its ${declared} ceiling`).join("; ") } : {}),
    });
  }
  // The platform's own mark of a crossing is the same event as a line the
  // report's own measure found over, when both name the same job, day or
  // context: it is said once, by the measure, and the mark stands alone only
  // where nothing measured it.
  const measured = new Set(out.flatMap((c) => c.keys ?? []));
  for (const m of spendAgent.crossings ?? []) {
    const key = `money:${m.scope}:${m.task_id ?? m.day ?? m.context_id ?? String(m.at ?? "").slice(0, 10)}`;
    if (measured.has(key)) continue;
    measured.add(key);
    out.push({
      limit: "money", declared: `${moneyWords(m.ceiling_micro, m.currency)} per ${m.scope}`, declared_at: "the ceiling the platform marked as crossed",
      // Seen when the spend report was read; the crossing's own time is in its words.
      observed: `${moneyWords(m.spent_micro, m.currency)} at ${m.at}`, observed_at: spendRead?.url, at: spendRead?.at, keys: [key],
      verdict: "outside", why: `the platform marked its ${m.scope} ceiling of ${moneyWords(m.ceiling_micro, m.currency)} crossed at ${m.at}${m.task_id ? ` (job ${m.task_id})` : ""}`,
    });
  }
  if (!out.length) out.push({ limit: "money", verdict: "not measured", why: "its allowance has no ceiling the platform measures", observed_at: spendRead?.url });
  return out;
}

/**
 * One agent, checked.
 *   named        the handle as the owner named it
 *   card, record, agentdoc   the platform reads (platform.mjs results)
 *   asked        the ask.mjs result
 *   spendAgent   this agent's entry in the spend report, or null
 *   spendRead    the spend report read ({url, at}), and spendWhy when it was not read
 */
export function checkAgent({ named, card, record, agentdoc, asked, spendAgent = null, spendRead = null, spendWhy = "", waitSeconds = 60 }) {
  const a = alive(card);
  const handle = card?.ok ? (card.body?.card?.card?.handle ?? named) : named;
  const key = card?.ok ? presenceOf(card.body).key : (spendAgent?.agent ?? null);
  const ans = answering(asked, waitSeconds);
  const ceilings = agentdoc?.ok ? declaredCeilings(agentdoc.body) : [];
  const checks = [
    ...timeChecks({ ceilings, recordRead: record, answer: ans, agentdocRead: agentdoc ?? {} }),
    ...moneyChecks({ spendAgent, spendRead, spendWhy }),
  ];
  const others = ceilings.filter((c) => c.limit !== "job_seconds");
  for (const c of others) {
    checks.push({ limit: c.limit, declared: `${JSON.stringify(c.most)} (${c.offering})`, declared_at: `${agentdoc.url} ${c.place}`, verdict: "not measured", why: "the platform keeps no reading of this per job that the watcher can read" });
  }
  const outside = checks.filter((c) => c.verdict === "outside");
  const inside = checks.filter((c) => c.verdict === "inside");
  const limits = { state: outside.length ? "outside" : inside.length ? "inside" : "unknown", checks };

  // What was seen, in time order, each with where: the incident recorder's
  // lines when an alert is raised, and the report's own trail.
  const obs = [];
  const seen = (time, event, source) => { if (time) obs.push({ time, event, source }); };
  if (card) seen(card.at, card.ok ? `the storefront said its presence is ${presenceOf(card.body).availability ?? "not shown"}` : `the storefront could not be read: ${card.error}`, card.url);
  if (a.last_seen_at) seen(a.last_seen_at, "it last checked in with the registrar", card?.url);
  if (asked) seen(asked.sent_at, "the watcher asked it the worker interface's status", ans.source);
  if (ans.state === "yes") seen(ans.answered_at, ans.as_worker ? `it answered after ${ans.seconds}s: its job ${ans.job ?? "(none named)"} is ${ans.job_state ?? "unknown"}${ans.detail ? ` (${ans.detail})` : ""}` : `it answered after ${ans.seconds}s, not as the worker interface: ${ans.words}`, ans.source);
  else if (asked) seen(ans.gave_up_at, ans.why, ans.source);
  if (record?.ok) seen(record.at, `the platform's record: ${record.body?.runs ?? "?"} runs, ${record.body?.failed ?? "?"} failed, an average of ${record.body?.average_seconds ?? "?"}s over ${record.body?.window_days ?? 30} days`, record.url);
  for (const c of outside) seen(c.at ?? spendRead?.at ?? card?.at, `outside its limits: ${c.why}`, c.observed_at);

  const reasons = [];
  const times = [];
  const keys = [];
  let raise = false;
  // `keys` name what opened the alert, the same way from one watch to the
  // next, so a later watch can tell an alert still open from a new one.
  const open = (why, when, raised, ks) => { reasons.push(why); if (raised) raise = true; if (when) times.push(when); keys.push(...ks); };
  if (a.state === "no") open(`not alive: ${a.why}`, a.at, true, ["alive"]);
  if (ans.state === "no") open(`not answering: ${ans.why}`, ans.gave_up_at, true, ["answering"]);
  if (ans.state === "unknown") open(`no current answer: ${ans.why}`, ans.gave_up_at ?? ans.asked_at, false, ["unasked"]);
  for (const c of outside) open(`outside its limits: ${c.why}`, c.at, true, c.keys ?? [`${c.limit}:outside`]);
  // The alert's time is the latest moment the watcher saw what opened it, so
  // what it saw falls before it, inside the incident recorder's window.
  times.sort();
  const at = times[times.length - 1] ?? null;
  obs.sort((x, y) => String(x.time).localeCompare(String(y.time)));
  return {
    named, handle, key,
    alive: a, answering: ans, limits,
    alert: reasons.length ? { at, reasons, raise, keys } : null,
    observations: obs,
  };
}

/** A spend-report agent entry for this handle or key, or null. */
export function spendEntryFor(spend, { handle, key }) {
  if (!spend?.agents) return null;
  return spend.agents.find((a) => (key && a.agent === key) || (handle && a.handle && a.handle.toLowerCase() === handle.toLowerCase())) ?? null;
}

export { agentName };
