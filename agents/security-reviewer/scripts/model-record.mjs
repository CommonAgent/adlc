// The model record: every model call a job makes, kept whole, so the job can
// be done again later without calling a model (run configs, moving a pin,
// docs/run-config-plan.md phase 2 item 5; Common Agent 5.8 "Moving a pin").
//
// A normal job writes model-record.jsonl in its job folder (MESH_JOB_DIR),
// beside its outputs and never among them: one line per model call with the
// whole request and the model service's whole answer, and one line each time
// the job reads the clock for something it writes. Nothing is cut: a request's
// inline picture is kept by reference (its SHA-256 and size; the job makes the
// same picture again from its own input), every other word is kept as sent,
// and the answer is kept as the service gave it. Writing the record never
// changes what the job does or delivers, and a record that cannot be written
// is said on stderr and the job goes on.
//
// A replay (AGENT_MODEL_REPLAY names a saved job's record) answers each call
// from that record instead of calling the model: the call whose request is the
// same, by digest, in the order they were made. A call the record does not
// hold fails the job with a reason that says so, and nothing is ever sent to a
// model service. The clock reads the saved job's times in the order it read
// them. The replay keeps its own record of what it was answered.
//
// A retry (AGENT_MODEL_REUSE names the earlier attempt's record; the runner
// retry policy, docs/runner-retry-plan.md, 2026-10-07) reuses what that
// attempt was already answered: a call whose request is the same, by digest,
// as one the earlier attempt made and got a 2xx answer for is answered from
// the earlier record, once each, in the order they were made, and every other
// call goes to the model. Either way the call is recorded whole in this job's
// record (a reused one says reused_from), so a later attempt or a replay can
// answer it again. With no reuse, nothing here changes.
//
// Self-contained (a package carries its own files); the master is
// packages/explainer/shared/model-record.mjs, copied into fact-writer,
// pitch-writer, scene-writer and presentation-reader. Keep the copies
// identical. The harness (Claude Code) wrote it under the owner's
// building-block exception of 2026-09-23, on the run config plan approved
// 2026-10-07.
//
//   needs: node >= 22
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** The record's file name, in the job folder. */
export const RECORD_FILE = "model-record.jsonl";
/** The setting that makes a job a replay: the path of the saved job's record. */
export const REPLAY_ENV = "AGENT_MODEL_REPLAY";
/** The setting that makes a job a retry: the path of the earlier attempt's record, whose answers it may reuse. */
export const REUSE_ENV = "AGENT_MODEL_REUSE";
export const RECORD_FORMAT = "model-record-v1";

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** JSON with its keys in order (RFC 8785's ordering for the values a request carries). */
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

/**
 * A request as the record keeps it: every member as sent, except an inline
 * picture's bytes, which are kept by their SHA-256 and size.
 */
export function forRecord(body) {
  if (Array.isArray(body)) return body.map(forRecord);
  if (!isObject(body)) return body;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "inlineData" && isObject(v) && typeof v.data === "string") {
      const bytes = Buffer.from(v.data, "base64");
      out[k] = { mimeType: v.mimeType, sha256: sha(bytes), bytes: bytes.length };
    } else out[k] = forRecord(v);
  }
  return out;
}

/** The digest a call is matched by: the model and the request as recorded. */
export function requestDigest(model, body) {
  return `sha256:${sha(canonical({ model: String(model ?? ""), request: forRecord(body) }))}`;
}

/** The saved record a replay answers from, or null when this job is not a replay. */
export function replayFile(env = process.env) {
  const v = String(env?.[REPLAY_ENV] ?? "").trim();
  return v || null;
}

export const inReplay = (env = process.env) => replayFile(env) !== null;

/** The earlier attempt's record a retry may reuse answers from, or null. Never in a replay. */
export function reuseFile(env = process.env) {
  if (inReplay(env)) return null;
  const v = String(env?.[REUSE_ENV] ?? "").trim();
  return v || null;
}

/** Where this job writes its record: its job folder, or nowhere when it has none. */
export function recordFile(env = process.env) {
  const dir = String(env?.MESH_JOB_DIR ?? "").trim();
  return dir ? join(dir, RECORD_FILE) : null;
}

const headed = new Set();

/** Add one line to this job's record. Never throws: a record that cannot be written is said, and the job goes on. */
export function writeRecord(env, line) {
  const file = recordFile(env);
  if (!file) return false;
  try {
    if (!headed.has(file) && !existsSync(file)) {
      appendFileSync(file, `${JSON.stringify({ record: RECORD_FORMAT, at: new Date().toISOString(), ...(inReplay(env) ? { replay_of: replayFile(env) } : {}) })}\n`);
    }
    headed.add(file);
    appendFileSync(file, `${JSON.stringify(line)}\n`);
    return true;
  } catch (e) {
    process.stderr.write(`model record: ${file} could not be written (${String(e?.message ?? e)}); the job goes on without it\n`);
    return false;
  }
}

/** Every line of a record, read whole; [] when there is none. Lines that are not JSON are skipped and counted. */
export function readRecord(file) {
  if (!file || !existsSync(file)) return { lines: [], unreadable: 0, missing: true };
  const lines = [];
  let unreadable = 0;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try { lines.push(JSON.parse(raw)); } catch { unreadable++; }
  }
  return { lines, unreadable, missing: false };
}

// What a replay has used of the saved record, per file.
const saved = new Map();
function savedOf(file) {
  let s = saved.get(file);
  if (!s) {
    const r = readRecord(file);
    s = {
      missing: r.missing,
      head: r.lines.find((l) => l && l.record) ?? null,
      calls: r.lines.filter((l) => l && Number.isInteger(l.call)).map((l) => ({ ...l, used: false })),
      clocks: r.lines.filter((l) => l && typeof l.clock === "string").map((l) => l.clock),
      clockAt: 0,
    };
    saved.set(file, s);
  }
  return s;
}

/** A replay that cannot answer a call from the record: the job fails with this, never calls a model. */
export class NotInRecord extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.notInRecord = true;
    this.modelFailure = true;
    Object.assign(this, extra);
  }
}

let callNumber = 0;
let reusedCalls = 0;

/** How many model calls this job answered from the earlier attempt's record. */
export const reusedCount = () => reusedCalls;

/**
 * One model call, recorded, or answered from the saved record in a replay.
 *
 *   service  the protocol the call speaks (MODEL_PROTOCOL: anthropic-messages,
 *            openai-chat or gemini), for the reader of the record; a replay
 *            matches a call by its model and request, never by this name
 *   model    the model's name as called
 *   body     the request body as sent
 *   call     async () => ({ status, text }): the real call, made only when
 *            this job is not a replay; text is the service's whole answer
 *
 * Resolves to { status, text, replayed }.
 */
export async function modelExchange({ env = process.env, service, model, body, call }) {
  const n = ++callNumber;
  const digest = requestDigest(model, body);
  const file = replayFile(env);
  if (file) {
    const s = savedOf(file);
    const hit = s.calls.find((c) => !c.used && c.request_digest === digest);
    if (!hit) {
      writeRecord(env, { call: n, at: new Date().toISOString(), service, model, request_digest: digest, request: forRecord(body), not_in_record: true });
      const why = s.missing
        ? "the saved job kept no record of its model calls"
        : `the saved job's record holds no call to ${model} with this request (call ${n} of this replay, ${s.calls.length} recorded)`;
      throw new NotInRecord(`Model failure: this is a replay and ${why}, so it was not answered and no model was called.`, { requestDigest: digest });
    }
    hit.used = true;
    writeRecord(env, { call: n, at: new Date().toISOString(), service, model, request_digest: digest, answered_from: hit.call, status: hit.status });
    return { status: hit.status, text: String(hit.answer ?? ""), replayed: true };
  }
  const earlier = reuseFile(env);
  if (earlier) {
    const s = savedOf(earlier);
    const hit = s.calls.find((c) => !c.used && c.request_digest === digest && c.status >= 200 && c.status <= 299 && typeof c.answer === "string");
    if (hit) {
      hit.used = true;
      reusedCalls++;
      writeRecord(env, { call: n, at: new Date().toISOString(), service, model, request_digest: digest, request: forRecord(body), status: hit.status, answer: hit.answer, reused_from: hit.call });
      return { status: hit.status, text: hit.answer, replayed: false, reused: true };
    }
  }
  const got = await call();
  writeRecord(env, { call: n, at: new Date().toISOString(), service, model, request_digest: digest, request: forRecord(body), status: got.status, answer: got.text });
  return { ...got, replayed: false };
}

/**
 * The time a job writes into what it makes. A normal job reads the clock and
 * records the reading; a replay reads the saved job's readings in order (the
 * last one again when it reads more than the saved job did, and the clock
 * itself, said in the record, when the saved job recorded none).
 */
export function jobClock(env = process.env) {
  const file = replayFile(env);
  if (file) {
    const s = savedOf(file);
    if (s.clocks.length) {
      const at = s.clocks[Math.min(s.clockAt, s.clocks.length - 1)];
      s.clockAt++;
      writeRecord(env, { clock: at, from_record: true });
      return new Date(at);
    }
    const now = new Date();
    writeRecord(env, { clock: now.toISOString(), not_in_record: true });
    return now;
  }
  const now = new Date();
  writeRecord(env, { clock: now.toISOString() });
  return now;
}

/** For tests: forget what a replay has used, so a second replay in one process starts fresh. */
export function resetReplay() {
  saved.clear();
  headed.clear();
  callNumber = 0;
  reusedCalls = 0;
}

/** The file one kept exchange is saved to, in the folder it is kept in. */
export const EXCHANGE_FILE = "model-exchange.json";

/**
 * An exchange that keeps one call whole in memory, for the shared caller's
 * `exchange` option: the service (the protocol), the request as sent and the
 * answer as the service gave it, read back from `.data`. Made with
 * replay: true it answers from the exchange saved in `dir` and sends nothing.
 */
export function createExchange({ dir = "", replay = false } = {}) {
  const data = { service: null, request: null, response: null };
  const exchange = async ({ service, body, call }) => {
    data.service = service;
    data.request = body;
    if (replay) {
      const kept = loadExchange(dir);
      if (!kept) throw new NotInRecord(`Model failure: this is a replay and no exchange is saved in ${dir}, so it was not answered and no model was called.`);
      data.response = kept.response;
      return { status: 200, text: typeof kept.response === "string" ? kept.response : JSON.stringify(kept.response), replayed: true };
    }
    const got = await call();
    try { data.response = JSON.parse(got.text); } catch { data.response = got.text; }
    return { ...got, replayed: false };
  };
  exchange.data = data;
  return exchange;
}

/** Save an exchange (one made by createExchange, or its data) in `dir`. */
export function saveExchange(dir, exchangeOrData) {
  const data = typeof exchangeOrData === "function" ? exchangeOrData.data : exchangeOrData;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, EXCHANGE_FILE), JSON.stringify(data, null, 2) + "\n");
}

/** The exchange saved in `dir`, or null when none is. */
export function loadExchange(dir) {
  const p = join(dir, EXCHANGE_FILE);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
