// Trials (Common Agent 7.7), the declaration rules, for the fleet's own tools.
//
// A port of validateTrial and validateDescriptorTrials in
// sdk-typescript/src/trial.ts, with the same rules in the same order and the
// same words, so the builder, the install check, the evaluator and the
// registry refuse the same declarations. conformance/trial.json is the
// authority; agenteval/test/trial-cases.test.mjs holds this file to it. Pure,
// no dependency outside node.

export const TRIAL_WHO = ["anyone", "signed_in", "verified"];
export const TRIAL_LIMIT_KEYS = ["max_chars", "max_bytes", "max_pages", "max_seconds", "max_items"];
/** The limits a node can check at admission, in what was sent. */
export const ADMISSION_LIMIT_KEYS = ["max_chars", "max_bytes"];
export const TRIAL_COUNTS = ["per_requester_per_day", "per_day", "per_requester_ever"];

const whole = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Why a trial declaration is not acceptable, or null. `offering`, when
 *  given, is the offering (or spec job) it sits on: a shape naming an input
 *  or output it does not declare is refused. A trial with no count is
 *  refused: nothing would bound it. */
export function validateTrial(trial, offering) {
  if (!isRecord(trial)) return "trial must be an object with who, limits and, optionally, shape.";
  if (typeof trial.who !== "string" || !TRIAL_WHO.includes(trial.who)) return `trial.who must be one of ${TRIAL_WHO.join(", ")}.`;
  const limits = trial.limits;
  if (!isRecord(limits)) return "trial.limits is required: a trial with no count is not bounded.";
  let counted = 0;
  for (const k of TRIAL_COUNTS) {
    if (limits[k] === undefined) continue;
    if (!whole(limits[k])) return `trial.limits.${k} must be a whole number of trial tasks.`;
    counted++;
  }
  for (const k of Object.keys(limits)) {
    if (!TRIAL_COUNTS.includes(k)) return `trial.limits.${k} is not a count this specification defines; limits are counts, never money.`;
  }
  if (counted === 0) return "trial.limits must carry at least one of per_requester_per_day, per_day and per_requester_ever: a trial with no count is not bounded.";
  if (trial.shape === undefined) return null;
  const shape = trial.shape;
  if (!isRecord(shape)) return "trial.shape must be an object.";
  const names = (side) => new Set((offering?.[side] ?? []).map((e) => e?.name).filter((n) => typeof n === "string"));
  if (shape.inputs !== undefined) {
    if (!Array.isArray(shape.inputs)) return "trial.shape.inputs must be a list.";
    const inputs = names("inputs");
    for (const entry of shape.inputs) {
      if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name) return "each trial.shape.inputs entry needs the name of a declared input.";
      if (offering && !inputs.has(entry.name)) return `trial.shape.inputs names "${entry.name}", which the offering does not declare.`;
      if (!isRecord(entry.limit)) return `trial.shape.inputs "${entry.name}" needs a limit.`;
      let any = 0;
      for (const [k, v] of Object.entries(entry.limit)) {
        if (!TRIAL_LIMIT_KEYS.includes(k)) return `trial.shape.inputs "${entry.name}" limit ${k} is not one of ${TRIAL_LIMIT_KEYS.join(", ")}.`;
        if (!whole(v) || v === 0) return `trial.shape.inputs "${entry.name}" limit ${k} must be a whole number above zero.`;
        any++;
      }
      if (!any) return `trial.shape.inputs "${entry.name}" names no limit.`;
    }
  }
  if (shape.omits !== undefined) {
    if (!Array.isArray(shape.omits) || shape.omits.some((n) => typeof n !== "string" || !n)) return "trial.shape.omits must be a list of output names.";
    if (offering) {
      const outputs = names("outputs");
      for (const n of shape.omits) if (!outputs.has(n)) return `trial.shape.omits names "${n}", which the offering does not declare as an output.`;
    }
  }
  for (const k of ["live_seconds", "keeps_days"]) {
    if (shape[k] !== undefined && !whole(shape[k])) return `trial.shape.${k} must be a whole number.`;
  }
  if (shape.marked !== undefined && typeof shape.marked !== "boolean") return "trial.shape.marked must be true or false.";
  return null;
}

/** Every offering's trial in a Descriptor, checked, and its samples_ref. The
 *  first problem, named with its offering, or null. */
export function validateDescriptorTrials(doc) {
  if (!isRecord(doc) || !Array.isArray(doc.offerings)) return null;
  for (const o of doc.offerings) {
    if (!isRecord(o) || o.trial === undefined) continue;
    const why = validateTrial(o.trial, o);
    if (why) return `offering ${typeof o.id === "string" ? o.id : "(no id)"}: ${why}`;
  }
  if (doc.samples_ref !== undefined && (typeof doc.samples_ref !== "string" || !/^https:\/\//.test(doc.samples_ref))) {
    return "samples_ref must be an https address of the agent's samples document.";
  }
  return null;
}

/** The offerings of a Descriptor that declare a trial which validates. One
 *  that does not validate is no trial (9.6: never the flattering reading). */
export function triedOfferings(doc) {
  if (!isRecord(doc) || !Array.isArray(doc.offerings)) return [];
  return doc.offerings.filter((o) => isRecord(o) && o.trial !== undefined && validateTrial(o.trial, o) === null);
}

/** The next UTC midnight after `now`: when a per-day count resets. */
export function nextUtcMidnight(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}
