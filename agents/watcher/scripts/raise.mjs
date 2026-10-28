// Hand each open alert to the incident recorder, in the shape it takes.
//
// The incident recorder is named by the install (INCIDENT_RECORDER, a handle),
// never by a message, so a message cannot make the watcher write to anyone
// else. Each alarm is one message to it: the two lines it reads, `agent:` and
// `time:`, and the alarm's file attached (alarms.mjs). It records the
// incident as its own job and answers the watcher later; that answer is not
// waited for, because the alert is open from the moment it is raised and
// recording it is the recorder's work, not the watcher's.
//
// With no recorder named, nothing is sent: the alarms are handed back with
// the report, and the reply says they were not sent and why.
//
//   needs: node >= 22, and the agentmesh command on the path
//   import { raiseAll, readRaise } from "./raise.mjs"
import { runAgentmesh } from "./send.mjs";

const trim = (s) => String(s ?? "").trim();

/** What `agentmesh messages send --files … --json` printed, read as a
 *  delivery: { sent, request_id, why }. */
export function readRaise({ status = 0, stdout = "", stderr = "", killed = false, error = null } = {}) {
  if (error) return { sent: false, why: error };
  if (killed) return { sent: false, why: "the send did not return in time and was stopped" };
  const out = trim(stdout);
  let j = null;
  if (out.startsWith("{")) { try { j = JSON.parse(out); } catch { j = null; } }
  if (!j) {
    const line = out.split("\n").reverse().find((l) => l.trim().startsWith("{"));
    if (line) { try { j = JSON.parse(line); } catch { j = null; } }
  }
  if (!j) return { sent: false, why: (trim(stderr) || out || `the send printed nothing (exit ${status})`).slice(0, 400) }; // cut-ok: a reason; the whole is in the log
  if (j.status === "held") return { sent: false, held: true, request_id: j.request_id ?? null, why: trim(j.note) || "held at its door for its owner" };
  if (j.ok === false || (j.delivered === false && !j.queued && j.status !== "queued_offline")) {
    return { sent: false, why: trim(j.error ?? j.note ?? j.code) || "refused at its door" };
  }
  return { sent: true, request_id: j.request_id ?? j.in_reply_to ?? j.inbox_id ?? null, status: j.status ?? (j.queued ? "queued" : "sent") };
}

/** Send every alarm. Each is { agent, text, path }; resolves to each with
 *  what became of it. */
export async function raiseAll(alarms, { recorder = "", bin, spawnImpl } = {}) {
  const to = trim(recorder);
  if (!to) return alarms.map((a) => ({ ...a, sent: false, why: "the install names no incident recorder (INCIDENT_RECORDER)" }));
  const out = [];
  for (const a of alarms) {
    if (a.path.includes(",")) { out.push({ ...a, sent: false, why: `the alarm's path has a comma in it, which agentmesh messages send cannot take` }); continue; }
    const r = await runAgentmesh(["messages", "send", to, a.text, "--files", a.path, "--json"], { timeoutSeconds: 60, bin, spawnImpl });
    out.push({ ...a, to, ...readRaise(r) });
  }
  return out;
}
