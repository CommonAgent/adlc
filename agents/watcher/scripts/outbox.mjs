// The one way this agent says anything on the mesh: it leaves the message for
// its host to send.
//
// An agent's work runs where it holds no signing key (on an AgentMesh fleet,
// a container for one job), so it cannot put the agent's name on an envelope.
// It writes each message it wants sent as one line of out/outbox.jsonl in its
// job folder, and the host sends them through the agent's own adapter, under
// its key, when the job ends. The host writes the id each went out under in
// out/outbox.sent.jsonl beside it, matched by `ref`.
//
// A line is { to, handle, text, files?, ref, thread? }: `to` is the agent id
// (the host's door takes an id, not a handle), `handle` names it in the
// host's log, and `thread` keeps the replies to one round in turn, so two of
// them are never worked on at once.
//
// Used twice: to ask each watched agent the worker interface's status, and to
// raise each alarm to the incident recorder with its file, or to hand a
// finished report to whoever asked for the watch.
//
//   needs: node >= 22
//   import { outboxDir, startOutbox, leave } from "./outbox.mjs"
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** An agent id as the mesh spells one (Agent Messaging 18.1). */
export const AGENT_ID = /^U[A-Z2-7]{55}$/;

/** Where the host reads the outbox: MESH_JOB_OUT when it names one, else the
 *  job folder's out/. */
export function outboxDir(jobDir, env = process.env) {
  return env.MESH_JOB_OUT || (jobDir ? join(jobDir, "out") : null);
}

/** A job leaves only what it decided: an outbox an earlier run of the same
 *  job folder left is gone before anything is written. */
export function startOutbox(dir) {
  if (dir) rmSync(join(dir, "outbox.jsonl"), { force: true });
}

/** Leave one message. Returns { left, ref } or { error }. */
export function leave(dir, { to, handle = null, text, files = [], thread = null, ref = randomUUID() }) {
  if (!dir) return { error: "this work was given no job folder to leave the message in, so nothing was left to send" };
  if (!AGENT_ID.test(String(to ?? ""))) return { error: `${handle ?? to ?? "the recipient"} has no agent id the host can send to` };
  if (!String(text ?? "").trim()) return { error: "a message with no words" };
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "outbox.jsonl"), `${JSON.stringify({ to, handle, text, ...(files.length ? { files } : {}), ref, ...(thread ? { thread } : {}) })}\n`);
  return { left: true, ref };
}
