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
// folder a `records:` line names. They are copied by their bytes into the
// job's work folder and read from there, so nothing is read twice and nothing
// outside them is read at all.
//
// It never contacts the agent, reaches no network, wakes no model and never
// names a cause: it says what the records say and where they say nothing.
//
// It prints one JSON object with a `reply` field. Exit codes: 0 recorded (an
// empty record is still a record); 2 usage; 3 the job stops and the reply
// says what is needed, which the harness sends as it stands; 1 failed.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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
const bare = (v) => trim(v).replace(/^[`'"<]+|[`'">]+$/g, "").replace(/\.$/, "");

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
  const got = (re) => { const m = re.exec(t); return m ? bare(m[1]) : ""; };
  const agent = got(LINES.agent).split(/\s+/)[0] ?? "";
  return { agent, time: got(LINES.time), recordsDir: got(LINES.records) };
}

/** An ISO 8601 time with a date, hours and minutes and an explicit zone. A
 *  time without a zone is not read in the host's, since that would be a guess
 *  about which minute the failure was. */
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
export function isIsoTime(s) {
  return ISO_TIME.test(trim(s)) && Number.isFinite(new Date(trim(s)).getTime());
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
    return { code: 3, reply: EMPTY_REPLY, empty: true, files, unreadable, timeline };
  }

  const incident = formatIncidentRecord({ agent, failureTime, timeline, inventory });
  writeFileSync(join(recordsDir, "incident.json"), JSON.stringify(incident, null, 2));
  writeFileSync(join(recordsDir, "timeline.json"), JSON.stringify(timeline, null, 2));

  if (standingDir) {
    updateStandingIndex(join(standingDir, "incidents.json"), {
      incidentId: incidentId || "inc-" + Date.now(),
      agent,
      failureTime,
      recordedAt: new Date().toISOString()
    });
  }

  return { code: 0, empty: false, files, unreadable, timeline };
}

/** Lay the records this job was given out in one folder, by their bytes, so
 *  readRecords reads exactly them. Returns what was laid out and what was
 *  asked for and not there. */
export function gatherRecords({ files = [], recordsDir = "", into }) {
  mkdirSync(into, { recursive: true });
  const laid = [];
  const missing = [];
  const taken = new Set();
  const place = (from) => {
    let name = basename(from);
    for (let n = 2; taken.has(name); n++) name = `${n}-${basename(from)}`;
    taken.add(name);
    writeFileSync(join(into, name), readFileSync(from));
    laid.push({ name, from });
  };
  for (const f of files) {
    if (f.path && existsSync(f.path) && statSync(f.path).isFile()) place(f.path);
    else missing.push({ wanted: f.path || "an attached file", why: "it was not there when the job ran" });
  }
  if (recordsDir) {
    if (existsSync(recordsDir) && statSync(recordsDir).isDirectory()) {
      for (const entry of readdirSync(recordsDir).sort()) {
        const p = join(recordsDir, entry);
        if (statSync(p).isFile()) place(p);
      }
    } else {
      missing.push({ wanted: `the records folder ${recordsDir}`, why: "there is no folder at that path on this host" });
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
    lines.push(`${u.file} could not be read from byte ${u.byteOffset} on, so nothing after that point in it is in the record. Send a fresh extract of it if you want it read.`);
  }
  for (const m of missing) lines.push(`I went without ${m.wanted}, because ${m.why}.`);
  lines.push("The incident record and the timeline are filed with the job. They name no cause and no fix.");
  return lines.join(" ");
}

/** The job, as the runtime requirements start it. */
export async function runJob(argv = []) {
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
  // The records are laid out in the job's work folder; with no --work, beside
  // the job's own records, never in a folder another job shares.
  const WORK = args.work ? join(args.work, id) : RECORDS;
  const given = join(WORK, "records-given");
  const { laid, missing } = gatherRecords({ files: args.files, recordsDir: said.recordsDir, into: given });
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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const out = await runJob(process.argv.slice(2)).catch((e) => ({
    ok: false, code: 1, reply: `No incident was recorded, and this is what stopped it: ${trim(e?.message ?? e)}`,
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.code ?? 0;
}
