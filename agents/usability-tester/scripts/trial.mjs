// One offering run as a person runs it from its page: Run, wait for the job,
// answer once if the agent asks something, read what came back, then Ask for
// a change and wait for the new version. Every call is one the App's agent
// page makes (platform.mjs); nothing here reaches the agent another way.
//
//   needs: node >= 22
//   import { runOffering, askForChange } from "./trial.mjs"
import { judgePiece } from "./readable.mjs";

const trim = (s) => String(s ?? "").trim();
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** What the tester answers when the agent stops to ask, as a person in a hurry would. */
export const ANSWER = "Yes, go ahead with your best judgement; I have nothing to add.";
const SETTLED = new Set(["delivered", "accepted", "refused", "answered"]);
const same = (a, b) => trim(a).toLowerCase().replace(/[\s_-]+/g, " ") === trim(b).toLowerCase().replace(/[\s_-]+/g, " ");
const hex = (d) => trim(d).toLowerCase().replace(/^sha256:/, "");

/** The job id a Run answer names, as the page reads it. */
export function jobOf(data) {
  const j = data?.job?.job ?? data?.job_id ?? (typeof data?.job === "string" ? data.job : null);
  return typeof j === "string" && j ? j : null;
}

/** The newest version of a job record, or null. */
export const latest = (rec) => (Array.isArray(rec?.versions) && rec.versions.length ? rec.versions[rec.versions.length - 1] : null);

/** The declared output a piece answers to, by name. */
export const outputFor = (o, name) => (Array.isArray(o.outputs) ? o.outputs : []).find((x) => same(x.name, name)) ?? null;

/** Whether what came back holds the deliverable (app-next describe.ts holdsDeliverable). */
export function holdsDeliverable(o, pieces) {
  if (!pieces.length) return false;
  const outs = Array.isArray(o.outputs) ? o.outputs : [];
  const main = outs.filter((x) => !x.working);
  if (!outs.some((x) => x.working) || !main.length) return true;
  const working = (p) => p.working === true || outputFor(o, p.name)?.working === true;
  return pieces.some((p) => !working(p) && (Boolean(outputFor(o, p.name)) || !pieces.some((q) => outputFor(o, q.name))));
}

/** Wait for the job to settle, or for a new version past `versions`. */
async function follow(p, id, { deadline, pollMs, sleep, versions = -1, agentKey = "", sentAt = "", answerOnce = true, log, clock = Date.now }) {
  let rec = null;
  let asked = null;
  let answered = false;
  let repliedAt = "";
  let lastErr = "";
  while (clock() < deadline) {
    const r = await p.job(id);
    if (r.ok && r.data) { rec = r.data; lastErr = ""; } else lastErr = r.error ?? "";
    const n = Array.isArray(rec?.versions) ? rec.versions.length : 0;
    const state = trim(rec?.state);
    if (versions >= 0) {
      if (n > versions && state !== "changing") return { rec, asked, answered, settled: true };
      if (rec && !rec.pending_revision && state !== "changing" && n <= versions && rec.refusal && Date.parse(rec.refusal.at) > Date.parse(sentAt)) return { rec, asked, answered, settled: true, refusedChange: rec.refusal.reason };
    } else if (state === "answered" && !n) {
      // Words without a delivery. When they ask the person something (a
      // question, or "reply yes to go on"), a person answers, once, and the
      // job is followed on; any other answer, or one after that reply, is
      // where the job stands.
      const said = trim(rec.answered?.text);
      const asks = /\?\s*$|\?\s*\n|(?:^|\n|[.!:]\s+)(?:please\s+)?(?:reply|answer|confirm)\b/i.test(said);
      if (answerOnce && !answered && asks) {
        asked = said.slice(0, 600);
        repliedAt = new Date().toISOString();
        const a = await p.reply(id, ANSWER);
        answered = true;
        log?.(`answered the agent's question on ${id} (${a.status})`);
      } else if (!answered || !asks || Date.parse(rec.answered?.at) > Date.parse(repliedAt)) return { rec, asked, answered, settled: true };
    } else if (SETTLED.has(state)) return { rec, asked, answered, settled: true };
    // The agent stopped to ask: answer once, the way the page's reply box does.
    if (answerOnce && !answered && agentKey && (state === "asked" || state === "changing" || !rec)) {
      const box = await p.inbox();
      // A question: words from the agent since the run that ask something.
      // A note that it is working, or the delivery's own message, is not.
      const msgs = (box.data?.messages ?? []).filter((m) => m.from === agentKey && Date.parse(m.received_at) >= Date.parse(sentAt) - 5000 && /\?\s*$/m.test(trim(m.text)));
      if (msgs.length) {
        asked = trim(msgs[msgs.length - 1].text).slice(0, 600);
        const a = await p.reply(id, ANSWER);
        answered = true;
        log?.(`answered the agent's question on ${id} (${a.status})`);
      }
    }
    await sleep(pollMs);
  }
  return { rec, asked, answered, settled: false, error: lastErr };
}

/** The pieces of a version, each read and judged against its declared output. */
async function readVersion(p, o, v) {
  const pieces = (v?.manifest?.pieces ?? []).filter((x) => x && x.ref);
  const judged = [];
  for (const piece of pieces) {
    const r = await p.piece(piece.ref);
    judged.push({ ...judgePiece(outputFor(o, piece.name), piece, r.ok ? r.bytes : null), step: trim(piece.step) || null, size: piece.size ?? null, digest: piece.digest ?? null, error: r.ok ? null : r.error });
  }
  return judged;
}

/**
 * Run offering `o` of the agent `key` with `message`, as Run does.
 * Answers {sent, job, state, asked, answered, waited_seconds, version, pieces[],
 *          delivers, readable, missing[], package_digest, words, refusal, error}.
 */
export async function runOffering(p, { key, o, message, deadline, pollMs = 10_000, sleep = realSleep, log, clock = Date.now } = {}) {
  const t0 = clock();
  const sentAt = new Date().toISOString();
  const out = { sent: false, job: null, state: null, asked: null, answered: false, waited_seconds: 0, version: null, pieces: [], delivers: false, readable: false, missing: [], package_digest: null, agent_version: null, words: "", refusal: null, error: null };
  const r = await p.run(key, { text: message.text, offering: o.id, files: message.files });
  out.sent = r.status > 0;
  const d = r.data ?? {};
  out.job = jobOf(d);
  if (!r.ok || (!out.job && d.ok === false)) {
    out.state = "not started";
    out.error = r.ok ? trim(d.error?.message ?? d.error ?? d.text) || "the platform started no job" : r.error;
    return out;
  }
  if (!out.job) {
    // Answered in words within the call, with no job to follow.
    out.state = "answered";
    out.words = trim(d.text).slice(0, 600);
    out.waited_seconds = Math.round((clock() - t0) / 1000);
    return out;
  }
  const f = await follow(p, out.job, { deadline, pollMs, sleep, agentKey: key, sentAt, log, clock });
  out.waited_seconds = Math.round((clock() - t0) / 1000);
  out.asked = f.asked;
  out.answered = f.answered;
  const rec = f.rec;
  out.state = f.settled ? trim(rec?.state) : `still ${trim(rec?.state) || "unread"} when the wait ran out`;
  if (!rec) { out.error = f.error || "the job record could not be read"; return out; }
  out.job = trim(rec.job) || out.job;
  if (rec.refusal) out.refusal = trim(rec.refusal.reason);
  if (rec.answered) out.words = trim(rec.answered.text).slice(0, 600);
  const v = latest(rec);
  if (!v) return out;
  out.version = v.version ?? rec.versions.length;
  out.package_digest = hex(v.package_digest ?? v.manifest?.package_digest) ? `sha256:${hex(v.package_digest ?? v.manifest?.package_digest)}` : null;
  out.agent_version = trim(v.agent_version ?? v.manifest?.agent_version) || null;
  out.pieces = await readVersion(p, o, v);
  out.delivers = holdsDeliverable(o, out.pieces);
  const declared = (Array.isArray(o.outputs) ? o.outputs : []).filter((x) => !x.working && (x.when ?? "per_task") === "per_task");
  out.missing = declared.filter((x) => !out.pieces.some((q) => same(q.name, x.name))).map((x) => x.name);
  out.readable = out.pieces.some((q) => q.readable && q.for_a_person);
  return out;
}

/** The steps a change redoes: the offering's priced steps, its steps, or those its pieces name. */
export function changeSteps(o, pieces) {
  const priced = Array.isArray(o.revisions?.steps) ? o.revisions.steps.map((s) => trim(s.id)).filter(Boolean) : [];
  if (priced.length) return priced;
  const own = Array.isArray(o.steps) ? o.steps.map((s) => trim(s?.id)).filter(Boolean) : [];
  const made = [...new Set(pieces.map((q) => q.step).filter(Boolean))];
  return made.length ? made : own.length ? own : [o.id];
}

/**
 * Ask for one change to delivered job `job`, and wait for the new version.
 * Answers {asked, steps, taken, refused, price, version, delivers, readable, pieces[], waited_seconds, error}.
 */
export async function askForChange(p, { key, o, job, change, before, deadline, pollMs = 10_000, sleep = realSleep, log, clock = Date.now } = {}) {
  const t0 = clock();
  const out = { asked: change, steps: [], taken: false, refused: null, price: null, version: null, delivers: false, readable: false, pieces: [], waited_seconds: 0, error: null };
  const lastPieces = before?.pieces ?? [];
  out.steps = changeSteps(o, lastPieces);
  const sentAt = new Date().toISOString();
  const r = await p.revise(job, change, out.steps);
  const d = r.data ?? {};
  if (r.status >= 200 && r.status < 300 && d.approval_needed) { out.price = trim(d.approve_at) || "it waits for the person's approval of its price"; return out; }
  if (r.status >= 200 && r.status < 300 && d.ok === false && !d.held && !d.queued) {
    const e = d.error;
    out.refused = trim(typeof e === "object" && e ? e.message ?? e.code : e) || trim(d.text) || "the agent did not take the change";
    return out;
  }
  if (!(r.status >= 200 && r.status < 300)) { out.error = r.error; return out; }
  out.taken = true;
  const f = await follow(p, job, { deadline, pollMs, sleep, versions: before?.versions ?? 1, agentKey: key, sentAt, log, clock });
  out.waited_seconds = Math.round((clock() - t0) / 1000);
  if (f.refusedChange) { out.refused = f.refusedChange; return out; }
  const v = latest(f.rec);
  const n = Array.isArray(f.rec?.versions) ? f.rec.versions.length : 0;
  if (!f.settled || !v || n <= (before?.versions ?? 1)) { out.error = `no new version came back within ${Math.round(out.waited_seconds / 60)} minutes${f.rec?.state ? ` (the job is ${f.rec.state})` : ""}`; return out; }
  out.version = v.version ?? n;
  out.pieces = await readVersion(p, o, v);
  out.delivers = holdsDeliverable(o, out.pieces);
  out.readable = out.pieces.some((q) => q.readable && q.for_a_person);
  return out;
}
