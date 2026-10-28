// Watch the fleet: one command, no model, in rounds.
//   needs: node >= 22
//   node watch.mjs --job <job folder> --records <records folder>
//        [--work <work folder>] [--text-file <message>]
//        [--from <sender>] [--in-reply-to <message id> | none] [--message <message id>]
//
// This is the command the runtime requirements start (run.watch-the-fleet),
// for every message the watcher gets: a request for a watch, and each answer
// a watched agent sends back. What it reads is set by the install, never by a
// message:
//
//   WATCH_AGENTS       the agents to watch, by handle; the owner names them
//   MESH_API_BASE      the platform's origin
//   WATCH_TOKEN        an account API token with the credits:read scope only
//   INCIDENT_RECORDER  the incident recorder's handle, to raise alarms to
//   ANSWER_SECONDS     how long each agent has to answer (default 60)
//
// THE ROUND. The job that asks cannot hear the answers: its questions are left
// for the host, which sends them when the job ends, and each answer comes back
// as a message of its own. So a watch is a round (rounds.mjs):
//
//   a request, no round open      read the watch list, the platform's records
//                                 and the spend, and leave the status question
//                                 for every agent: the round opens
//   an answer                     recorded against the agent that sent it; when
//                                 every agent asked has answered, the round
//                                 closes and its report goes to whoever asked
//   a request, a round open       before the wait is over: says so, and asks
//                                 nobody again. After it: the round closes (the
//                                 agents that did not answer did not answer
//                                 within the wait), its report is this job's
//                                 pieces, and a new round opens
//
// Closing a round checks each agent (checks.mjs), writes the report
// (write-report.mjs), and raises each new alert to the incident recorder in
// its own input shape (alarms.mjs). A message may narrow the agents a round
// asks (`agent:` lines) and name the spend window (`from:` and `to:` days).
//
// It changes nothing it watches, spends nothing, and wakes no model. It prints
// one JSON object with a `reply` field. Exit codes: 0 done (open alerts
// included: an alert is a finding, not a failure of the watch); 2 usage; 3
// the job stops and the reply says why; 1 failed.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watchList, windowOf } from "./watch-list.mjs";
import { platform, presenceOf } from "./platform.mjs";
import { askAll } from "./ask.mjs";
import { checkAgent, spendEntryFor } from "./checks.mjs";
import { moneyWords, readSpend } from "./spend.mjs";
import { writeReport, WATCHER } from "./write-report.mjs";
import { alarmFor } from "./alarms.mjs";
import { declineFor, declineReply } from "./declines.mjs";
import { AGENT_ID, leave, outboxDir, startOutbox } from "./outbox.mjs";
import { allAnswered, askedAt, loadRound, newRoundId, openRound, recordAnswer, saveRound, sentLines, withLock, writeWhole } from "./rounds.mjs";
import { fill, plan } from "./pieces.mjs";
import { note, read as wentWithout, sentence } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();
const many = (n, word, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;
const same = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const STANDING_FILE = "open-alerts.json";

/** The alerts raised and still open, by agent. A list that cannot be read is
 *  empty: the worst that does is raise an open alert again. */
export function readStanding(records) {
  try {
    const doc = JSON.parse(readFileSync(join(records, STANDING_FILE), "utf8"));
    return doc && typeof doc.agents === "object" && doc.agents ? doc.agents : {};
  } catch { return {}; }
}

export function writeStanding(records, agents) {
  writeWhole(join(records, STANDING_FILE), { open_alerts: "v1", agents });
}

export function fromArgv(args = []) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--job") parsed.job = args[++i];
    else if (a === "--records") parsed.records = args[++i];
    else if (a === "--work") parsed.work = args[++i];
    else if (a === "--text-file") parsed.textFile = args[++i];
    else if (a === "--from") parsed.from = args[++i];
    else if (a === "--in-reply-to") parsed.inReplyTo = args[++i];
    else if (a === "--message") parsed.message = args[++i];
  }
  return parsed;
}

/** The most agents one watch covers: the spend report's own bound. */
export const MAX_AGENTS = 50;

export const HOW_TO_NAME = "The agents to watch are named by the owner in the install's WATCH_AGENTS setting, by handle. A message may narrow a watch to some of them with lines of their own, `agent: <handle>`.";

/** How long each agent has to answer: 5 to 240 seconds, so the job that
 *  closes a round can wait it out inside its own time (job_seconds 300). */
const waitOf = (env) => Math.max(5, Math.min(240, Number(env.ANSWER_SECONDS) || 60));

/** The spend report, read for the named agents. A name the platform says is
 *  not one of the account's agents (404), or fits more than one (409), is
 *  taken out and the rest read again, so one name does not cost the whole
 *  spend section. */
async function readSpendFor(p, handles, window) {
  if (!p.root) return { ok: false, why: "the install names no platform address (MESH_API_BASE)" };
  if (!p.hasToken) return { ok: false, why: "the install places no read key (WATCH_TOKEN), so the spend report could not be read" };
  const info = await p.tokenInfo();
  if (!info.ok || !info.body?.accountId) return { ok: false, why: `the read key was not accepted: ${info.error ?? "no account named"}`, reads: [info] };
  const account = info.body.accountId;
  const scopes = Array.isArray(info.body.scopes) ? info.body.scopes : [];
  const reads = [info];
  let names = [...handles];
  const leftOut = {};
  for (let tries = 0; tries <= handles.length && names.length; tries++) {
    const r = await p.spendReport(account, names, window);
    reads.push(r);
    if (r.ok) return { ...readSpend(r.body), read_from: r.url.replace(/\?.*$/, ""), at: r.at, account, scopes, left_out: leftOut, reads };
    const named = r.status === 404 || r.status === 409 ? names.find((n) => String(r.error ?? "").startsWith(`${n} `)) : null;
    if (!named) return { ok: false, why: `the spend report could not be read: ${r.error}`, account, scopes, reads };
    leftOut[named] = r.error;
    names = names.filter((n) => n !== named);
  }
  return { ok: false, why: "none of the agents watched is one of the read key's account's agents, so there was no spend to read", account, scopes, left_out: leftOut, reads };
}

/** Open a round: read what is read once, and leave the questions. */
async function openNewRound({ env, text, records, dir, from, fromId, message, now, fetchImpl, notes }) {
  const wl = watchList({ setting: env.WATCH_AGENTS ?? "", text });
  const win = windowOf(text);
  for (const h of wl.malformed) notes.push({ wanted: `a handle in place of "${h}" on the watch list`, did: "left it out of the watch" });
  for (const h of wl.refused) notes.push({ wanted: `${h} on the watch list`, did: "did not watch it, because the message named it and the owner did not", why: "a message may narrow a watch, never widen it" });
  for (const d of win.bad) notes.push({ wanted: `a day written YYYY-MM-DD in place of "${d}"`, did: "read the spend over the platform's own window" });
  if (!wl.agents.length) {
    const why = !trim(env.WATCH_AGENTS)
      ? "No agents are named to watch."
      : wl.narrowed ? "None of the agents the message names is on the watch list." : "No handle on the watch list could be read.";
    return { stop: `${why} ${HOW_TO_NAME}` };
  }
  if (wl.agents.length > MAX_AGENTS) {
    return { stop: `${wl.agents.length} agents are named and one watch takes at most ${MAX_AGENTS}, the most the platform's spend report reads at once. Nothing was watched. Name at most ${MAX_AGENTS} in WATCH_AGENTS, or narrow this watch with \`agent:\` lines.` };
  }
  // Opening reads only what addressing needs: each agent's id from its
  // storefront (read twice before it is given up on), the incident
  // recorder's, and this agent's own. Everything the report says is read
  // when the round closes.
  const p = platform({ base: env.MESH_API_BASE ?? "", token: env.WATCH_TOKEN ?? "", fetchImpl, now });
  if (!p.root) notes.push({ wanted: "the platform's address (MESH_API_BASE)", did: "read nothing from the platform: no presence, no run record, no ceilings, no spend, and no agent id to address a question to" });
  const cardOf = async (h) => { if (!p.root || !h) return null; const c = await p.card(h); return c.ok || c.status === 404 ? c : p.card(h); };
  const recorder = trim(env.INCIDENT_RECORDER);
  const self = trim(env.MESH_SELF_HANDLE);
  const [cards, recorderCard, selfCard] = await Promise.all([Promise.all(wl.agents.map(cardOf)), cardOf(recorder), cardOf(self)]);
  const agents = wl.agents.map((named, i) => {
    const c = cards[i];
    const key = c?.ok ? presenceOf(c.body).key : null;
    return {
      named, handle: c?.ok ? (c.body?.card?.card?.handle ?? named) : named, key,
      ...(key ? {} : { no_key_why: c ? `its storefront could not be read (${c.error}), so it had no agent id to address` : "nothing was read from the platform, so it had no agent id to address" }),
    };
  });
  const id = newRoundId(now());
  const at = now().toISOString();
  const asked = askAll(agents, { dir, thread: id, at });
  agents.forEach((a, i) => { a.asked = asked[i]; delete a.no_key_why; });
  const wait = waitOf(env);
  const round = {
    round: "v1", id, status: "open", opened_at: at, wait_seconds: wait,
    requested_by: { handle: trim(from) || null, key: AGENT_ID.test(trim(fromId)) ? trim(fromId) : null },
    request_message: trim(message) || null,
    out_dir: dir,
    window: { from: win.from, to: win.to },
    recorder: recorder ? { handle: recorder, key: recorderCard?.ok ? presenceOf(recorderCard.body).key : null, why: recorderCard?.ok ? null : recorderCard ? `its storefront could not be read (${recorderCard.error})` : "nothing was read from the platform" } : null,
    agents,
  };
  // The round closes itself: a message to this agent, which the host sends
  // as this job ends, and whose job waits out the wait and then closes the
  // round if the answers have not closed it already.
  const selfKey = selfCard?.ok ? presenceOf(selfCard.body).key : null;
  if (selfKey) {
    const left = leave(dir, { to: selfKey, handle: self, text: `${CLOSE_MARK}\n${id}` });
    round.closes_itself = left.left ? { key: selfKey, handle: self } : null;
    if (!left.left) notes.push({ wanted: "a message to itself to close the round when the wait is over", did: "left the round to close on its last answer or at the next request", why: left.error });
  } else {
    round.closes_itself = null;
    notes.push({ wanted: "its own agent id, to close the round when the wait is over", did: "left the round to close on its last answer or at the next request", why: self ? `its storefront could not be read` : "the host names no handle for it (MESH_SELF_HANDLE)" });
  }
  saveRound(records, round);
  return { round };
}

/**
 * Close a round: check each agent, write the report and the record into this
 * job's records, and leave each new alarm for the host to send to the
 * incident recorder. Returns what the reply and the pieces need.
 */
async function closeRound(round, { env, fetchImpl, records, jobRecords, jobDir, dir, now, notes }) {
  // The report's readings are as of its close: presence, runs, ceilings and
  // spend are read again now, so an agent that went down while the round was
  // open is reported down. The round's own readings, from when it opened,
  // stand only where nothing can be read now.
  const p = platform({ base: env.MESH_API_BASE ?? "", token: env.WATCH_TOKEN ?? "", fetchImpl, now });
  if (p.root) {
    const fresh = await Promise.all(round.agents.map(async (a) => ({ card: await p.card(a.named), record: await p.record(a.named), agentdoc: await p.agentdoc(a.named) })));
    round.agents.forEach((a, i) => { a.reads = fresh[i]; });
    round.spend = await readSpendFor(p, round.agents.map((a) => a.named), round.window ?? {});
  }
  const closedAt = now().toISOString();
  const spend = round.spend ?? { ok: false, why: "the spend was not read" };
  if (!spend.ok) notes.push({ wanted: "the spend report", did: "reported every agent's money limits as not measured and the spend section as not read", why: spend.why });
  if (spend.ok && spend.scopes?.some((s) => s !== "credits:read")) {
    notes.push({ wanted: "a read key that can only read", did: "read the spend with the key it was given", why: `the key placed also carries ${list(spend.scopes.filter((s) => s !== "credits:read"))}, which can do more than read` });
  }
  const sent = sentLines(round);
  const agents = round.agents.map((a) => {
    const entry = spend.ok ? spendEntryFor(spend, { handle: a.handle, key: a.key }) : null;
    const left = spend.left_out?.[a.named];
    const why = spend.ok ? (left ? `the platform did not report its spend (${left})` : "") : spend.why;
    return checkAgent({ named: a.named, card: a.reads?.card, record: a.reads?.record, agentdoc: a.reads?.agentdoc, asked: askedAt(a, round, sent), spendAgent: entry, spendRead: spend.ok ? { url: spend.read_from, at: spend.at } : null, spendWhy: why, waitSeconds: round.wait_seconds });
  });

  // Alarms. An alert stays open from one round to the next until a round finds
  // the agent clear. The standing list ({records}/open-alerts.json) keeps, per
  // agent, what opened it and when it was raised, so a scheduled watch does not
  // raise the same failure as a new incident every time: an alert whose every
  // reason was already raised is reported as still open, and only a new reason
  // raises it again.
  const standing = readStanding(records);
  const raised = [];
  const recorder = round.recorder;
  for (const a of agents) {
    const was = standing[a.named];
    if (!a.alert?.raise) {
      if (was && !a.alert) delete standing[a.named];
      continue;
    }
    if (was && a.alert.keys.every((k) => was.keys.includes(k))) {
      a.alert.still_open = { since: was.opened_at, raised_to: was.raised_to ?? null, raised_at: was.raised_at ?? null };
      continue;
    }
    const al = alarmFor(a, { watcher: WATCHER });
    if (!al) continue;
    const path = join(jobDir, "out", al.file);
    mkdirSync(join(jobDir, "out"), { recursive: true });
    writeFileSync(path, al.jsonl);
    mkdirSync(join(jobRecords, "alarms"), { recursive: true });
    writeFileSync(join(jobRecords, "alarms", al.file), al.jsonl);
    let r;
    if (!recorder) r = { sent: false, why: "the install names no incident recorder (INCIDENT_RECORDER)" };
    else if (!recorder.key) r = { sent: false, why: `the incident recorder ${recorder.handle} could not be addressed: ${recorder.why}` };
    else {
      const left = leave(dir, { to: recorder.key, handle: recorder.handle, text: al.text, files: [{ path, name: al.file, media_type: "application/x-ndjson" }] });
      r = left.left ? { sent: true, ref: left.ref } : { sent: false, why: left.error };
    }
    raised.push({ agent: al.agent, time: al.time, message: al.text, file: al.file, to: recorder?.handle ?? null, ...r });
    if (r.sent) standing[a.named] = { keys: [...new Set([...(was?.keys ?? []), ...a.alert.keys])], opened_at: was?.opened_at ?? a.alert.at, raised_to: recorder.handle, raised_at: closedAt };
    else notes.push({ wanted: `the alarm for ${al.agent} reaching the incident recorder`, did: "handed it back with the report", why: r.why });
  }
  writeStanding(records, standing);
  writeFileSync(join(jobRecords, "raised.json"), JSON.stringify(raised, null, 2) + "\n");

  // What is not known, said plainly.
  const notKnown = [
    "Rate: an agent's published rate limits are in its registration, which no page the watcher reads carries, and the platform counts runs per day, not per minute, so no rate was checked.",
  ];
  for (const a of agents) {
    if (a.alive.state === "unknown") notKnown.push(`Whether ${a.handle} is alive: ${a.alive.why}.`);
    if (a.answering.state === "unknown") notKnown.push(`Whether ${a.handle} is answering: ${a.answering.why}.`);
    for (const c of a.limits.checks.filter((x) => x.verdict === "not measured")) notKnown.push(`${a.handle}, ${c.limit}: ${c.why}.`);
  }
  if (!spend.ok) notKnown.push(`What the agents spent: ${spend.why}.`);
  for (const [h, why] of Object.entries(spend.left_out ?? {})) notKnown.push(`What ${h} spent: the platform did not report it (${why}).`);

  // Every read, as a source.
  const sources = [];
  for (const a of round.agents) {
    const r = a.reads ?? {};
    for (const [what, x] of [["storefront", r.card], ["run record", r.record], ["AgentDoc", r.agentdoc]]) if (x) sources.push({ what: `${a.named}, ${what}`, where: x.url, at: x.at, status: x.status });
    const q = askedAt(a, round, sent);
    sources.push({ what: `${a.named}, the worker interface's status`, where: "a message from this agent, left for its host to send", at: q.sent_at, status: q.outcome });
  }
  for (const r of spend.reads ?? []) sources.push({ what: r.url.includes("spend-report") ? "the spend report" : "the read key's account", where: r.url.replace(/\?.*$/, ""), at: r.at, status: r.status });

  const markdown = writeReport({ watchedAt: closedAt, round, account: spend.account ?? null, agents, spend, raised, notKnown, sources });
  const reportPath = join(jobRecords, "watch-report.md");
  writeFileSync(reportPath, markdown);
  const record = {
    watch: "v1", round: round.id, opened_at: round.opened_at, closed_at: closedAt, wait_seconds: round.wait_seconds,
    watched_by: WATCHER, requested_by: round.requested_by, account: spend.account ?? null,
    agents,
    spend: spend.ok ? { window: spend.window, generated_at: spend.generated_at, read_from: spend.read_from, every_spend_traced: spend.every_spend_traced, platform_reconciles: spend.platform_reconciles, reconciles: spend.reconciles, discrepancies: spend.discrepancies, totals: spend.totals, owners: spend.owners, agents: spend.agents, left_out: spend.left_out } : { read: false, why: spend.why },
    alerts: raised,
    not_known: notKnown,
    sources,
  };
  const recordPath = join(jobRecords, "watch-record.json");
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");

  round.status = "closed";
  round.closed_at = closedAt;
  saveRound(records, round);

  const count = (pred) => agents.filter(pred).length;
  const open = agents.filter((a) => a.alert);
  const sentAlarms = raised.filter((r) => r.sent);
  const spendLine = spend.ok
    ? `Between ${spend.window.from} and ${spend.window.to} they spent ${spend.totals.length ? spend.totals.map((t) => moneyWords(t.spent_micro, t.currency)).join(", ") : "nothing"}; ${spend.every_spend_traced ? "every spend traces to a job" : "not every spend traces to a job, and each part that does not is named with why"}, and the totals ${spend.reconciles ? "reconcile" : "do not reconcile"}.`
    : `The spend was not read: ${spend.why}.`;
  const summary = [
    `Watch ${round.id}, asked at ${round.opened_at}: of ${many(agents.length, "agent")}, ${count((a) => a.alive.state === "yes")} alive, ${count((a) => a.answering.state === "yes")} answering, ${count((a) => a.limits.state === "inside")} inside every limit measured.`,
    open.length ? `${many(open.length, "alert is", "alerts are")} open: ${open.map((a) => `${a.handle} (${a.alert.reasons.join("; ")})`).join("; ")}.` : "No alert is open.",
    raised.length ? (sentAlarms.length ? `${many(sentAlarms.length, "alarm goes", "alarms go")} to ${recorder.handle} as this job ends.` : "The alarms were not raised to an incident recorder; each is handed back with the report.") : "",
    spendLine,
    "The report says where every line was read.",
  ].filter(Boolean).join(" ");
  return { agents, raised, reportPath, recordPath, summary, open: open.length, reconciles: spend.ok ? spend.reconciles : null };
}

/** The first line of the message a round sends itself to close when the wait is over. */
export const CLOSE_MARK = "agentmesh-watcher/v1 close";

/** Hand a closed round's report, as a message with the report and the record
 *  attached, to whoever asked for it. */
function handReport(round, c, { jobDir, dir, jobRecords }) {
  const to = round.requested_by ?? {};
  if (!to.key) return ` Nobody could be addressed to send its report to${to.handle ? ` (${to.handle} gave no agent id)` : ""}; it is kept in this job's records.`;
  mkdirSync(join(jobDir, "out"), { recursive: true });
  const files = [];
  for (const [from, name, media_type] of [[c.reportPath, "watch-report.md", "text/markdown"], [c.recordPath, "watch-record.json", "application/vnd.agentmesh.watch-record+json"]]) {
    const path = join(jobDir, "out", name);
    writeFileSync(path, readFileSync(from));
    files.push({ path, name, media_type });
  }
  const went = sentence(wentWithout(jobRecords));
  const r = leave(dir, { to: to.key, handle: to.handle, text: [went, c.summary].filter(Boolean).join(" "), files });
  return r.left ? ` Its report goes to ${to.handle ?? to.key} as this job ends.` : ` Its report could not be sent to ${to.handle ?? to.key} (${r.error}); it is kept in this job's records.`;
}

export async function runWatch(argv = [], { env = process.env, fetchImpl, now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const args = fromArgv(argv);
  if (!args.job || !args.records) return { ok: false, code: 2, reply: "This job needs --job <job folder> and --records <records folder>." };
  const id = basename(args.job);
  const JOB_RECORDS = join(args.records, id);
  mkdirSync(JOB_RECORDS, { recursive: true });
  for (const f of ["went-without.json", "watch-record.json", "watch-report.md", "raised.json"]) rmSync(join(JOB_RECORDS, f), { force: true });
  rmSync(join(JOB_RECORDS, "alarms"), { recursive: true, force: true });
  // A job folder used again delivers only what this run passes.
  rmSync(join(args.job, "pieces.json"), { force: true });
  for (const f of ["watch-report.md", "watch-record.json"]) rmSync(join(args.job, "out", f), { force: true });
  const dir = outboxDir(args.job, env);
  startOutbox(dir);

  const text = args.textFile && existsSync(args.textFile) ? readFileSync(args.textFile, "utf8") : "";
  const from = trim(args.from);
  // The host names the sender's agent id beside the name it passes.
  const fromId = trim(env.MESH_SENDER);
  const notes = [];
  const flush = () => { for (const n of notes) note(JOB_RECORDS, n); };
  const inReplyTo = trim(args.inReplyTo);
  const isAnswer = Boolean(inReplyTo) && inReplyTo !== "none";
  const ctx = { env, fetchImpl, records: args.records, jobRecords: JOB_RECORDS, jobDir: args.job, dir, now, notes };

  // THE ROUND CLOSING ITSELF: a message this agent sent itself when it opened
  // the round. It waits out the wait, then closes the round if nothing has.
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() === CLOSE_MARK && !isAnswer) {
    const roundId = trim(lines[1]);
    const r0 = loadRound(args.records, roundId);
    const mine = r0?.closes_itself && (same(fromId, r0.closes_itself.key) || same(from, r0.closes_itself.handle) || same(from, r0.closes_itself.key));
    if (!r0 || !mine) return { ok: true, code: 0, reply: "Only this watcher closes its own watches; nothing was done." };
    const deadline = new Date(r0.opened_at).getTime() + r0.wait_seconds * 1000;
    const left = deadline - now().getTime();
    if (left > 0) await sleep(left);
    return withLock(args.records, async () => {
      const round = loadRound(args.records, roundId);
      if (!round || round.status !== "open") return { ok: true, code: 0, reply: `Watch ${roundId} had already closed.` };
      const c = await closeRound(round, ctx);
      const handed = handReport(round, c, ctx);
      flush();
      return { ok: true, code: 0, reply: `The wait for watch ${roundId} is over, so it is closed.${handed}`, open_alerts: c.open, reconciles: c.reconciles };
    });
  }

  // AN ANSWER from an agent the open round asked.
  if (isAnswer) {
    return withLock(args.records, async () => {
      const open = openRound(args.records);
      const agent = open ? recordAnswer(open, { from, fromId, at: now().toISOString(), inReplyTo, text }) : null;
      if (!agent) return { ok: true, code: 0, reply: "This answers nothing an open watch asked, so it was not recorded." };
      saveRound(args.records, open);
      if (!allAnswered(open)) {
        const left = open.agents.filter((x) => x.asked?.outcome === "asked" && !x.answer).length;
        return { ok: true, code: 0, reply: `Recorded the answer from ${agent.handle} for watch ${open.id}; ${many(left, "agent has", "agents have")} not answered yet.` };
      }
      // Every agent asked has answered: the round closes, and its report goes
      // to whoever asked for the watch, as a message of its own.
      const c = await closeRound(open, ctx);
      const handed = handReport(open, c, ctx);
      flush();
      return { ok: true, code: 0, reply: `Recorded the answer from ${agent.handle}; every agent asked in watch ${open.id} has answered, so it is closed.${handed}`, open_alerts: c.open, reconciles: c.reconciles };
    });
  }

  // A REQUEST for something the watcher never does is declined in words,
  // before any watch is opened (scripts/declines.mjs).
  const declined = declineFor(text);
  if (declined) {
    return { ok: true, code: 0, declined: declined.id, reply: declineReply(declined) };
  }

  // A REQUEST for a watch.
  return withLock(args.records, async () => {
    const open = openRound(args.records);
    if (open) {
      const deadline = new Date(new Date(open.opened_at).getTime() + open.wait_seconds * 1000);
      if (now() < deadline && !allAnswered(open)) {
        const asked = open.agents.filter((x) => x.asked?.outcome === "asked");
        const heard = asked.filter((x) => x.answer).length;
        return { ok: true, code: 0, reply: `Watch ${open.id} asked ${many(asked.length, "agent")} at ${open.opened_at} and has heard from ${heard}. Its report goes to whoever asked for it when every one has answered, or when the wait is over at ${deadline.toISOString()}. Nobody was asked again.` };
      }
      // The wait is over and nothing closed it: close it now, hand its report
      // over as this job's pieces (and to whoever asked for it, when that was
      // somebody else), and open the next.
      const c = await closeRound(open, ctx);
      const other = open.requested_by?.key && !same(open.requested_by.key, fromId);
      const handed = other ? handReport(open, c, ctx) : "";
      const next = await openNewRound({ env, text, records: args.records, dir, from, fromId, message: args.message, now, fetchImpl, notes });
      flush();
      const listed = fill(args.job, plan({ reportPath: c.reportPath, recordPath: c.recordPath, alarms: c.raised.map((r) => ({ agent: r.agent, file: r.file, path: join(args.job, "out", r.file) })) })).map((e) => e.name);
      const went = sentence(wentWithout(JOB_RECORDS));
      const after = next.round ? `Watch ${next.round.id} has asked again.` : `No new watch was opened: ${next.stop}`;
      return { ok: true, code: 0, reply: [went, c.summary, handed.trim(), after].filter(Boolean).join(" "), open_alerts: c.open, reconciles: c.reconciles, listed };
    }

    const opened = await openNewRound({ env, text, records: args.records, dir, from, fromId, message: args.message, now, fetchImpl, notes });
    flush();
    if (opened.stop) return { ok: false, code: 3, reply: opened.stop };
    const r = opened.round;
    const asked = r.agents.filter((x) => x.asked?.outcome === "asked");
    const notAsked = r.agents.filter((x) => x.asked?.outcome !== "asked");
    const went = sentence(wentWithout(JOB_RECORDS));
    const when = r.closes_itself
      ? `The report comes to you when every agent has answered, or when the wait is over in ${r.wait_seconds} seconds, whichever is first; whoever has not answered by then is reported as not answering.`
      : `The report comes to you when every agent has answered. If one does not, ask again after ${r.wait_seconds} seconds, and whoever has not answered is reported as not answering.`;
    return {
      ok: true, code: 0,
      reply: [
        went,
        `Watch ${r.id}: I asked ${many(asked.length, "agent")} the worker interface's status${notAsked.length ? ` and could not ask ${list(notAsked.map((x) => x.handle))}` : ""}. The questions go out as this job ends.`,
        when,
      ].filter(Boolean).join(" "),
      round: r.id,
    };
  });
}

const startedAsCommand = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (startedAsCommand()) {
  const out = await runWatch(process.argv.slice(2)).catch((e) => ({
    ok: false, code: 1, reply: `No watch report was written, and this is what stopped it: ${trim(e?.message ?? e)}`,
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.code ?? 0;
}
