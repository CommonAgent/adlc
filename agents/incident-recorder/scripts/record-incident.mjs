// Record incident: one command, three steps, no model.
//   needs: node >= 22
//   node record-incident.mjs --job <job folder> --records <records folder>
//        --work <work folder> --text-file <message> [--file <path>[::<media type>]]...
//        [--agent <handle>] [--time <ISO time>]
//
// This is the command the runtime requirements start (run.record-incident).
// The message says which agent and when, as lines of their own:
//
//   agent: <handle>
//   time: <ISO time with a zone, such as 2026-10-24T09:30:00Z>
//   records: <folder>          (optional)
//
// --agent and --time, when given, win over the message. The records read are
// the files attached to the message and the regular files directly inside the
// folder a `records:` line names. A named folder is read only when it lies
// inside one of the folders the host lists in INCIDENT_RECORDS_ROOTS (joined
// by the platform's path delimiter); with none listed, a named folder is not
// read and the reply says so, because a message must not be able to make this
// agent read any folder on the host. They are copied by their bytes into the
// job's work folder and read from there, so nothing outside them is read.
//
// It never contacts the agent, reaches no network, wakes no model and never
// names a cause: it says what the records say and where they say nothing.
//
// It prints one JSON object with a `reply` field. Exit codes: 0 recorded (an
// empty record is still a record); 2 usage; 3 the job stops and the reply
// says what is needed, which the harness sends as it stands; 1 failed.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRecords } from "./read-records.mjs";
import { buildTimeline } from "./build-timeline.mjs";
import { formatIncidentRecord, updateStandingIndex } from "./write-incident.mjs";
import { note, read as wentWithout } from "./went-without.mjs";
import { fill, plan as piecesPlan } from "./pieces.mjs";

export const EMPTY_REPLY = "notes the complete absence of records and delivers the empty timeline without guessing what occurred";

const trim = (s) => String(s ?? "").trim();
const many = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function fromArgv(args = []) {
  const parsed = { files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--job") parsed.job = args[++i];
    else if (a === "--records") parsed.records = args[++i];
    else if (a === "--work") parsed.work = args[++i];
    else if (a === "--text-file") parsed.textFile = args[++i];
    else if (a === "--agent") parsed.agent = args[++i];
    else if (a === "--time") parsed.time = args[++i];
    else if (a === "--file") {
      const v = String(args[++i] ?? "");
      const at = v.lastIndexOf("::");
      parsed.files.push(at === -1 ? { path: v, declared: "" } : { path: v.slice(0, at), declared: v.slice(at + 2) });
    }
  }
  return parsed;
}

/** A value as a person might write it: without the quotes, backticks or angle
 *  brackets around it, and without a full stop at the end of the line. */
const bare = (v) => trim(v).replace(/\.$/, "").replace(/^[`'"<]+|[`'">]+$/g, "");

const LINES = {
  agent: /^\s*(?:[-*]\s*)?(?:agent(?:\s+handle)?|handle)\s*[:=]\s*(.+?)\s*$/im,
  time: /^\s*(?:[-*]\s*)?(?:(?:failure\s+)?time|failed\s+at|when)\s*[:=]\s*(.+?)\s*$/im,
  records: /^\s*(?:[-*]\s*)?records(?:\s+folder)?\s*[:=]\s*(.+?)\s*$/im,
};

/** The agent, the failure time and the records folder, from the message.
 *  Only lines of the form `name: value` count: a handle or a time mentioned in
 *  passing is not taken, because a record built on a guessed agent is a record
 *  about the wrong agent. */
export function fromText(text = "") {
  const t = String(text ?? "");
  const got = (re) => { const m = re.exec(t); return m ? trim(m[1]) : ""; };
  const first = (v) => bare(v.split(/\s+/)[0] ?? "");
  return { agent: first(got(LINES.agent)), time: bare(got(LINES.time)), recordsDir: bare(got(LINES.records)) };
}

/** An ISO 8601 time with a date, hours and minutes and an explicit zone. A
 *  time without a zone is not read in the host's, since that would be a guess
 *  about which minute the failure was. */
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
export function isIsoTime(s) {
  const t = trim(s);
  if (!ISO_TIME.test(t)) return false;
  const [y, m, d] = t.slice(0, 10).split("-").map(Number);
  // Date rolls 2026-02-30 over to 2 March; a day that does not exist is not a time.
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) return false;
  return Number.isFinite(new Date(t).getTime());
}

export const HOW_TO_ASK =
  "Send them as lines of their own, like this:\n\nagent: name.owner@example.com\ntime: 2026-10-24T09:30:00Z\n\nand attach the platform's activity records and the agent's own records (one JSON object per line, each with a time and an event), or name a folder of them with a line `records: <folder>`.";

/** What is missing, in words, or "" when nothing is. */
export function whatIsMissing({ agent, time }) {
  if (!agent && !time) return `To record an incident I need the handle of the agent that failed and the time it failed, and this message gave me neither. ${HOW_TO_ASK}`;
  if (!agent) return `To record an incident I need the handle of the agent that failed, and this message gave me only the time (${time}). ${HOW_TO_ASK}`;
  if (!time) return `To record an incident I need the time ${agent} failed, and this message did not give one. ${HOW_TO_ASK}`;
  if (!isIsoTime(time)) return `"${time}" is not a time I can place without guessing. I need an ISO 8601 time with its zone, such as 2026-10-24T09:30:00Z, so the window I read is the right one. ${HOW_TO_ASK}`;
  return "";
}

export async function recordIncident({
  jobDir,
  recordsDir,
  workDir,
  agent,
  failureTime,
  recordsPath,
  standingDir,
  incidentId,
  probe,
  fetchImpl,
  remoteUrl
}) {
  if (probe) {
    return { refused: "never sends a ping, signal, or message to the target agent" };
  }
  if (fetchImpl) {
    return { refused: "accesses no remote APIs or network endpoints" };
  }

  const { unreadable, files, events } = await readRecords({
    recordsDir: recordsPath,
    agent,
    failureTime,
    wentWithoutDir: recordsDir
  });

  const tStart = new Date(failureTime).getTime() - 60000;
  const tEnd = new Date(failureTime).getTime() + 60000;

  const timeline = buildTimeline({
    events,
    windowStart: new Date(tStart).toISOString(),
    windowEnd: new Date(tEnd).toISOString(),
    expectedCadenceMs: 60000
  });

  const inventory = { files, unreadable };
  writeFileSync(join(recordsDir, "inventory.json"), JSON.stringify(inventory, null, 2));

  if (events.length === 0) {
    const emptyIncident = {
      agent,
      failureTime,
      summary: "complete absence of records",
      facts: [],
      gaps: timeline.gaps
    };
    writeFileSync(join(recordsDir, "incident.json"), JSON.stringify(emptyIncident, null, 2));
    writeFileSync(join(recordsDir, "timeline.json"), JSON.stringify(timeline, null, 2));
    const indexError = standingDir ? index({ standingDir, incidentId, agent, failureTime }) : "";
    return { code: 3, reply: EMPTY_REPLY, empty: true, files, unreadable, timeline, indexError };
  }

  const incident = formatIncidentRecord({ agent, failureTime, timeline, inventory });
  writeFileSync(join(recordsDir, "incident.json"), JSON.stringify(incident, null, 2));
  writeFileSync(join(recordsDir, "timeline.json"), JSON.stringify(timeline, null, 2));

  const indexError = standingDir ? index({ standingDir, incidentId, agent, failureTime }) : "";

  return { code: 0, empty: false, files, unreadable, timeline, indexError };
}

/** Add the incident to the standing index. A failure here is returned in
 *  words, never thrown: the job's own record is already written and is still
 *  delivered. */
function index({ standingDir, incidentId, agent, failureTime }) {
  try {
    updateStandingIndex(join(standingDir, "incidents.json"), {
      incidentId: incidentId || "inc-" + Date.now(),
      agent,
      failureTime,
      recordedAt: new Date().toISOString()
    });
    return "";
  } catch (e) {
    return trim(e?.message ?? e);
  }
}

/** The folders a `records:` line may name, as the host lists them. */
export function allowedRoots(env = process.env) {
  return trim(env.INCIDENT_RECORDS_ROOTS).split(delimiter).map(trim).filter(Boolean);
}

/** Is the folder inside one of the roots, once links are resolved. */
export function insideRoots(folder, roots) {
  let real;
  try { real = realpathSync(folder); } catch { return false; }
  return roots.some((r) => {
    let root;
    try { root = realpathSync(r); } catch { return false; }
    const rel = relative(root, real);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

/** Lay the records this job was given out in one folder, by their bytes, so
 *  readRecords reads exactly them. Returns what was laid out and what was
 *  asked for and could not be read. A file that cannot be read is noted, never
 *  fatal. The folder is emptied first, so a job run again reads only what it
 *  was given this time. */
export function gatherRecords({ files = [], recordsDir = "", into, roots = [] }) {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const laid = [];
  const missing = [];
  const taken = new Set();
  const place = (from, wanted) => {
    let bytes;
    try { bytes = readFileSync(from); }
    catch (e) { missing.push({ wanted, why: `it could not be read (${e.code ?? trim(e.message)})` }); return; }
    let name = basename(from);
    // Case-blind, because two names that differ only in case are one file on
    // some file systems.
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${n}-${basename(from)}`;
    taken.add(name.toLowerCase());
    writeFileSync(join(into, name), bytes);
    laid.push({ name, from });
  };
  for (const f of files) {
    let isFile = false;
    try { isFile = Boolean(f.path) && statSync(f.path).isFile(); } catch { /* not there */ }
    if (isFile) place(f.path, f.path);
    else missing.push({ wanted: f.path || "an attached file", why: "it was not there when the job ran" });
  }
  if (recordsDir) {
    let isDir = false;
    try { isDir = statSync(recordsDir).isDirectory(); } catch { /* not there */ }
    if (!isDir) {
      missing.push({ wanted: `the records folder ${recordsDir}`, why: "there is no folder at that path on this host" });
    } else if (!roots.length) {
      missing.push({ wanted: `the records folder ${recordsDir}`, why: "this host lists no folders a message may name (INCIDENT_RECORDS_ROOTS), so a named folder is not read; attach the records instead" });
    } else if (!insideRoots(recordsDir, roots)) {
      missing.push({ wanted: `the records folder ${recordsDir}`, why: "it is not inside a folder this host lets a message name (INCIDENT_RECORDS_ROOTS)" });
    } else {
      for (const entry of readdirSync(recordsDir).sort()) {
        const p = join(recordsDir, entry);
        let st;
        try { st = lstatSync(p); } catch { continue; }
        // Regular files only: a link could point anywhere on the host.
        if (st.isFile()) place(p, p);
      }
    }
  }
  return { laid, missing };
}

/** The reply, in words. It says what the records say and where they are
 *  silent, and it never names a cause. */
export function replyText({ agent, time, result, laid = [], missing = [] }) {
  const lines = [];
  const facts = result.timeline.events.length;
  const gaps = result.timeline.gaps;
  if (result.empty) {
    lines.push(laid.length
      ? `None of the ${many(laid.length, "record file")} I was given holds a readable entry for ${agent} around ${time}, so the incident record notes the complete absence of records and the timeline has no events, only the gap that covers the whole window. Nothing was guessed about what happened.`
      : `No records came with this job, so the incident record for ${agent} at ${time} notes the complete absence of records and the timeline has no events, only the gap that covers the whole window. Nothing was guessed about what happened. To have the records read, attach them, or name a folder of them with a line \`records: <folder>\`, and ask again.`);
  } else {
    lines.push(`I recorded the incident for ${agent} at ${time}: ${many(facts, "fact")} from ${many(laid.length, "record file")}, each with the file it came from, that file's digest and the byte offset of the line.`);
    lines.push(gaps.length
      ? `There ${gaps.length === 1 ? "is 1 gap" : `are ${gaps.length} gaps`} where the records say nothing (${gaps.map((g) => `${g.from} to ${g.to}`).join("; ")}), marked unknown rather than filled in.`
      : "The records leave no gap longer than a minute in the window around the failure.");
  }
  for (const u of result.unreadable ?? []) {
    lines.push(u.untimed
      ? `The line of ${u.file} at byte ${u.byteOffset} has no time with a zone, so it is not in the record: a fact that cannot be placed is not a fact in a timeline.`
      : `${u.file} could not be read from byte ${u.byteOffset} on, so nothing after that point in it is in the record. Send a fresh extract of it if you want it read.`);
  }
  if (result.indexError) lines.push(`The incident could not be added to the standing index of incidents (${result.indexError}); this job's own record is complete.`);
  for (const m of missing) lines.push(`I went without ${m.wanted}, because ${m.why}.`);
  lines.push("The incident record and the timeline are filed with the job. They name no cause and no fix.");
  return lines.join(" ");
}

/** The job, as the runtime requirements start it. */
export async function runJob(argv = [], env = process.env) {
  const args = fromArgv(argv);
  if (!args.job || !args.records) {
    return { ok: false, code: 2, reply: "This job needs --job <job folder> and --records <records folder>." };
  }
  const text = args.textFile && existsSync(args.textFile) ? readFileSync(args.textFile, "utf8") : "";
  const said = fromText(text);
  const agent = trim(args.agent) || said.agent;
  const time = trim(args.time) || said.time;
  const missingInput = whatIsMissing({ agent, time });
  if (missingInput) return { ok: false, code: 3, reply: missingInput };

  const id = basename(args.job);
  const RECORDS = join(args.records, id);
  mkdirSync(RECORDS, { recursive: true });
  // A job run again starts its notes again.
  rmSync(join(RECORDS, "went-without.json"), { force: true });
  // The records are laid out in the job's work folder; with no --work, beside
  // the job's own records, never in a folder another job shares.
  const WORK = args.work ? join(args.work, id) : RECORDS;
  const given = join(WORK, "records-given");
  const { laid, missing } = gatherRecords({ files: args.files, recordsDir: said.recordsDir, into: given, roots: allowedRoots(env) });
  for (const m of missing) note(RECORDS, { wanted: m.wanted, did: "recorded the incident from the records that were there", why: m.why });

  const failureTime = new Date(time).toISOString();
  const result = await recordIncident({
    jobDir: args.job, recordsDir: RECORDS, workDir: WORK, agent, failureTime,
    recordsPath: given, standingDir: args.records, incidentId: id,
  });

  const incidentPath = join(RECORDS, "incident.json");
  const timelinePath = join(RECORDS, "timeline.json");
  const listed = fill(args.job, piecesPlan({ incidentPath, timelinePath })).map((e) => e.name);

  return {
    ok: true,
    code: 0,
    reply: replyText({ agent, time: failureTime, result, laid, missing }),
    agent,
    failure_time: failureTime,
    facts: result.timeline.events.length,
    gaps: result.timeline.gaps.length,
    records_read: laid.map((l) => l.name),
    unreadable: result.unreadable ?? [],
    went_without: wentWithout(RECORDS),
    listed,
  };
}

const startedAsCommand = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (startedAsCommand()) {
  const out = await runJob(process.argv.slice(2)).catch((e) => ({
    ok: false, code: 1, reply: `No incident was recorded, and this is what stopped it: ${trim(e?.message ?? e)}`,
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.code ?? 0;
}
