// The standard file test/kept-interfaces.test.mjs, made from the spec by
// code (test-writer 0.9.0). No model.
//
// A spec keeps an interface (keep: true) when a dependent relies on it or a
// rebuild must match the code it replaces. The test for it is not a judgment,
// so it is not the model's: the master copy is references/kept-interfaces.test.mjs,
// the same bytes in every suite but for one line, `export const KEPT = [];`,
// which becomes the spec's kept interfaces with the name of each one's test
// (and `export const FROM = null;`, which becomes the product it came from).
// Nothing else is written, so the same spec always gives the same file.
//
// What each kept interface gets:
//   function, with a module   a test: exported under that name from that
//                             module, async as its signature says;
//   command, with flags       a test: run with each flag, none refused, no
//                             usage error;
//   file, with a schema       a test over the job folders kept as examples,
//                             and checkKept(jobDir, { expect: [id] }) for the
//                             suite's own tests to call;
//   message, with a schema    keptProblems(id, value) for the suite's tests;
//   anything else             nothing, and the reason, said beside the suite
//                             as what could not be tested.
//
//   needs: node >= 22
//   import { keptInterfacesTest } from "./kept-interfaces.mjs"
import { keptOf } from "./spec-rules.mjs";

const trim = (s) => String(s ?? "").trim();

/** The line of the master copy the kept interfaces go in, and the line the
 *  product goes in. Each is in the master copy exactly once. */
export const KEPT_LINE = "export const KEPT = [];";
export const FROM_LINE = "export const FROM = null;";

/** A flag as given on a command line: "--job <folder>" is --job. The same
 *  reading as the master copy's flagOf. */
const flagOf = (f) => { const t = trim(f).split(/[\s=]/)[0]; return t.startsWith("-") ? t : `--${t}`; };
const saysAsync = (signature) => /\basync\b|\bPromise\b/.test(String(signature ?? ""));
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The keywords anywhere in a schema the master copy does not read: the
 *  same lists as its READ and DESCRIBES. */
const READ = new Set(["type", "enum", "const", "properties", "required", "additionalProperties", "items", "prefixItems", "additionalItems",
  "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum",
  "exclusiveMaximum", "multipleOf", "minProperties", "maxProperties", "allOf", "anyOf", "oneOf", "not", "$ref",
  "$schema", "$id", "$defs", "definitions", "$comment", "title", "description", "default", "examples",
  "format", "deprecated", "readOnly", "writeOnly", "contentMediaType", "contentEncoding"]);
export function unreadKeywords(schema) {
  const out = [];
  const walk = (s) => {
    if (!s || typeof s !== "object") return;
    if (Array.isArray(s)) { s.forEach(walk); return; }
    for (const [k, v] of Object.entries(s)) {
      if (!READ.has(k) && !out.includes(k)) out.push(k);
      if (["properties", "$defs", "definitions"].includes(k) && v && typeof v === "object") Object.values(v).forEach(walk);
      else if (["items", "additionalProperties", "not"].includes(k)) walk(v);
      else if (["prefixItems", "allOf", "anyOf", "oneOf"].includes(k)) (Array.isArray(v) ? v : []).forEach(walk);
    }
  };
  walk(schema);
  return out;
}

/** Each kept interface as the master copy reads it: the spec's own members
 *  (id, kind, name, module, signature, flags, schema, about), the name of its
 *  test or null, the function the suite's tests hold it with or null, and,
 *  when it has neither, why. Pure. */
export function keptPlan(spec) {
  const out = [];
  for (const raw of keptOf(spec)) {
    const i = { id: trim(raw.id), kind: trim(raw.kind), name: trim(raw.name) };
    for (const k of ["module", "signature", "flags", "schema", "about"]) if (raw[k] !== undefined) i[k] = raw[k];
    let test = null; let held = null; let why = null;
    if (i.kind === "function") {
      if (!trim(i.module)) why = "the spec names no module it is exported from, so nothing can import it by that name";
      else test = `[${i.id}] ${i.name} is exported from ${trim(i.module)}${i.signature === undefined ? "" : saysAsync(i.signature) ? " as an async function" : " as a function that is not async"}, as the spec keeps it`;
    } else if (i.kind === "command") {
      const flags = (Array.isArray(i.flags) ? i.flags : []).map(flagOf);
      if (!flags.length) why = "the spec keeps no flags for it, so there is nothing to give it";
      else test = `[${i.id}] the command ${JSON.stringify(i.name)} accepts ${flags.length === 1 ? "its flag" : "its flags"} ${list(flags)}, as the spec keeps ${flags.length === 1 ? "it" : "them"}`;
    } else if (i.kind === "file") {
      if (i.schema === undefined) why = "the spec keeps no JSON Schema for it, so there is no shape to hold it to";
      else { test = `[${i.id}] ${i.name}, in each job folder kept as an example, is what the JSON Schema the spec keeps for it says`; held = "checkKept"; }
    } else if (i.kind === "message") {
      if (i.schema === undefined) why = "the spec keeps no JSON Schema for it, so there is no shape to hold it to";
      else held = "keptProblems";
    } else if (i.kind === "http") {
      why = "nothing in a suite stands in for the address it answers on; the suite's own tests reach what answers it";
    } else if (i.kind === "setting") {
      why = "a setting is read by the scripts that use it, and the suite's own tests set it";
    } else {
      why = `the spec's kind ${JSON.stringify(i.kind)} is not one this check reads`;
    }
    const unread = i.schema !== undefined ? unreadKeywords(i.schema) : [];
    out.push({ ...i, test, held_by: held, ...(why ? { not_checked: why } : {}), ...(unread.length ? { unread } : {}) });
  }
  return out;
}

/** The file, made from the master copy and the spec, or null when the spec
 *  keeps no interface. Returns { path, text, tests, could_not }: the names of
 *  the tests it holds, and what could not be tested, {what, why}, for each
 *  kept interface with no check and each schema keyword not read. Throws when
 *  the master copy does not carry its two lines once each. */
export function keptInterfacesTest(spec, master) {
  const plan = keptPlan(spec);
  if (!plan.length) return null;
  const text = String(master ?? "");
  for (const line of [KEPT_LINE, FROM_LINE]) {
    if (text.split(line).length !== 2) throw new Error(`the master copy of the kept-interfaces check does not carry ${JSON.stringify(line)} once`);
  }
  const from = { product: trim(spec?.product?.name) || null, version: trim(spec?.product?.version) || null };
  // Replaced by a function, so a $ in a pattern is never read as a
  // replacement pattern.
  const filled = text
    .replace(FROM_LINE, () => `export const FROM = ${JSON.stringify(from)};`)
    .replace(KEPT_LINE, () => `export const KEPT = ${JSON.stringify(plan, null, 2)};`);
  const couldNot = [];
  for (const i of plan) {
    if (i.not_checked) couldNot.push({ what: `the kept interface ${i.id} (${i.kind} ${i.name})`, why: i.not_checked });
    if (i.unread) couldNot.push({ what: `part of the JSON Schema kept for ${i.id} (${i.name})`, why: `the kept-interfaces check does not read ${list(i.unread)}, so ${i.unread.length === 1 ? "that keyword is" : "those keywords are"} not held` });
  }
  return { path: "test/kept-interfaces.test.mjs", text: filled, tests: plan.filter((i) => i.test).map((i) => i.test), could_not: couldNot };
}
