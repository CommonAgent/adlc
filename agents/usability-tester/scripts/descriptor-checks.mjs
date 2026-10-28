// What a page can draw for a person from the Descriptor alone, checked before
// anything is run. Each check answers one question a person meets on the
// agent's page, and every finding is labelled `descriptor`: the fix is in the
// Descriptor, so the stage that fixes it is design.
//
//   summary            the agent says, in one sentence, what it does for a person
//   example            every offering a person starts declares an example
//   inputs-to-controls each input a person gives maps to a control a page can
//                      draw: words, an address, a name or a file, and never
//                      structured data typed by hand
//   options-settings   options are settings with a label, a default, their
//                      choices and a label for each choice
//   presentation       each output a person meets says how they view it
//
// The members are Common Agent 6.13 (proposed): name, summary, started_by,
// given_by, presentation, label, value_labels, range and the offering's
// example (6.13.8). Pure: the Descriptor in, the findings out.
//
//   needs: node >= 22
//   import { personOfferings, descriptorChecks } from "./descriptor-checks.mjs"

const trim = (s) => String(s ?? "").trim();
const base = (k) => trim(k).split(";")[0].trim().toLowerCase();

export const PRESENTATIONS = ["quiz", "document", "facts", "table", "media", "audio", "package"];
export const VALUE_KINDS = ["text", "identifier", "url", "document"];
/** The kind of the run context a process runner hands every step (6.2). */
export const RUN_CONTEXT = /run-context/i;

/** Structured data: a person cannot be asked to type it. */
export const isStructured = (kind) => /(^|[/+])json$/.test(base(kind)) || /x-ndjson|\+xml$/.test(base(kind));
/** Words, an address or a file a person reads as it is. */
export const readsAsItIs = (kind) => /^(text\/markdown|text\/html|text\/plain|text|url|application\/pdf|text\/vtt|text\/csv)$/.test(base(kind)) || /^(image|audio|video)\//.test(base(kind));
/** An input name that reads as an option of the job rather than its material. */
const OPTION_NAME = /\b(tone|voice|length|style|format|order|depth|language|lens|palette|how many|count|max[_ ]?\w*|min[_ ]?\w*|number of)\b/i;
/** Names that hold one of those words and are material, not an option: a measure, or a list of counts. */
const NOT_AN_OPTION = /\bshare of voice\b|^counts$|\bword counts?\b/i;

/** The offerings a person starts: started_by holds person, or is absent (6.13.2). */
export function personOfferings(d) {
  const offs = Array.isArray(d?.offerings) ? d.offerings : [];
  return offs.filter((o) => !Array.isArray(o?.started_by) || o.started_by.includes("person"));
}

/** The inputs a person gives on a page: all but the run context and those only agents give. */
export function personInputs(o) {
  return (Array.isArray(o?.inputs) ? o.inputs : []).filter((i) => i && !RUN_CONTEXT.test(trim(i.kind)) && trim(i.given_by) !== "agent");
}

const F = (check, place, what, consequence) => ({ label: "descriptor", fixed_by: "design", check, place, what, consequence });

/** One sentence of at most 200 characters (6.13.1). */
export function oneSentence(s) {
  const t = trim(s);
  if (!t || t.length > 200 || /\n/.test(t)) return false;
  const stops = t.replace(/\b(e\.g|i\.e|etc|vs|Mr|Ms|Dr)\./g, "").match(/[.!?](\s|$)/g) ?? [];
  return stops.length <= 1;
}

/** Whether an example gives a value for every required input and each one_of group. */
export function exampleProblems(o, ex) {
  const out = [];
  if (!ex || typeof ex !== "object") return ["it declares no example"];
  const inputs = Array.isArray(o.inputs) ? o.inputs : [];
  const given = ex.inputs && typeof ex.inputs === "object" ? ex.inputs : null;
  if (!given || !Object.keys(given).length) out.push("its example names no inputs");
  if (!trim(ex.good_result)) out.push("its example does not say what a good result looks like (good_result)");
  if (!given) return out;
  const names = inputs.map((i) => i.name);
  for (const k of Object.keys(given)) if (!names.includes(k)) out.push(`its example gives "${k}", which is not one of its inputs`);
  for (const i of inputs) {
    if (i.one_of || !i.required || RUN_CONTEXT.test(trim(i.kind))) continue;
    if (given[i.name] === undefined) out.push(`its example gives no value for the required input "${i.name}"`);
  }
  const groups = [...new Set(inputs.map((i) => i.one_of).filter(Boolean))];
  for (const g of groups) if (!inputs.some((i) => i.one_of === g && given[i.name] !== undefined)) out.push(`its example gives none of the "${g}" inputs, one of which is needed`);
  return out;
}

/** The descriptor checks, for the whole Descriptor and each offering a person starts. */
export function descriptorChecks(d) {
  const checks = [];
  const findings = [];
  const add = (check, ok, evidence, found = []) => { checks.push({ check, result: ok ? "pass" : "fail", evidence }); findings.push(...found); };

  const name = trim(d?.name);
  const summary = trim(d?.summary);
  add("summary", Boolean(summary) && oneSentence(summary),
    summary ? `summary: "${summary}"${oneSentence(summary) ? "" : " (not one sentence of at most 200 characters)"}; name: ${name ? `"${name}"` : "absent"}` : `no summary; name: ${name ? `"${name}"` : "absent"}`,
    summary && oneSentence(summary) ? [] : [F("summary", "summary", summary ? "the summary is not one plain sentence of at most 200 characters" : "the Descriptor has no summary", "a page shows the operator's does, written for programs and models, as the first thing a person reads")]);

  const offs = personOfferings(d);
  if (!offs.length) {
    add("example", true, "no offering is started by a person, so none needs an example");
    return { checks, findings, offerings: [] };
  }

  const exFound = [];
  const exEv = [];
  for (const o of offs) {
    const p = exampleProblems(o, o.example);
    exEv.push(`${o.id}: ${o.example ? (p.length ? p.join("; ") : "an example that fills every required input, with its good result") : "no example"}`);
    for (const x of p) exFound.push(F("example", `offering ${o.id}`, x, o.example ? "a person, or a tester, cannot run the offering from its example as it stands" : "a person sees an empty form with nothing to show what a working request looks like, and nobody outside the builders can run it as a person would"));
  }
  add("example", !exFound.length, exEv.join("; "), exFound);

  const ctlFound = [];
  const ctlEv = [];
  for (const o of offs) {
    const ins = personInputs(o);
    const words = [];
    for (const i of ins) {
      const kind = trim(i.kind);
      const where = `offering ${o.id}, input "${i.name}"`;
      if (!kind) { ctlFound.push(F("inputs-to-controls", where, "the input declares no kind", "a page cannot tell whether to draw a box, an address or a file picker")); continue; }
      if (isStructured(kind) && trim(i.given_by) !== "either") ctlFound.push(F("inputs-to-controls", where, `a person is asked for ${kind} data${i.given_by ? "" : ", and nothing says another agent gives it (given_by)"}`, "a page can only offer a box to paste structured data into, or a file picker for a file the person does not have"));
      else if (!VALUE_KINDS.includes(kind) && !/^[a-z]+\/[a-z0-9][a-z0-9.+-]*$/.test(base(kind))) ctlFound.push(F("inputs-to-controls", where, `the kind "${kind}" is neither a media type nor one of ${VALUE_KINDS.join(", ")}`, "a page cannot draw a control for it"));
      if (OPTION_NAME.test(trim(i.name)) && !NOT_AN_OPTION.test(trim(i.name))) ctlFound.push(F("inputs-to-controls", where, "the input is an option of the job, not its material", "a page draws a free-text box with no default and no choices; it belongs in run_config.settings"));
      if (!trim(i.about) && !trim(i.description)) ctlFound.push(F("inputs-to-controls", where, "the input says nothing about itself (about)", "a page shows its name alone, and a person guesses what to give"));
      words.push(`${i.name} (${kind || "no kind"}${i.given_by ? `, given by ${i.given_by}` : ""})`);
    }
    ctlEv.push(`${o.id}: ${words.length ? words.join(", ") : "no input a person gives"}`);
  }
  add("inputs-to-controls", !ctlFound.length, ctlEv.join("; "), ctlFound);

  const settings = Array.isArray(d?.run_config?.settings) ? d.run_config.settings : [];
  const setFound = [];
  for (const s of settings) {
    const where = `setting "${trim(s?.name) || "?"}"`;
    const missing = [];
    if (!trim(s?.label)) missing.push("label");
    if (s?.default === undefined) missing.push("default");
    const choice = Array.isArray(s?.allowed) || OPTION_NAME.test(trim(s?.name)) || s?.kind === "rule";
    const numeric = typeof s?.default === "number";
    if (choice && !numeric && !Array.isArray(s?.allowed)) missing.push("allowed");
    if (Array.isArray(s?.allowed)) {
      const vl = s.value_labels && typeof s.value_labels === "object" ? s.value_labels : {};
      const unlabelled = s.allowed.filter((v) => !trim(vl[String(v)]));
      if (unlabelled.length) missing.push(`value_labels for ${unlabelled.map((v) => JSON.stringify(v)).join(", ")}`);
    }
    if (numeric && !Array.isArray(s?.allowed) && !(s?.range && typeof s.range === "object")) missing.push("range");
    if (missing.length) setFound.push(F("options-settings", where, `the setting does not declare ${missing.join(", ")}`, "a page draws a box to type into, or shows raw values, where a person should pick from labelled choices"));
  }
  add("options-settings", !setFound.length, settings.length ? `${settings.length} setting(s): ${settings.map((s) => trim(s?.name)).join(", ")}` : "no run-config settings are declared", setFound);

  const preFound = [];
  const preEv = [];
  for (const o of offs) {
    const outs = (Array.isArray(o.outputs) ? o.outputs : []).filter((x) => x && !x.working);
    for (const x of outs) {
      const where = `offering ${o.id}, output "${x.name}"`;
      const p = trim(x.presentation);
      if (p && !PRESENTATIONS.includes(p)) preFound.push(F("presentation", where, `its presentation "${p}" is not one of ${PRESENTATIONS.join(", ")}`, "a page reads it as not stated"));
      else if (!p) preFound.push(F("presentation", where, `it declares no presentation (its kind is ${trim(x.kind) || "not stated"})`, isStructured(x.kind) ? "a person is shown structured data as it is, with nothing to say how to read it" : "a page shows it by its kind alone"));
      preEv.push(`${o.id}/${x.name}: ${p || "no presentation"} (${trim(x.kind)})`);
    }
  }
  add("presentation", !preFound.length, preEv.join("; ") || "no outputs a person meets", preFound);

  return { checks, findings, offerings: offs.map((o) => o.id) };
}
