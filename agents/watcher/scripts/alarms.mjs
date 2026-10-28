// An open alert, in the shape the incident recorder takes.
//
// The incident recorder (agents/incident-recorder) records one agent per job.
// Its message names the agent and the time as lines of their own,
//
//   agent: <handle>
//   time: <ISO time with its zone>
//
// and the records it reads are attached files, one JSON object per line with
// a `time` (ISO 8601 with its zone) and an `event`, and optionally `agent`. A
// file whose name contains `platform` is read as the platform's activity
// record. It reads only the lines between fifteen minutes before the time and
// five minutes after it, and only those about the agent named.
//
// So an alarm is that message and that one file: what the watcher saw, each
// line naming where it was seen, at the time it was seen. The time of the
// alarm is the moment the watcher saw the failure (the probe's deadline, or
// the read that showed a limit crossed), so what it saw falls inside the
// recorder's window. Older facts the watcher read (the last time the platform
// saw the agent, an earlier crossing) are lines too, with their own times; the
// recorder leaves out what falls outside its window and says how many.
//
// The process this feeds (Agent Processes, "record an incident") hands the
// notice to a person who gathers the records; the watcher's file is the first
// of them and says only what the watcher saw. Nothing here guesses a cause.
//
//   needs: node >= 22
//   import { alarmFor, alarmFileName } from "./alarms.mjs"

const safe = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";

/** The attached file's name: it carries `platform`, so the recorder reads it
 *  as the platform's activity record, and the agent's name, so a person can
 *  tell several apart. */
export function alarmFileName(handle) {
  return `watch-platform-${safe(handle)}.jsonl`;
}

/** The message and the record lines for one agent's open alert.
 *  `agent` is a checked agent from checks.mjs; `seenAt` is the alarm's time. */
export function alarmFor(agent, { watcher }) {
  const handle = agent.handle || agent.named;
  const at = agent.alert?.at;
  if (!handle || !at) return null;
  const lines = [];
  const line = (time, event, source) => { if (time) lines.push({ time, agent: handle, event, source, seen_by: watcher }); };
  for (const o of agent.observations ?? []) line(o.time, o.event, o.source);
  line(at, `the watcher opened an alert: ${agent.alert.reasons.join("; ")}`, watcher);
  lines.sort((a, b) => a.time.localeCompare(b.time));
  const text = [
    `agent: ${handle}`,
    `time: ${at}`,
    "",
    `The watcher opened an alert for ${handle} at ${at}: ${agent.alert.reasons.join("; ")}.`,
    `What it saw is attached as ${alarmFileName(handle)}, one line per thing seen, each naming where it was seen.`,
  ].join("\n");
  return { agent: handle, time: at, text, file: alarmFileName(handle), jsonl: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" };
}
