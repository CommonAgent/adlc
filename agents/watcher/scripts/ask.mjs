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
import { jsonOf, runAgentmesh } from "./send.mjs";

export const STATUS_TEXT = "agentmesh-worker/v1\nstatus";
export const IFACE = "interface-worker";

const trim = (s) => String(s ?? "").trim();

/** What `agentmesh messages send <to> <text> --wait <s> --json` printed, read
 *  as one answer. Through the node running here (the fleet host's case) it
 *  prints one JSON object: {reply, from, handle, in_reply_to} when the answer
 *  came; {queued: true, no_reply_within} when it did not; {ok: false,
 *  delivered: false, code, error} when the door refused; or {reply, payload}
 *  when the door answered at once, a hold among them ({payload: {held}}).
 *  With no node here the command sends on its own connection and prints words,
 *  not JSON: "─ reply ─" and the answer, or "(no reply within …)". Each is
 *  read; `path` says which way it went. */
export function readSendOutput({ status = 0, stdout = "", stderr = "" } = {}) {
  const out = trim(stdout);
  // The words first: on that path the answer itself may be a JSON line, and
  // read as the send's own output it would be taken for a receipt.
  const at = out.indexOf("─ reply ─");
  if (at >= 0) return { outcome: "answered", reply: trim(out.slice(at + "─ reply ─".length)), request_id: null, path: "direct" };
  const j = jsonOf(out);
  if (!j) {
    const quiet = /\(no reply within (\d+)s/.exec(out);
    if (quiet) return { outcome: "silent", request_id: null, why: `no answer within ${quiet[1]}s`, path: "direct" };
    const why = trim(stderr) || out || `the send printed nothing (exit ${status})`;
    return { outcome: "not-sent", why: why.slice(0, 400), path: "direct" }; // cut-ok: the reason's words, the whole is in the log
  }
  const p = j.payload && typeof j.payload === "object" ? j.payload : null;
  if (j.status === "held" || p?.held) return { outcome: "held", why: trim(j.note ?? p?.text) || "held at its door for its owner" };
  if (j.ok === false || p?.ok === false || (j.delivered === false && !j.queued && j.status !== "queued_offline")) {
    return { outcome: "refused", why: trim(j.error ?? p?.error ?? j.note ?? j.code ?? p?.code) || "refused at its door", code: j.code ?? p?.code ?? null };
  }
  if (j.queued || p?.queued || ["delivered", "sent", "accepted", "queued_offline"].includes(j.status)) {
    return { outcome: "silent", request_id: j.request_id ?? p?.request_id ?? j.inbox_id ?? null, why: j.no_reply_within ? `no answer within ${j.no_reply_within}s` : trim(j.note) || "no answer" };
  }
  // An answer: the waited-for reply (it names what it replies to), the door's
  // immediate answer, or the running inbox's receipt.
  if (j.in_reply_to !== undefined && j.reply !== undefined && j.reply !== null) return { outcome: "answered", reply: j.reply, request_id: j.in_reply_to };
  if (j.status === "answered" && j.reply !== undefined && j.reply !== null) return { outcome: "answered", reply: j.reply, request_id: j.request_id ?? null };
  if (j.reply !== undefined && j.reply !== null) return { outcome: "answered", reply: j.reply, request_id: null };
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

/** Ask every agent at once, so a watch of many takes one wait, not many.
 *  Through a node running here the sends share its one connection. With no
 *  node, each send opens its own connection as this agent, and several at
 *  once would register it several times and race each other for the
 *  replies; so the first is sent alone, and when it went that way the rest
 *  go one at a time. */
export async function askAll(handles, opts = {}) {
  if (!handles.length) return [];
  const first = await askOne(handles[0], opts);
  const rest = handles.slice(1);
  if (first.path === "direct") {
    const out = [first];
    for (const h of rest) out.push(await askOne(h, opts));
    return out;
  }
  return [first, ...(await Promise.all(rest.map((h) => askOne(h, opts))))];
}
