// The three trial cases (Common Agent 7.7, "Conformance"), run against every
// offering that declares a trial:
//
//   input          a trial request whose input exceeds the shape's limit,
//                  refused with reason input;
//   budget         a trial request carrying a budget, refused (reason budget,
//                  which the admission order checks first);
//   requester_day  trial requests from one requester past
//                  per_requester_per_day, the last refused with reason
//                  requester_day and a resets_at.
//
// Each refusal must arrive before any work and carry a quote. Made from the
// agent's own Descriptor, so nobody writes cases by hand. Pure: no network,
// no clock but the one handed in. trial-check.mjs sends them.
//
// A case that cannot be run is inconclusive, never passed: an offering whose
// trial names no limit a node can measure in what was sent (characters or
// bytes) has no input case to run, and one that declares no
// per_requester_per_day has no requester_day case.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The declaration rules are fleet-manager/agentbuilder/shared/trial.mjs, the
// port of the SDK's validateTrial. On the fleet host the files sit flat in
// /opt/fleet, so the copy there is agenteval-trial-rules.mjs.
const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = [join(HERE, "agenteval-trial-rules.mjs"), join(HERE, "trial-rules.mjs"), join(HERE, "..", "package-maker", "shared", "trial.mjs"), join(HERE, "..", "agentbuilder", "shared", "trial.mjs")]
  .find((p) => existsSync(p));
if (!RULES) throw new Error(`the trial rules (agentbuilder/shared/trial.mjs) are not beside ${HERE}`);
const rules = await import(pathToFileURL(RULES).href);
export const { triedOfferings, nextUtcMidnight } = rules;

export const TRIAL_CASE_WINDOW_MS = 30_000;
export const SOURCE = "Common Agent 7.7, Conformance";
/** The budget a budget case carries: the request's own shape (revision 0
 *  and a money ceiling), small, so a node that wrongly admits it is bounded. */
export const CASE_BUDGET = { revision: 0, cost_ceiling: { amount_micro: 10000, currency: "USD" } };

const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** The first shape input whose limit a node can check at admission. */
export function measurableLimit(offering) {
  for (const e of offering?.trial?.shape?.inputs ?? []) {
    for (const key of ["max_chars", "max_bytes"]) {
      if (Number.isInteger(e?.limit?.[key])) return { input: e.name, key, max: e.limit[key] };
    }
  }
  return null;
}

/** A value of `kind` that fits the trial's limit for that input, if any. */
export function fittingValue(kind, limit = {}) {
  const room = Math.min(limit.max_chars ?? Infinity, limit.max_bytes ?? Infinity);
  const want = kind === "url" ? "https://example.com/" : "example";
  return want.length <= room ? want : "x".repeat(Math.max(1, room));
}

/** One more character (and one more byte) than the limit allows. */
export function overLimitValue(kind, max) {
  const n = max + 1;
  if (kind === "url") {
    const base = "https://example.com/";
    return n > base.length ? base + "a".repeat(n - base.length) : "a".repeat(n);
  }
  return "x".repeat(n);
}

/** The inputs every request carries: each required input, and the first
 *  member of each one_of group, as a value that fits its trial limit. A trial
 *  request missing what the offering needs could be refused for that before
 *  the case's own question is asked. */
export function fittingInputs(offering) {
  const limits = new Map((offering?.trial?.shape?.inputs ?? []).map((e) => [e.name, e.limit ?? {}]));
  const out = {};
  const groups = new Set();
  for (const i of offering?.inputs ?? []) {
    if (!i || typeof i.name !== "string" || i.external || i.via !== undefined) continue;
    const grouped = typeof i.one_of === "string";
    if (i.required !== true && !(grouped && !groups.has(i.one_of))) continue;
    if (grouped) groups.add(i.one_of);
    out[i.name] = fittingValue(i.kind, limits.get(i.name));
  }
  return out;
}

/** How many requests the requester_day case may send, so that across the
 *  three cases no more than per_requester_per_day + 1 trials could ever be
 *  admitted: trials the first two cases had wrongly admitted already count
 *  against the requester's day. */
export function requesterDayRequests(perDay, admittedEarlier = 0) {
  return Math.max(1, perDay + 1 - admittedEarlier);
}

/** The three cases for one offering that declares a trial. A case that
 *  cannot be run carries `cannot`, and is judged inconclusive unsent. */
export function trialCases(offering) {
  const id = offering.id;
  const base = { kind: "trial", offering: id, source: `${SOURCE}; offering ${id}` };
  const fits = fittingInputs(offering);
  const cases = [];
  const m = measurableLimit(offering);
  if (!m) {
    cases.push({ ...base, id: `${id}/trial-input`, case: "input", expect: "input",
      cannot: "the trial names no limit a node can measure in what was sent (max_chars or max_bytes), so there is no over-limit request to make" });
  } else {
    const kind = (offering.inputs ?? []).find((i) => i?.name === m.input)?.kind;
    cases.push({ ...base, id: `${id}/trial-input`, case: "input", expect: "input", input: m.input, limit: m,
      request: { inputs: { ...fits, [m.input]: overLimitValue(kind, m.max) } } });
  }
  cases.push({ ...base, id: `${id}/trial-budget`, case: "budget", expect: "budget",
    request: { inputs: fits, budget: CASE_BUDGET } });
  const perDay = offering.trial?.limits?.per_requester_per_day;
  if (!Number.isInteger(perDay)) {
    cases.push({ ...base, id: `${id}/trial-requester-day`, case: "requester_day", expect: "requester_day",
      cannot: "the trial declares no per_requester_per_day, so there is no daily count to reach" });
  } else {
    cases.push({ ...base, id: `${id}/trial-requester-day`, case: "requester_day", expect: "requester_day", per_day: perDay,
      request: { inputs: fits } });
  }
  return cases;
}

/** Every trial case for a Descriptor, offering by offering. */
export function descriptorTrialCases(descriptor) {
  return triedOfferings(descriptor).flatMap((o) => trialCases(o));
}

/** What one answer from the trial door was. `status` is the HTTP status and
 *  `body` the parsed JSON; null answer is no answer at all. */
export function readAnswer(answer) {
  if (!answer) return { what: "none" };
  const body = isRecord(answer.body) ? answer.body : {};
  const code = body.code ?? body.error?.code ?? null;
  if (code === "TRIAL_REFUSED") {
    const d = isRecord(body.details) ? body.details : isRecord(body.error?.details) ? body.error.details : {};
    return { what: "refused", reason: d.reason ?? null, limit: d.limit, resets_at: d.resets_at, quote: d.quote,
      input: d.input, before_work: !body.trial && !d.trial_id, ms: answer.ms, status: answer.status };
  }
  if (isRecord(body.trial) && (answer.status === 202 || answer.status === 200)) {
    return { what: "admitted", state: body.trial.state, ms: answer.ms, status: answer.status };
  }
  const said = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "";
  return { what: "other", status: answer.status ?? null, said: said.slice(0, 160), ms: answer.ms }; // cut-ok: a note for the record; the answer itself is not kept
}

const hasQuote = (q) => isRecord(q) && typeof q.words === "string" && q.words.length > 0;
const verdict = (c, v, observed) => ({ id: c.id, kind: "trial", source: c.source, verdict: v, observed });

/** A refusal's own obligations: before any work, inside the window, with a quote. */
function refusalProblem(r, windowMs) {
  if (!r.before_work) return "refused only after the work had started";
  if (typeof r.ms === "number" && r.ms > windowMs) return `refused after ${Math.round(r.ms / 1000)} s, over the window`;
  if (!hasQuote(r.quote)) return "refused without a quote of what the work costs as an ordinary request";
  return null;
}

// The admission order of 7.7: what a node checks before the input, and after.
const BEFORE_INPUT = ["budget", "not_offered", "not_eligible"];

/**
 * A case's verdict from the answers its requests got, in order: pass, fail
 * or inconclusive, with what was observed. `now` is when the last answer
 * arrived, for checking that resets_at is still ahead.
 */
export function judgeTrialCase(c, answers, { now = new Date(), windowMs = TRIAL_CASE_WINDOW_MS } = {}) {
  if (c.cannot) return verdict(c, "inconclusive", c.cannot);
  const read = (answers ?? []).map(readAnswer);
  if (!read.length || read[0].what === "none") return verdict(c, "inconclusive", `no answer within ${Math.round(windowMs / 1000)} s`);
  const other = read.find((r) => r.what === "other" || r.what === "none");
  const firstRefusal = read.find((r) => r.what === "refused");
  if (c.case === "input" || c.case === "budget") {
    const r = read[0];
    if (r.what === "other") return verdict(c, "inconclusive", `the trial door answered ${r.status}${r.said ? `: ${r.said}` : ""}`);
    if (r.what === "admitted") return verdict(c, "fail", c.case === "input"
      ? `admitted a trial whose ${c.input} is over its ${c.limit.key} of ${c.limit.max}, and it went to work`
      : "admitted a trial request carrying a budget, and it went to work");
    if (r.reason === c.expect) {
      if (c.case === "input" && r.input !== undefined && r.input !== c.input) return verdict(c, "fail", `refused on input, naming ${r.input} rather than ${c.input}`);
      const why = refusalProblem(r, windowMs);
      return why ? verdict(c, "fail", why) : verdict(c, "pass", `refused before any work, reason ${r.reason}, with a quote (${r.quote.words})`);
    }
    if (r.reason === "not_eligible") return verdict(c, "inconclusive", "refused not_eligible: the evaluator's account does not qualify under this trial's who, so the case was never asked");
    if (c.case === "budget") return verdict(c, "fail", `refused for ${r.reason}; a trial carrying a budget is refused for that first, before any other check`);
    if (BEFORE_INPUT.includes(r.reason)) return verdict(c, "fail", `refused for ${r.reason} though the descriptor declares the trial`);
    return verdict(c, "fail", `refused for ${r.reason}; an input over its trial limit is refused before any count is read`);
  }
  // requester_day
  const admitted = read.filter((r) => r.what === "admitted").length;
  if (!firstRefusal) {
    if (other) return verdict(c, "inconclusive", `after ${admitted} admitted, the trial door answered ${other.status}${other.said ? `: ${other.said}` : ""}`);
    return verdict(c, "fail", `admitted ${admitted} trials from one requester in one day against a per_requester_per_day of ${c.per_day}`);
  }
  if (other && read.indexOf(other) < read.indexOf(firstRefusal)) {
    return verdict(c, "inconclusive", `after ${admitted} admitted, the trial door answered ${other.status}${other.said ? `: ${other.said}` : ""}`);
  }
  const r = firstRefusal;
  if (r.reason === "requester_day") {
    if (r.limit !== c.per_day) return verdict(c, "fail", `refused requester_day naming a limit of ${r.limit}, where the descriptor declares ${c.per_day}`);
    const at = Date.parse(r.resets_at ?? "");
    if (!Number.isFinite(at)) return verdict(c, "fail", "refused requester_day with no resets_at, so the requester cannot tell when to try again");
    if (at <= now.getTime()) return verdict(c, "fail", `refused requester_day with a resets_at (${r.resets_at}) that has already passed`);
    const why = refusalProblem(r, windowMs);
    if (why) return verdict(c, "fail", why);
    const earlier = admitted < c.per_day ? `; ${c.per_day - admitted} of the day's trials were already used by this requester before the case` : "";
    return verdict(c, "pass", `refused after ${admitted} admitted, before any work, reason requester_day, limit ${r.limit}, resets_at ${r.resets_at}, with a quote${earlier}`);
  }
  if (["not_eligible", "day", "funds", "requester_ever"].includes(r.reason)) {
    return verdict(c, "inconclusive", `refused for ${r.reason} after ${admitted} admitted, before the requester's daily count was reached, so the case could not be asked`);
  }
  return verdict(c, "fail", `refused for ${r.reason} after ${admitted} admitted, where the requester's daily count was the reason due`);
}
