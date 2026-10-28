// Ask each agent one real, light question, and read its answer.
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
// left for this agent's host to send under the agent's own key (outbox.mjs).
// An AgentMesh fleet host answers it from the agent's own state with no model
// woken: what its last job was and how it ended, or what it is working on now.
// The answer comes back only if the message got through the agent's door,
// reached its inbox, and the loop that runs its work picked it up and replied,
// which is what a process being up does not show. It costs nothing and starts
// no job. The answer arrives as a message of its own (rounds.mjs keeps it).
//
// Any answer counts as answering. One that is not the worker interface's (an
// agent that does not implement it, answering in its own words) is reported
// in its own words, and the report says it did not answer as the worker
// interface. No answer within the wait is silence, and silence is a failure.
//
//   needs: node >= 22
//   import { STATUS_TEXT, readAnswer, askAll } from "./ask.mjs"
import { leave } from "./outbox.mjs";

export const STATUS_TEXT = "agentmesh-worker/v1\nstatus";
export const IFACE = "interface-worker";

const trim = (s) => String(s ?? "").trim();

/** The answer's words, read as the worker interface's status when it is one. */
export function readAnswer(reply) {
  let j = reply;
  if (typeof reply === "string") { try { j = JSON.parse(reply); } catch { j = null; } }
  if (j && typeof j === "object" && j.interface === IFACE && j.exchange === "status") {
    return { worker: true, job: trim(j.job) || null, state: trim(j.state) || null, detail: trim(j.detail) || null };
  }
  const text = typeof reply === "string" ? reply : JSON.stringify(reply);
  return { worker: false, words: trim(text).slice(0, 300) }; // cut-ok: quoted in the report; the whole answer is kept in the round
}

/** Leave the status question for each agent that has an agent id, all in
 *  one thread so their answers are worked on one at a time. Returns, per
 *  agent, { outcome: "asked", sent_at, ref } or { outcome: "not-sent", why }. */
export function askAll(agents, { dir, thread, at }) {
  return agents.map((a) => {
    if (!a.key) return { outcome: "not-sent", sent_at: at, why: a.no_key_why || "its agent id could not be read, so there was nobody to address" };
    const r = leave(dir, { to: a.key, handle: a.handle, text: STATUS_TEXT, thread });
    return r.left ? { outcome: "asked", sent_at: at, ref: r.ref } : { outcome: "not-sent", sent_at: at, why: r.error };
  });
}
