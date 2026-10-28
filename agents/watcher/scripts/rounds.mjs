// A round: one asking of every watched agent, the answers as they come, and
// the report when it closes.
//
// The question goes out after the job that asks it has ended (the host sends
// what the job left), and each answer comes back as a message of its own, so a
// watch cannot ask and hear in one job. A round is kept in the records folder
// between them: what was asked when it opened, each answer as it arrives, and
// how it closed. It closes when every agent asked has answered, or when the
// wait is over; whoever has not answered by then did not answer within the
// wait, and silence is a failure.
//
//   {records}/rounds/<id>.json   the round
//   {records}/rounds/open.json   which round is open, if any
//   {records}/rounds/.lock       held while a job reads and changes them
//
// Requests, answers and the closing of a round can be worked on at the same
// time, so every read-modify-write of a round happens under the lock, and a
// round is read again inside it. Writes are whole-file and renamed into place.
//
// An answer is matched by what it replies to: the host writes the id each
// question went out under in out/outbox.sent.jsonl beside the outbox, by the
// `ref` the question carried, and an answer whose in_reply_to is that id is
// that agent's answer. Only while those ids cannot be read is an answer
// matched by its sender, and then only when it is the worker interface's own
// status answer, so another message from a watched agent is never taken for
// one.
//
//   needs: node >= 22
//   import { withLock, newRoundId, saveRound, openRound, loadRound, recordAnswer, allAnswered, askedAt, sentLines, writeWhole } from "./rounds.mjs"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { readAnswer } from "./ask.mjs";

const dirOf = (records) => join(records, "rounds");
const fileOf = (records, id) => join(dirOf(records), `${id}.json`);
const OPEN = "open.json";

/** Write a file whole: written beside and renamed into place. */
export function writeWhole(path, doc) {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n");
  renameSync(tmp, path);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn while holding the rounds' lock: a file made exclusively. A lock older
 *  than staleMs is a job that died holding it, and is taken over. */
export async function withLock(records, fn, { waitMs = 60_000, staleMs = 120_000 } = {}) {
  mkdirSync(dirOf(records), { recursive: true });
  const lock = join(dirOf(records), ".lock");
  const until = Date.now() + waitMs;
  for (;;) {
    try { closeSync(openSync(lock, "wx")); break; } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > staleMs) { rmSync(lock, { force: true }); continue; } } catch { continue; }
      if (Date.now() > until) throw new Error("another job has held the watch's records for too long; nothing was changed");
      await pause(200);
    }
  }
  try { return await fn(); } finally { rmSync(lock, { force: true }); }
}

/** A round id: the time it opened and four random characters. */
export function newRoundId(now) {
  return `w-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomBytes(2).toString("hex")}`;
}

export function saveRound(records, round) {
  mkdirSync(dirOf(records), { recursive: true });
  writeWhole(fileOf(records, round.id), round);
  if (round.status === "open") writeWhole(join(dirOf(records), OPEN), { id: round.id });
  else if (openId(records) === round.id) rmSync(join(dirOf(records), OPEN), { force: true });
  return round;
}

export function loadRound(records, id) {
  try { return JSON.parse(readFileSync(fileOf(records, id), "utf8")); } catch { return null; }
}

function openId(records) {
  try { return JSON.parse(readFileSync(join(dirOf(records), OPEN), "utf8")).id ?? null; } catch { return null; }
}

/** The open round, or null. */
export function openRound(records) {
  const id = openId(records);
  if (!id || !existsSync(fileOf(records, id))) return null;
  const r = loadRound(records, id);
  return r?.status === "open" ? r : null;
}

/** What the host wrote back about the round's questions: its
 *  out/outbox.sent.jsonl, by ref. Empty until the host has sent them. */
export function sentLines(round) {
  const out = new Map();
  if (!round?.out_dir) return out;
  let text = "";
  try { text = readFileSync(join(round.out_dir, "outbox.sent.jsonl"), "utf8"); } catch { return out; }
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try { const j = JSON.parse(l); if (j?.ref) out.set(j.ref, j); } catch { /* a line the host did not finish */ }
  }
  return out;
}

const same = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();

/** Record an answer in a round. Returns the agent it answers, or null when it
 *  answers nothing this round asked. */
export function recordAnswer(round, { from = "", fromId = "", at, inReplyTo = null, text = "" }) {
  const waiting = (round?.agents ?? []).filter((x) => x.asked?.outcome === "asked" && !x.answer);
  const sent = sentLines(round);
  let a = inReplyTo ? waiting.find((x) => sent.get(x.asked.ref)?.message_id === inReplyTo) : null;
  if (!a) {
    // The ids are not known yet (or this agent's is not): matched by sender,
    // and only when it is the worker interface's own status answer.
    const known = (x) => Boolean(sent.get(x.asked.ref)?.message_id);
    if (readAnswer(text).worker) a = waiting.find((x) => !known(x) && (same(x.handle, from) || same(x.named, from) || same(x.key, from) || same(x.key, fromId)));
  }
  if (!a) return null;
  a.answer = { at, from: from || fromId, in_reply_to: inReplyTo, reply: String(text) };
  return a;
}

/** Whether every agent asked has answered. */
export function allAnswered(round) {
  return (round?.agents ?? []).filter((x) => x.asked?.outcome === "asked").every((x) => x.answer);
}

/** One agent's question and answer, as checks.mjs reads one: answered, with
 *  how long it took; silent, given up at the end of the wait; refused or held
 *  at its door, as the host reported its send; or not sent, with why. */
export function askedAt(agent, round, sent = sentLines(round)) {
  const q = agent.asked ?? {};
  if (q.outcome !== "asked") return { handle: agent.handle, sent_at: q.sent_at ?? round.opened_at, gave_up_at: q.sent_at ?? round.opened_at, outcome: q.outcome ?? "not-sent", why: q.why ?? "it was not asked" };
  if (agent.answer) {
    const seconds = Math.round((new Date(agent.answer.at) - new Date(q.sent_at)) / 100) / 10;
    return { handle: agent.handle, sent_at: q.sent_at, answered_at: agent.answer.at, seconds, outcome: "answered", reply: agent.answer.reply };
  }
  const s = sent.get(q.ref);
  // The host's word on the send: a question that never reached the agent is a
  // gap in the watch, not the agent's silence.
  if (s?.error && !s?.retrying && !s?.unconfirmed) return { handle: agent.handle, sent_at: q.sent_at, gave_up_at: q.sent_at, outcome: "refused", why: `the host could not send it: ${s.error}` };
  // Silence is established at the end of the wait, which is when the alarm
  // dates it: what was seen falls before it, inside the incident recorder's
  // window.
  const end = new Date(new Date(q.sent_at).getTime() + round.wait_seconds * 1000).toISOString();
  // A question the host reports held in the agent's mailbox reached a door
  // nobody was serving: that is the silence, said with its reason.
  const held = s?.held ? "; the host found nobody serving its inbox, and the question waits in its mailbox" : "";
  return { handle: agent.handle, sent_at: q.sent_at, gave_up_at: end, outcome: "silent", why: `no answer within ${round.wait_seconds}s${held}`, ...(s?.message_id ? { message_id: s.message_id } : {}) };
}
