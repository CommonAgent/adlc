// A round: one asking of every watched agent, the answers as they come, and
// the report when it closes.
//
// The question goes out after the job that asks it has ended (the host sends
// what the job left), and each answer comes back as a message of its own, so a
// watch cannot ask and hear in one job. A round is kept in the records folder
// between them: what was read and asked when it opened, each answer as it
// arrives, and how it closed. It closes when every agent asked has answered,
// or when a watch is asked for after the wait has passed; whoever has not
// answered by then did not answer within the wait, and silence is a failure.
//
//   {records}/rounds/<id>.json   the round
//   {records}/rounds/open.json   which round is open, if any
//
// Writes are whole-file and renamed into place, so a reader never sees half a
// round. The replies to one round are worked on one at a time (the host keeps
// each thread in turn), so two answers never write at once.
//
//   needs: node >= 22
//   import { newRoundId, saveRound, openRound, recordAnswer, allAnswered, askedAt } from "./rounds.mjs"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const dirOf = (records) => join(records, "rounds");
const fileOf = (records, id) => join(dirOf(records), `${id}.json`);
const OPEN = "open.json";

function writeWhole(path, doc) {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n");
  renameSync(tmp, path);
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

const same = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();

/** Record an answer in a round: the agent it is from (by handle or agent id),
 *  asked in this round and not answered yet. Returns that agent, or null when
 *  the message answers nothing this round asked. */
export function recordAnswer(round, { from, at, inReplyTo = null, text = "" }) {
  const a = (round?.agents ?? []).find((x) => x.asked?.outcome === "asked" && !x.answer && (same(x.handle, from) || same(x.key, from)));
  if (!a) return null;
  a.answer = { at, from, in_reply_to: inReplyTo, reply: String(text) };
  return a;
}

/** Whether every agent asked has answered. */
export function allAnswered(round) {
  const asked = (round?.agents ?? []).filter((x) => x.asked?.outcome === "asked");
  return asked.every((x) => x.answer);
}

/** One agent's question and answer, as checks.mjs reads one: answered, with
 *  how long it took; or silent, given up at the end of the wait; or not sent,
 *  with why. */
export function askedAt(agent, round) {
  const q = agent.asked ?? {};
  if (q.outcome !== "asked") return { handle: agent.handle, sent_at: q.sent_at ?? round.opened_at, gave_up_at: q.sent_at ?? round.opened_at, outcome: q.outcome ?? "not-sent", why: q.why ?? "it was not asked" };
  if (agent.answer) {
    const seconds = Math.round((new Date(agent.answer.at) - new Date(q.sent_at)) / 100) / 10;
    return { handle: agent.handle, sent_at: q.sent_at, answered_at: agent.answer.at, seconds, outcome: "answered", reply: agent.answer.reply };
  }
  // Silence is established at the end of the wait, which is when the alarm
  // dates it: what was seen falls before it, inside the incident recorder's
  // window.
  const end = new Date(new Date(q.sent_at).getTime() + round.wait_seconds * 1000).toISOString();
  return { handle: agent.handle, sent_at: q.sent_at, gave_up_at: end, outcome: "silent", why: `no answer within ${round.wait_seconds}s` };
}
