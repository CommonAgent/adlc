// Ask each agent one real, light question, and time its answer.
//
// A process being up says almost nothing: an agent whose inbox is served and
// whose model is refusing every call looks healthy from the outside. So
// liveness here is an answer to a request sent to the agent, through the same
// door its work comes through: the worker interface's `status` exchange
// (agentroles.ai, The worker), two lines,
//
//   agentmesh-worker/v1
//   status
//
// sent as this agent with `agentmesh messages send <handle> <text> --wait <s>
// --json`. An AgentMesh fleet host answers it from the agent's own state with
// no model woken: what its last job was and how it ended, or what it is
// working on now. The answer comes back only if the message got through the
// agent's door, reached its inbox, and the loop that runs its work picked it
// up and replied, which is what a process being up does not show. It costs
// nothing and starts no job.
//
// Any answer counts as answering. One that is not the worker interface's
// (an agent that does not implement it, answering in its own words) is
// reported as answered, with what it said, and the report says it did not
// answer as the worker interface. No answer within the wait is silence, and
// silence is a failure: it is never read as no news.
//
//   needs: node >= 22, and the agentmesh command on the path (AGENTMESH_BIN
//          names another)
//   import { askAll, readAnswer, STATUS_TEXT } from "./ask.mjs"
import { runAgentmesh } from "./send.mjs";

export const STATUS_TEXT = "agentmesh-worker/v1\nstatus";
export const IFACE = "interface-worker";

const trim = (s) => String(s ?? "").trim();

/** What `agentmesh messages send --wait --json` printed, read as one answer.
 *  It prints, on the terminal's own send, a JSON line after any lines of its
 *  own: {reply, from, handle, in_reply_to} when the answer came,
 *  {queued: true, no_reply_within} when it did not, or {ok: false, code,
 *  error} when the door refused; through the running inbox it is the
 *  receipt, {status, delivered, request_id, note, reply}. */
export function readSendOutput({ status = 0, stdout = "", stderr = "" } = {}) {
  const out = trim(stdout);
  let j = null;
  if (out.startsWith("{")) { try { j = JSON.parse(out); } catch { j = null; } }
  if (!j) {
    const line = out.split("\n").reverse().find((l) => l.trim().startsWith("{"));
    if (line) { try { j = JSON.parse(line); } catch { j = null; } }
  }
  if (!j) {
    const why = trim(stderr) || out || `the send printed nothing (exit ${status})`;
    return { outcome: "not-sent", why: why.slice(0, 400) }; // cut-ok: the reason's words, the whole is in the log
  }
  if (j.reply !== undefined && j.reply !== null && !j.queued) return { outcome: "answered", reply: j.reply, request_id: j.in_reply_to ?? j.request_id ?? null };
  if (j.status === "answered") return { outcome: "answered", reply: j.reply, request_id: j.request_id ?? null };
  if (j.queued || ["delivered", "sent", "accepted", "queued_offline"].includes(j.status)) {
    return { outcome: "silent", request_id: j.request_id ?? j.inbox_id ?? null, why: j.no_reply_within ? `no answer within ${j.no_reply_within}s` : trim(j.note) || "no answer" };
  }
  if (j.status === "held") return { outcome: "held", why: trim(j.note) || "held at its door for its owner" };
  if (j.ok === false || j.delivered === false) return { outcome: "refused", why: trim(j.error ?? j.note ?? j.code) || "refused at its door", code: j.code ?? null };
  return { outcome: "not-sent", why: `the send's answer could not be read: ${JSON.stringify(j).slice(0, 200)}` }; // cut-ok: a reason, the whole is in the log
}

/** The answer's words, read as the worker interface's status when it is one. */
export function readAnswer(reply) {
  let j = reply;
  if (typeof reply === "string") { try { j = JSON.parse(reply); } catch { j = null; } }
  if (j && typeof j === "object" && j.interface === IFACE && j.exchange === "status") {
    return { worker: true, job: trim(j.job) || null, state: trim(j.state) || null, detail: trim(j.detail) || null };
  }
  const text = typeof reply === "string" ? reply : JSON.stringify(reply);
  return { worker: false, words: trim(text).slice(0, 300) }; // cut-ok: quoted in the report; the whole answer is in the watch record
}

/** Send one status question and wait for its answer. Resolves; never throws. */
export async function askOne(handle, { waitSeconds = 60, bin, spawnImpl, now = () => new Date() } = {}) {
  const sentAt = now().toISOString();
  const t0 = Date.now();
  const r = await runAgentmesh(["messages", "send", handle, STATUS_TEXT, "--wait", String(waitSeconds), "--json"], { timeoutSeconds: waitSeconds + 30, bin, spawnImpl });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const at = now().toISOString();
  if (r.error) return { handle, sent_at: sentAt, gave_up_at: at, outcome: "not-sent", why: r.error };
  if (r.killed) return { handle, sent_at: sentAt, gave_up_at: at, outcome: "not-sent", why: `the send did not return within ${waitSeconds + 30}s and was stopped` };
  const read = readSendOutput(r);
  return { handle, sent_at: sentAt, ...(read.outcome === "answered" ? { answered_at: at, seconds } : { gave_up_at: at }), ...read };
}

/** Ask every agent at once, so a watch of many takes one wait, not many. */
export async function askAll(handles, opts = {}) {
  return Promise.all(handles.map((h) => askOne(h, opts)));
}
