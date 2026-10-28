// Watch the fleet: one command, five steps, no model.
//   needs: node >= 22, and the agentmesh command on the path
//   node watch.mjs --job <job folder> --records <records folder>
//        [--work <work folder>] [--text-file <message>]
//
// This is the command the runtime requirements start (run.watch-the-fleet).
// What it reads is set by the install, never by a message:
//
//   WATCH_AGENTS       the agents to watch, by handle; the owner names them
//   MESH_API_BASE      the platform's origin, such as https://api.agentmesh.ai
//   WATCH_TOKEN        an account API token with the credits:read scope only
//   INCIDENT_RECORDER  the incident recorder's handle, to raise alarms to
//   ANSWER_SECONDS     how long each agent has to answer (default 60)
//
// A message may narrow the watch to some of the listed agents (`agent:`
// lines) and name the spend window (`from:` and `to:` days).
//
//   1. read the watch list   who, and over which days      (watch-list.mjs)
//   2. ask each agent        the worker interface's status  (ask.mjs)
//   3. check the limits      presence, runs, ceilings       (platform.mjs, checks.mjs)
//   4. read the spend        the spend report, re-added     (spend.mjs)
//   5. write the report      Markdown and the record        (write-report.mjs)
//      raise the alarms      to the incident recorder       (alarms.mjs, raise.mjs)
//
// It changes nothing it watches, spends nothing, and wakes no model.
//
// It prints one JSON object with a `reply` field. Exit codes: 0 delivered
// (open alerts included: an alert is a finding, not a failure of the watch);
// 2 usage; 3 the job stops and the reply says why; 1 failed.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watchList, windowOf } from "./watch-list.mjs";
import { platform } from "./platform.mjs";
import { askAll } from "./ask.mjs";
import { checkAgent, spendEntryFor } from "./checks.mjs";
import { moneyWords, readSpend } from "./spend.mjs";
import { writeReport, WATCHER } from "./write-report.mjs";
import { alarmFor } from "./alarms.mjs";
import { raiseAll } from "./raise.mjs";
import { fill, plan } from "./pieces.mjs";
import { note, read as wentWithout, sentence } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();
const many = (n, word, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;
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
  writeFileSync(join(records, STANDING_FILE), JSON.stringify({ open_alerts: "v1", agents }, null, 2) + "\n");
}

export function fromArgv(args = []) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--job") parsed.job = args[++i];
    else if (a === "--records") parsed.records = args[++i];
    else if (a === "--work") parsed.work = args[++i];
    else if (a === "--text-file") parsed.textFile = args[++i];
  }
  return parsed;
}

/** The most agents one watch covers: the spend report's own bound. */
export const MAX_AGENTS = 50;

export const HOW_TO_NAME = "The agents to watch are named by the owner in the install's WATCH_AGENTS setting, by handle, such as spec-writer.platform@agentmesh.ai. A message may narrow a watch to some of them with lines of their own, `agent: <handle>`.";

/** The spend report, read for the named agents. A name the platform says is
 *  not one of the account's agents is taken out and the rest read again, so
 *  one stranger on the list does not cost the whole spend section. */
async function readSpendFor(p, handles, window, records) {
  if (!p.root) return { ok: false, why: "the install names no platform address (MESH_API_BASE)" };
  if (!p.hasToken) return { ok: false, why: "the install places no read key (WATCH_TOKEN), so the spend report could not be read" };
  const info = await p.tokenInfo();
  if (!info.ok || !info.body?.accountId) return { ok: false, why: `the read key was not accepted: ${info.error ?? "no account named"}`, reads: [info] };
  const account = info.body.accountId;
  const scopes = Array.isArray(info.body.scopes) ? info.body.scopes : [];
  const reads = [info];
  let names = [...handles];
  const leftOut = [];
  const leftWhy = new Map();
  for (let tries = 0; tries <= handles.length && names.length; tries++) {
    const r = await p.spendReport(account, names, window);
    reads.push(r);
    if (r.ok) {
      const spend = readSpend(r.body);
      return { ...spend, read_from: r.url.replace(/\?.*$/, ""), url: r.url, at: r.at, account, scopes, leftOut, leftWhy, reads };
    }
    // 404: not one of the account's agents; 409: a name that fits more than
    // one of them. Either way that one name is taken out and the rest read.
    const named = r.status === 404 || r.status === 409 ? names.find((n) => String(r.error ?? "").startsWith(`${n} `)) : null;
    if (!named) return { ok: false, why: `the spend report could not be read: ${r.error}`, account, scopes, reads };
    leftOut.push(named);
    note(records, { wanted: `the spend of ${named}`, did: "read the spend of the other agents and left it out", why: r.error });
    leftWhy.set(named, r.error);
    names = names.filter((n) => n !== named);
  }
  return { ok: false, why: "none of the agents watched is one of the read key's account's agents, so there was no spend to read", account, scopes, leftOut, reads };
}

export async function runWatch(argv = [], { env = process.env, fetchImpl, bin, spawnImpl, now = () => new Date() } = {}) {
  const args = fromArgv(argv);
  if (!args.job || !args.records) return { ok: false, code: 2, reply: "This job needs --job <job folder> and --records <records folder>." };
  const id = basename(args.job);
  const RECORDS = join(args.records, id);
  mkdirSync(RECORDS, { recursive: true });
  for (const f of ["went-without.json", "watch-record.json", "watch-report.md", "raised.json"]) rmSync(join(RECORDS, f), { force: true });
  rmSync(join(RECORDS, "alarms"), { recursive: true, force: true });
  // A job folder used again delivers only what this run passes.
  rmSync(join(args.job, "pieces.json"), { force: true });
  rmSync(join(args.job, "out"), { recursive: true, force: true });

  const text = args.textFile && existsSync(args.textFile) ? readFileSync(args.textFile, "utf8") : "";
  const watchedAt = now().toISOString();

  // 1. Read the watch list.
  const wl = watchList({ setting: env.WATCH_AGENTS ?? "", text });
  const win = windowOf(text);
  for (const h of wl.malformed) note(RECORDS, { wanted: `a handle in place of "${h}" on the watch list`, did: "left it out of the watch" });
  for (const h of wl.refused) note(RECORDS, { wanted: `${h} on the watch list`, did: "did not watch it, because the message named it and the owner did not", why: "a message may narrow a watch, never widen it" });
  for (const d of win.bad) note(RECORDS, { wanted: `a day written YYYY-MM-DD in place of "${d}"`, did: "read the spend over the platform's own window" });
  if (!wl.agents.length) {
    const why = !trim(env.WATCH_AGENTS)
      ? "No agents are named to watch."
      : wl.narrowed ? "None of the agents the message names is on the watch list." : "No handle on the watch list could be read.";
    return { ok: false, code: 3, reply: `${why} ${HOW_TO_NAME}` };
  }

  if (wl.agents.length > MAX_AGENTS) {
    return { ok: false, code: 3, reply: `${wl.agents.length} agents are named and one watch takes at most ${MAX_AGENTS}, the most the platform's spend report reads at once. Nothing was watched. Name at most ${MAX_AGENTS} in WATCH_AGENTS, or narrow this watch with \`agent:\` lines.` };
  }

  // 2 to 4, at once: the questions take a wait, and the reads do not need it.
  const waitSeconds = Math.max(5, Math.min(600, Number(env.ANSWER_SECONDS) || 60));
  const p = platform({ base: env.MESH_API_BASE ?? "", token: env.WATCH_TOKEN ?? "", fetchImpl, now });
  if (!p.root) note(RECORDS, { wanted: "the platform's address (MESH_API_BASE)", did: "asked each agent its status, and read nothing from the platform: no presence, no run record, no ceilings and no spend" });
  const readsOf = async (h) => (p.root ? { card: await p.card(h), record: await p.record(h), agentdoc: await p.agentdoc(h) } : {});
  const [answers, reads, spend] = await Promise.all([
    askAll(wl.agents, { waitSeconds, bin, spawnImpl, now }),
    Promise.all(wl.agents.map(readsOf)),
    readSpendFor(p, wl.agents, { from: win.from, to: win.to }, RECORDS),
  ]);
  if (!spend.ok && p.root) note(RECORDS, { wanted: "the spend report", did: "reported every agent's money limits as not measured and the spend section as not read", why: spend.why });
  if (spend.ok && spend.scopes?.some((s) => s !== "credits:read")) {
    note(RECORDS, { wanted: "a read key that can only read", did: "read the spend with the key it was given", why: `the key placed also carries ${list(spend.scopes.filter((s) => s !== "credits:read"))}, which can do more than read` });
  }

  // 3. Check each agent.
  const agents = wl.agents.map((named, i) => {
    const r = reads[i] ?? {};
    const key = r.card?.ok ? r.card.body?.agent_id ?? null : null;
    const handle = r.card?.ok ? (r.card.body?.card?.card?.handle ?? named) : named;
    const entry = spend.ok ? spendEntryFor(spend, { handle, key }) : null;
    const why = spend.ok ? (spend.leftOut?.includes(named) ? `the platform did not report its spend (${spend.leftWhy?.get(named) ?? "no reason given"})` : "") : spend.why;
    return checkAgent({ named, card: r.card, record: r.record, agentdoc: r.agentdoc, asked: answers[i], spendAgent: entry, spendRead: spend.ok ? { url: spend.read_from, at: spend.at } : null, spendWhy: why, waitSeconds });
  });

  // 5. Raise the alarms: one file each, then to the incident recorder.
  //
  // An alert stays open from one watch to the next until a watch finds the
  // agent clear. The standing list ({records}/open-alerts.json) keeps, per
  // agent, what opened it and where it was raised, so a scheduled watch does
  // not raise the same failure as a new incident every time it runs: an
  // alert whose every reason was already raised is reported as still open,
  // and only a new reason raises it again.
  const standing = readStanding(args.records);
  const alarmsDir = join(RECORDS, "alarms");
  const alarms = [];
  for (const a of agents) {
    const was = standing[a.handle];
    if (!a.alert?.raise) {
      if (was && !a.alert) delete standing[a.handle];
      continue;
    }
    if (was && a.alert.keys.every((k) => was.keys.includes(k))) {
      a.alert.still_open = { since: was.opened_at, raised_to: was.raised_to ?? null, request_id: was.request_id ?? null, raised_at: was.raised_at ?? null };
      continue;
    }
    const al = alarmFor(a, { watcher: WATCHER });
    if (!al) continue;
    mkdirSync(alarmsDir, { recursive: true });
    const path = join(alarmsDir, al.file);
    writeFileSync(path, al.jsonl);
    alarms.push({ agent: al.agent, time: al.time, text: al.text, file: al.file, path, keys: a.alert.keys, since: was?.opened_at ?? a.alert.at });
  }
  const recorder = trim(env.INCIDENT_RECORDER);
  const raised = alarms.length ? await raiseAll(alarms, { recorder, bin, spawnImpl }) : [];
  if (alarms.length && !recorder) note(RECORDS, { wanted: "an incident recorder to raise alarms to (INCIDENT_RECORDER)", did: "handed each alarm back with the report instead" });
  for (const r of raised.filter((x) => recorder && !x.sent)) note(RECORDS, { wanted: `the alarm for ${r.agent} reaching ${recorder}`, did: "handed it back with the report", why: r.why });
  // Only an alarm that reached the recorder joins the standing list, so one
  // that did not is tried again by the next watch.
  for (const r of raised.filter((x) => x.sent)) {
    standing[r.agent] = { keys: [...new Set([...(standing[r.agent]?.keys ?? []), ...r.keys])], opened_at: r.since, raised_to: r.to, request_id: r.request_id ?? null, raised_at: watchedAt };
  }
  writeStanding(args.records, standing);
  writeFileSync(join(RECORDS, "raised.json"), JSON.stringify(raised.map(({ path, ...r }) => r), null, 2) + "\n");

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
  for (const h of spend.leftOut ?? []) notKnown.push(`What ${h} spent: the platform did not report it (${spend.leftWhy?.get(h) ?? "no reason given"}).`);

  // Every read, as a source.
  const sources = [];
  for (let i = 0; i < wl.agents.length; i++) {
    const r = reads[i] ?? {};
    for (const [what, x] of [["storefront", r.card], ["run record", r.record], ["AgentDoc", r.agentdoc]]) if (x) sources.push({ what: `${wl.agents[i]}, ${what}`, where: x.url, at: x.at, status: x.status });
    const q = answers[i];
    if (q) sources.push({ what: `${wl.agents[i]}, the worker interface's status`, where: "agentmesh messages send, as this agent", at: q.sent_at, status: q.outcome });
  }
  for (const r of spend.reads ?? []) sources.push({ what: r.url.includes("spend-report") ? "the spend report" : "the read key's account", where: r.url.replace(/\?.*$/, ""), at: r.at, status: r.status });

  const markdown = writeReport({ watchedAt, account: spend.account ?? null, agents, spend, raised, notKnown, sources });
  const reportPath = join(RECORDS, "watch-report.md");
  writeFileSync(reportPath, markdown);
  const record = {
    watch: "v1", watched_at: watchedAt, watched_by: WATCHER, account: spend.account ?? null,
    agents,
    spend: spend.ok ? { window: spend.window, generated_at: spend.generated_at, read_from: spend.read_from, every_spend_traced: spend.every_spend_traced, platform_reconciles: spend.platform_reconciles, reconciles: spend.reconciles, discrepancies: spend.discrepancies, totals: spend.totals, owners: spend.owners, agents: spend.agents, left_out: spend.leftOut } : { read: false, why: spend.why },
    alerts: alarms.map((al) => { const r = raised.find((x) => x.agent === al.agent) ?? {}; return { agent: al.agent, time: al.time, message: al.text, file: al.file, raised_to: r.to ?? null, sent: Boolean(r.sent), request_id: r.request_id ?? null, why: r.sent ? null : r.why ?? null }; }),
    not_known: notKnown,
    sources,
  };
  const recordPath = join(RECORDS, "watch-record.json");
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");

  // Hand it over.
  const listed = fill(args.job, plan({ reportPath, recordPath, alarms })).map((e) => e.name);
  const count = (pred) => agents.filter(pred).length;
  const open = agents.filter((a) => a.alert);
  const went = sentence(wentWithout(RECORDS));
  const spendLine = spend.ok
    ? `Between ${spend.window.from} and ${spend.window.to} they spent ${spend.totals.length ? spend.totals.map((t) => moneyWords(t.spent_micro, t.currency)).join(", ") : "nothing"}; ${spend.every_spend_traced ? "every spend traces to a job" : "not every spend traces to a job, and each part that does not is named with why"}, and the totals ${spend.reconciles ? "reconcile" : "do not reconcile"}.`
    : `The spend was not read: ${spend.why}.`;
  const sentAlarms = raised.filter((r) => r.sent);
  const reply = [
    went,
    `I watched ${many(agents.length, "agent")}: ${count((a) => a.alive.state === "yes")} alive, ${count((a) => a.answering.state === "yes")} answering, ${count((a) => a.limits.state === "inside")} inside every limit measured.`,
    open.length ? `${many(open.length, "alert is", "alerts are")} open: ${open.map((a) => `${a.handle} (${a.alert.reasons.join("; ")})`).join("; ")}.` : "No alert is open.",
    alarms.length ? (sentAlarms.length ? `${many(sentAlarms.length, "alarm was", "alarms were")} raised to ${recorder}.` : "The alarms were not raised to an incident recorder; each is handed back with the report.") : "",
    spendLine,
    "The report says where every line was read.",
  ].filter(Boolean).join(" ");
  return { ok: true, code: 0, reply, agents: agents.length, open_alerts: open.length, raised: sentAlarms.length, reconciles: spend.ok ? spend.reconciles : null, went_without: wentWithout(RECORDS), listed };
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
