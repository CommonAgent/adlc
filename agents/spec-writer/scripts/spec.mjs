// Write the spec: what Requirements hands back (stages.json 1.6.0, spec-v1).
//
// The spec is the analysis of the product's functional requirements and
// capabilities: each feature with requirements a test can check and
// acceptance scenarios in Gherkin, the interfaces and which must be kept, the
// constraints, the systems it reaches or names, its settings and the open
// questions. Until 0.9.0 this agent handed back the agent's own files as the
// spec, and every detail with no place in a descriptor (the runner's stop
// pattern, a page reader's sources, the refusal's words, an output's schema)
// was lost before Test. The agent's own files are now the Design, made from
// this spec in the same job (draft.mjs).
//
// There are three ways in, and the model writes only what code cannot:
//
//   - from an as-built record: code seeds the spec (seed.mjs) with every
//     feature, requirement, exact word, interface, system and setting the
//     record fixes, and the model answers with a fill: a clear shall line for
//     each requirement, the purpose, Gherkin scenarios for every feature,
//     requirements code could not see, and open questions. Code merges the
//     fill by id and keeps every value it seeded, so nothing the record fixes
//     can be lost or reworded;
//   - from the person's words alone: the model drafts the whole spec, and
//     everything it cannot settle goes in open;
//   - a revision of an earlier spec: the person's words name what changes
//     (revise.mjs), the model answers with edits addressed by id, and code
//     applies only those; everything else stays byte for byte. A name, a
//     version or a price the words key is set by code, with no model.
//
// Each answer is checked (spec-check.mjs) and what the check finds goes back
// once, never twice; then code fits what it can without guessing and what
// still stands is said. The whole part runs inside SPEC_SECONDS (300 by
// default): no call starts without a minute left, and each is cut at what
// remains.
//
//   needs: node >= 22; MODEL_NAME, MODEL_ENDPOINT, MODEL_PROTOCOL and MODEL_KEY
//   where the endpoint asks for one, read through the shared model caller
//   ASKED=<asked.json> RECORDS=<records folder> [ANSWERS=<answers.json>] node spec.mjs
//   (writes <records>/spec.json and <records>/spec.md; draft.mjs runs this
//   part first and then the Design, so the job's commands do not change)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonIn } from "./json-in.mjs";
import { SPEC_FORMAT, loadSpecSchema, specMarkdown, validateSpec } from "./spec-v1.mjs";
import { STAND_IN_NAME, personSettled, recordOf, seedSpec } from "./seed.mjs";
import { corpusOf, fitSpec, specProblems } from "./spec-check.mjs";
import { applyEdits, keyedEdits, namedTargets, personWords, unchangedProblems } from "./revise.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** The time this part may take, every call included, unless SPEC_SECONDS
 *  says otherwise. */
export const SPEC_SECONDS = 300;
export const MIN_CALL_SECONDS = 60;
export const TRIES = 2;
export const JSON_RETRIES = 1;
export class NoSpec extends Error {}

export const specSecondsOf = (env = {}) => { const n = Number(trim(env.SPEC_SECONDS)); return Number.isFinite(n) && n > 0 ? n : SPEC_SECONDS; };

/** The digest the spec is delivered against: sha256 over its bytes. */
export const specDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Is this attachment a spec (spec-v1)? Told by its format, never its name. */
export const isSpecV1 = (doc) => isObj(doc) && trim(doc.format) === SPEC_FORMAT;

/** The earlier spec a revision changes: one attached (kind "the spec"), or
 *  the newest an earlier job of this agent wrote under the records root.
 *  Null when there is none. */
export function earlierSpecOf(asked = null, { recordsRoot = null, io = {} } = {}) {
  for (const a of list(asked?.attached)) {
    if (a?.missing || typeof a?.text !== "string") continue;
    try { const d = JSON.parse(a.text); if (isSpecV1(d)) return { spec: d, from: a.name }; } catch { /* not JSON */ }
  }
  const ls = io.list ?? ((d) => readdirSync(d));
  const exists = io.exists ?? existsSync;
  const mtime = io.mtime ?? ((p) => statSync(p).mtimeMs);
  const read = io.read ?? ((p) => readFileSync(p, "utf8"));
  if (!recordsRoot || !exists(recordsRoot)) return null;
  let best = null;
  for (const name of ls(recordsRoot)) {
    const p = join(recordsRoot, name, "spec.json");
    if (!exists(p)) continue;
    const t = mtime(p);
    if (!best || t > best.t) best = { p, t };
  }
  if (!best) return null;
  try { const d = JSON.parse(read(best.p)); return isSpecV1(d) ? { spec: d, from: best.p } : null; } catch { return null; }
}

/** The part of the reference about the spec, and the part about the agent's
 *  own files (the Design), split at the heading that starts the second. */
export function referenceParts(text = "") {
  const t = String(text);
  const at = t.search(/^# The agent's own files/m);
  return at < 0 ? { spec: t, design: t } : { spec: t.slice(0, at).trim(), design: t.slice(at).trim() };
}

export const SPEC_INSTRUCTION = `You are writing a spec (spec-v1): the analysis of a product's functional
requirements and capabilities. It says what the product must do and how
anyone can tell that it does, in a form a test writer can write tests from
without guessing. It is not the agent's descriptor or any file a package is
built from: those are made later, from this spec.

Each feature is one capability, with requirements and acceptance criteria.
Each requirement is one statement written with "shall" ("The agent shall
..."), with its kind, the exact words, patterns and numbers it fixes (each in
exact, as it must appear, byte for byte), its rationale, its priority (must,
should or may), its source and how it is verified (inspection, analysis,
demonstration or test). Each acceptance criterion is one Gherkin scenario,
as text: a "Scenario:" line, then "Given", "When" and "Then" steps ("And" and
"But" allowed), checking named requirement ids.

Three things you must never invent, because they are not yours to choose:
the product's name, its price, and access to any system. Where the person
did not settle one, leave it out and put it in open with the question. Never
write a value in exact that nothing given states: ask it in open instead.
Write plainly, in whole sentences.`;

export const FILL_RULE = `Code has already written the spec from the as-built record, given below as
THE SPEC SO FAR. Its ids, kinds, exact values, sources, interfaces, systems
and settings are the record's and code keeps them whatever you answer, so do
not repeat them. Write what code could not:
- "shall": for every requirement, one clear statement with "shall" saying
  what the agent shall do, in plain words, keeping its meaning. Do not copy
  the exact values into it; they are kept in exact.
- "acceptance": for every feature, one or more Gherkin scenarios that check
  its requirements, each with "checks" naming the requirement ids it checks.
  A scenario that checks a requirement with exact values says them in its
  Then steps, written as they are in exact.
- "add": a requirement the record's words for a feature imply and code did
  not write, only where the record says it; never with a value the record
  does not state.
- "purpose": a few sentences on what the product is for and who it serves;
  "users": who uses it and what each wants.
- "constraints": requirements on the whole product the record states.
- "open": what only the person can settle, each with its question.

Answer with one JSON object and nothing else:
{"purpose": "...", "users": [{"who": "...", "wants": "..."}],
 "features": {"F1": {"shall": {"F1.R1": "The agent shall ..."},
   "acceptance": [{"gherkin": "Scenario: ...\\n  Given ...\\n  When ...\\n  Then ...", "checks": ["F1.R1"]}],
   "add": [{"shall": "The agent shall ...", "kind": "behavior", "verify": "test"}]}},
 "constraints": [{"shall": "...", "kind": "performance", "verify": "test"}],
 "open": [{"key": "...", "question": "..."}],
 "notes": "what you wrote that the record did not settle"}`;

export const DRAFT_RULE = `There is no as-built record: write the whole spec from what the person
said and what they attached. Every feature has requirements and at least one
acceptance scenario; every requirement comes from their words, and its
source says which ("said"). Interfaces are only those they name; an
interface is keep: false unless they say it must stay as it is. Systems are
only those they name. Put everything you cannot settle from their words in
open, each with its question. Answer with one JSON object and nothing else:
{"spec": { ...a spec-v1 document, format "spec-v1"... }, "notes": "what you drafted that they did not settle"}`;

export const EDIT_RULE = `This is a revision of the spec given below as THE SPEC AS IT STANDS. The
person's words above name what changes. Answer with edits, each addressed to
one part of the spec by its id, and change nothing their words do not name:
code applies only edits to what the words name, and every other part of the
spec stays exactly as it is. An edit is one of:
  {"set": "<path>", "value": <the whole new item or value>}
  {"remove": "<path>"}
  {"add": "<where>", "value": <the new item, with no id>}
A path is purpose, price, product.name, product.version, a feature (F3), a
requirement (F3.R2), a scenario (F3.A1), a constraint (C2), an interface
(I4), system:<name>, setting:<name> or open:<key>. Where is features,
constraints, interfaces, systems, settings, open, F3.requirements or
F3.acceptance. Code gives every added item its id. When the words answer an
open question, remove it and set what it settles. Answer with one JSON
object and nothing else: {"edits": [...], "notes": "what you changed and why"}`;

const JSON_ONLY = "Answer with exactly one JSON object and nothing else: no words before or after it, no code fence, no comments and no trailing commas.";

/** The record's parts, the schemas and an earlier spec are given their own
 *  way; every other text attachment goes to the model as it came. */
function otherAttachments(asked, record) {
  const out = [];
  for (const a of list(asked?.attached)) {
    if (a?.missing || typeof a?.text !== "string" || !trim(a.text)) continue;
    if (["an agent's own file", "a spec", "the spec", "an architecture record"].includes(a.kind)) continue;
    if (record) { try { const d = JSON.parse(a.text); if (isObj(d) && (/^as-built-/.test(trim(d.format)) || d.as_built === true || d.$schema || d.type)) continue; } catch { /* words */ } }
    out.push(`--- ${String(a.name).toUpperCase()}, AS ATTACHED ---\n${trim(a.text)}`);
  }
  return out;
}

/** The request for one go, as text. Pure. */
export function specPrompt({ mode, asked = null, answers = null, seed = null, earlier = null, words = "", targets = null, reference = "", findings = [], notJson = "", record = null, schemaText = "" } = {}) {
  const parts = [SPEC_INSTRUCTION];
  parts.push(`--- WHAT THEY ASKED FOR ---\n${trim(asked?.said) || "(nothing was said in words)"}`);
  if (isObj(answers) && Object.keys(answers).length) parts.push(`--- THEY HAVE SINCE ANSWERED ---\n${Object.entries(answers).map(([k, v]) => `${k}: ${trim(v)}`).join("\n")}`);
  parts.push(...otherAttachments(asked, record));
  if (mode === "seeded") parts.push(`--- THE SPEC SO FAR ---\n${JSON.stringify(seed, null, 2)}`, `--- WHAT YOU WRITE ---\n${FILL_RULE}`);
  if (mode === "drafted") parts.push(`--- WHAT YOU WRITE ---\n${DRAFT_RULE}`, ...(trim(schemaText) ? [`--- THE SPEC'S SCHEMA (standards/spec.schema.json) ---\n${trim(schemaText)}`] : []));
  if (mode === "revision") {
    parts.push(`--- THEIR WORDS, WHICH NAME WHAT CHANGES ---\n${trim(words) || "(none)"}`);
    parts.push(`--- WHAT THEIR WORDS NAME ---\n${[...(targets ?? [])].join("\n") || "(nothing in the spec)"}\nOnly these may change.`);
    parts.push(`--- THE SPEC AS IT STANDS ---\n${JSON.stringify(earlier, null, 2)}`, `--- WHAT YOU WRITE ---\n${EDIT_RULE}`);
  }
  if (trim(reference)) parts.push(`--- WHAT A GOOD SPEC CARRIES ---\n${trim(reference)}`);
  if (findings.length) parts.push(`--- WHAT WAS WRONG WITH YOUR LAST ANSWER ---\n${findings.map((f) => `- ${f}`).join("\n")}\nAnswer again with these fixed. Change nothing else.`);
  if (trim(notJson)) parts.push(`--- YOUR LAST ANSWER COULD NOT BE READ ---\n${trim(notJson)}.\n${JSON_ONLY}`);
  return parts.join("\n\n");
}

const KINDS = new Set(["behavior", "input", "output", "refusal", "error", "limit", "order", "wording", "pattern", "default", "interface", "security", "performance", "runtime"]);
const VERIFY = new Set(["inspection", "analysis", "demonstration", "test"]);
const PRIORITY = new Set(["must", "should", "may"]);

/** A requirement the model wrote, held to the fields spec-v1 gives one. */
function requirementFrom(x, id, source) {
  if (!isObj(x) || !/\bshall\b/.test(String(x.shall ?? ""))) return null;
  return {
    id, shall: trim(x.shall), kind: KINDS.has(trim(x.kind)) ? trim(x.kind) : "behavior",
    ...(list(x.exact).length ? { exact: x.exact.map(String) } : {}),
    ...(trim(x.rationale) ? { rationale: trim(x.rationale) } : {}),
    priority: PRIORITY.has(trim(x.priority)) ? trim(x.priority) : "must",
    source: isObj(x.source) ? x.source : source,
    verify: VERIFY.has(trim(x.verify)) ? trim(x.verify) : "test",
  };
}

/** The seed with the model's fill merged in by id. Every value code seeded
 *  stays; the model's shall lines, scenarios, added requirements, purpose,
 *  users, constraints and open questions go in. Pure. */
export function mergeFill(seed, fill) {
  const s = structuredClone(seed);
  if (!isObj(fill)) return s;
  if (trim(fill.purpose)) s.purpose = trim(fill.purpose);
  const users = list(fill.users).filter((u) => isObj(u) && trim(u.who) && trim(u.wants)).map((u) => ({ who: trim(u.who), wants: trim(u.wants) }));
  if (users.length) s.users = users;
  const byId = isObj(fill.features) ? fill.features : Object.fromEntries(list(fill.features).filter((f) => isObj(f) && trim(f.id)).map((f) => [trim(f.id), f]));
  for (const f of list(s.features)) {
    const got = byId[f.id];
    if (!isObj(got)) continue;
    const shall = isObj(got.shall) ? got.shall : {};
    for (const r of f.requirements) if (/\bshall\b/.test(String(shall[r.id] ?? ""))) r.shall = trim(shall[r.id]);
    for (const x of list(got.add)) {
      const r = requirementFrom(x, `${f.id}.R${f.requirements.length + 1}`, { behavior: trim(f.as_built) || undefined, said: "drafted from the record's words for this behavior" });
      if (r) f.requirements.push(r);
    }
    const ids = new Set(f.requirements.map((r) => r.id));
    const acc = list(got.acceptance).filter((a) => isObj(a) && trim(a.gherkin)).map((a) => ({ gherkin: String(a.gherkin).replace(/\r/g, ""), checks: list(a.checks).map(trim).filter((c) => ids.has(c) || /^C[1-9]\d*$/.test(c)) }));
    if (acc.length) f.acceptance = acc.map((a, i) => ({ id: `${f.id}.A${i + 1}`, ...a }));
  }
  for (const x of list(fill.constraints)) {
    const r = requirementFrom(x, `C${list(s.constraints).length + 1}`, { said: "drafted from the record" });
    if (r) (s.constraints ??= []).push(r);
  }
  const keys = new Set(list(s.open).map((o) => trim(o.key)));
  for (const o of list(fill.open)) if (isObj(o) && trim(o.key) && trim(o.question) && !keys.has(trim(o.key))) { (s.open ??= []).push({ key: trim(o.key), question: trim(o.question) }); keys.add(trim(o.key)); }
  return s;
}

/** A spec the model drafted whole, held to what is the person's: the format,
 *  the source and the product as they settled it. Pure. */
export function draftedSpec(doc, person = {}) {
  const s = isObj(doc) ? structuredClone(doc) : {};
  s.format = SPEC_FORMAT;
  s.product = { ...(isObj(s.product) ? s.product : {}), name: person.name ?? STAND_IN_NAME, version: person.version ?? (/^\d+\.\d+\.\d+$/.test(trim(s.product?.version)) ? trim(s.product.version) : "0.1.0"), kind: trim(s.product?.kind) || "agent" };
  s.source = { kind: "account" };
  for (const k of ["features", "open"]) if (!Array.isArray(s[k])) s[k] = [];
  for (const f of s.features) {
    if (!isObj(f)) continue;
    f.requirements = list(f.requirements).map((r, i) => ({ ...r, id: `${f.id}.R${i + 1}` }));
    const ids = new Map(list(doc?.features?.find?.((x) => x?.id === f.id)?.requirements).map((r, i) => [trim(r?.id), `${f.id}.R${i + 1}`]));
    f.acceptance = list(f.acceptance).map((a, i) => ({ ...a, id: `${f.id}.A${i + 1}`, checks: list(a?.checks).map((c) => ids.get(trim(c)) ?? trim(c)) }));
  }
  return s;
}

/** Ask, check what came back, and ask once more with the findings: the
 *  spec's own loop, in the shape of draft.mjs's. `build(findings, notJson,
 *  last)` makes the prompt; `read(doc, last)` makes a candidate spec from an
 *  answer; `check(spec)` finds what is wrong. Returns the last candidate,
 *  its findings, the calls made, what each used, and why the asking
 *  stopped early, when it did. */
export async function askTwice({ call, build, read, check, tries = TRIES, jsonRetries = JSON_RETRIES, seconds = SPEC_SECONDS, minCallSeconds = MIN_CALL_SECONDS, now = Date.now } = {}) {
  if (typeof call !== "function") throw new Error("the spec step needs a call");
  const deadline = now() + 1000 * seconds;
  const left = () => (deadline - now()) / 1000;
  let last = null; let findings = []; let calls = 0; let notJson = ""; let retries = jsonRetries; let stopped = null; let notes = "";
  const used = [];
  for (let go = 0; go < tries;) {
    if (left() < minCallSeconds) { stopped = "the spec step ran out of time"; break; }
    const prompt = build(last ? findings : [], notJson, last);
    calls += 1;
    let said;
    try { const got = await call(prompt, { seconds: left() }); said = typeof got === "string" ? { text: got } : got; } catch (e) { if (!last) throw new NoSpec(e.message); stopped = e.message; break; }
    used.push({ model: said?.answered_by ?? null, ...(said?.usage ?? { tokens_in: null, tokens_out: null, cost: null }) });
    const doc = jsonIn(trim(said?.text));
    if (!isObj(doc)) {
      const why = trim(said?.text) ? "the service did not answer with one JSON object" : "the service answered with nothing";
      if (retries > 0) { retries -= 1; notJson = why; continue; }
      if (!last) throw new NoSpec(why);
      stopped = why; break;
    }
    notJson = "";
    last = read(doc, last);
    notes = trim(doc.notes) || notes;
    findings = check(last);
    go += 1;
    if (!findings.length) break;
  }
  if (!last) throw new NoSpec(stopped ?? "the service gave no spec");
  return { spec: last, findings, calls, used, notes, stopped: findings.length ? stopped : null };
}

/** The prompt sent as plain text, the way draft.mjs's call takes a request. */
const asRequest = (prompt) => ({ body: { contents: [{ parts: [{ text: prompt }] }] } });

/** Write the spec: from an earlier spec and the person's words (a revision),
 *  from an as-built record, or from the words alone. `call(request, {seconds})`
 *  is the model call (draft.mjs's callFor). Returns { spec, mode, notes,
 *  findings, calls, used, stopped, revised }. */
export async function writeTheSpec({ asked = null, answers = null, call, reference = "", recordsRoot = null, seconds = SPEC_SECONDS, minCallSeconds = MIN_CALL_SECONDS, now = Date.now, io = {} } = {}) {
  const record = recordOf(asked, io.read ? { read: io.read } : {});
  const earlierFound = asked?.revision ? earlierSpecOf(asked, { recordsRoot, io }) : null;
  const earlier = earlierFound?.spec ?? null;
  const said = [String(asked?.said ?? ""), ...Object.values(isObj(answers) ? answers : {}).filter((v) => typeof v === "string")];
  const corpus = corpusOf(asked, answers, { record, earlier });
  const modelCall = (prompt, o) => call(asRequest(prompt), o);
  const { spec: specReference } = referenceParts(reference);
  const run = (opts) => askTwice({ call: modelCall, seconds, minCallSeconds, now, ...opts });

  if (earlier) {
    // A revision: the person's words, keyed edits by code, then the model's
    // edits to what the words name, and nothing else.
    // The person's words: what they said, and any answer keyed apart from it
    // (the gathering step keeps their whole message as "said" as well).
    const words = personWords([asked?.said, ...Object.entries(isObj(answers) ? answers : {}).filter(([k, v]) => k !== "said" && typeof v === "string").map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join("\n"));
    const targets = namedTargets(words, earlier);
    const keyed = keyedEdits(earlier, words);
    const settled = personSettled([words]);
    const person = {
      name: settled.name ?? (trim(earlier.product?.name) !== STAND_IN_NAME ? trim(earlier.product?.name) : null),
      version: settled.version ?? trim(earlier.product?.version),
      price: settled.price ?? (trim(earlier.price) || null),
    };
    const modelTargets = new Set([...targets].filter((t) => !(t === "product.name" && settled.name) && !(t === "price" && settled.price) && !(t === "product.version" && settled.version)));
    const checkOf = (s) => [...specProblems(s, { record, corpus, person }), ...unchangedProblems(earlier, s, targets)];
    let out;
    if (!modelTargets.size) {
      const s = keyed.spec;
      out = { spec: s, findings: checkOf(s), calls: 0, used: [], notes: "", stopped: null };
    } else {
      const dropped = [];
      out = await run({
        build: (findings, notJson, last) => specPrompt({ mode: "revision", asked, answers, earlier: last ?? keyed.spec, words, targets: modelTargets, reference: specReference, findings, notJson, record }),
        read: (doc, last) => { const r = applyEdits(last ?? keyed.spec, list(doc.edits), targets); dropped.push(...r.dropped); return r.spec; },
        check: checkOf,
      });
      out.dropped = dropped;
    }
    const fit = fitSpec(out.spec, { person, corpus });
    const findings = [...specProblems(fit.spec, { record, corpus, person }), ...unchangedProblems(earlier, fit.spec, targets)];
    const named = [...targets];
    const notes = [
      named.length ? "" : "Your words name nothing in the spec, so it stays as it was; they go to the agent's own files.",
      keyed.applied.length ? `Code ${keyed.applied.join(", ")} from your words.` : "",
      out.notes,
      ...(out.dropped ?? []).map((d) => `An edit was not applied, because ${d.why}.`),
      ...fit.notes,
    ].filter(Boolean).join(" ");
    return { spec: fit.spec, mode: "revision", notes, findings, calls: out.calls, used: out.used, stopped: out.stopped, revised: { from: earlierFound.from, targets: named, changed: changedPaths(earlier, fit.spec) } };
  }

  const person = personSettled(said);
  const check = (s) => specProblems(s, { record, corpus, person });
  let out;
  if (record) {
    const seed = seedSpec(record, { said: asked?.said ?? "", answers });
    out = await run({
      build: (findings, notJson, last) => specPrompt({ mode: "seeded", asked, answers, seed: last ?? seed, reference: specReference, findings, notJson, record }),
      read: (doc, last) => mergeFill(last ?? seed, doc),
      check,
    });
  } else {
    let schemaText = "";
    try { schemaText = JSON.stringify(loadSpecSchema(), null, 2); } catch { /* the check still holds the spec to it */ }
    out = await run({
      build: (findings, notJson) => specPrompt({ mode: "drafted", asked, answers, reference: specReference, findings, notJson, schemaText }),
      read: (doc) => draftedSpec(isObj(doc.spec) ? doc.spec : doc, person),
      check,
    });
  }
  const fit = fitSpec(out.spec, { person, corpus });
  return {
    spec: fit.spec, mode: record ? "seeded" : "drafted",
    notes: [out.notes, ...fit.notes].filter(Boolean).join(" "),
    findings: specProblems(fit.spec, { record, corpus, person }),
    calls: out.calls, used: out.used, stopped: out.stopped,
  };
}

/** The paths that differ between two specs, for the reply. */
export function changedPaths(before, after) {
  const out = [];
  const diff = (p, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(p); };
  diff("product.name", before?.product?.name, after?.product?.name);
  diff("product.version", before?.product?.version, after?.product?.version);
  diff("price", before?.price, after?.price);
  diff("purpose", before?.purpose, after?.purpose);
  const ids = (s) => [...list(s?.features).flatMap((f) => [f.id, ...list(f.requirements).map((r) => r.id), ...list(f.acceptance).map((a) => a.id)]), ...list(s?.constraints).map((c) => c.id), ...list(s?.interfaces).map((i) => i.id)];
  const find = (s, id) => {
    for (const f of list(s?.features)) {
      if (f.id === id) { const { requirements, acceptance, ...rest } = f; return rest; }
      for (const x of [...list(f.requirements), ...list(f.acceptance)]) if (x.id === id) return x;
    }
    return [...list(s?.constraints), ...list(s?.interfaces)].find((x) => x.id === id);
  };
  for (const id of new Set([...ids(before), ...ids(after)])) diff(id, find(before, id), find(after, id));
  for (const k of ["systems", "settings", "open"]) diff(k, before?.[k], after?.[k]);
  return out;
}

/** Counts a reader is told: features, requirements by kind, scenarios,
 *  interfaces kept, open questions. */
export function specCounts(spec) {
  const kinds = {};
  let requirements = 0;
  for (const f of list(spec?.features)) for (const r of list(f.requirements)) { requirements += 1; kinds[r.kind] = (kinds[r.kind] ?? 0) + 1; }
  return {
    features: list(spec?.features).length, requirements, by_kind: kinds,
    acceptance: list(spec?.features).reduce((n, f) => n + list(f.acceptance).length, 0),
    constraints: list(spec?.constraints).length,
    interfaces: list(spec?.interfaces).length, interfaces_kept: list(spec?.interfaces).filter((i) => i.keep === true).length,
    systems: list(spec?.systems).length, settings: list(spec?.settings).length, open: list(spec?.open).length,
  };
}

/** Write the spec and its readable twin under the records folder. Returns
 *  { json, md, sha256 }. */
export function keepSpec(records, spec) {
  mkdirSync(records, { recursive: true });
  const json = JSON.stringify(spec, null, 2) + "\n";
  const md = specMarkdown(spec);
  writeFileSync(join(records, "spec.json"), json);
  writeFileSync(join(records, "spec.md"), md);
  return { json: join(records, "spec.json"), md: join(records, "spec.md"), sha256: specDigest(json), md_sha256: specDigest(md) };
}

export { validateSpec };

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const env = process.env;
  const { ASKED, RECORDS, ANSWERS } = env;
  if (!ASKED || !RECORDS) { console.error("ASKED and RECORDS are required"); process.exit(2); }
  try {
    const { callFor, declaredProtocols, whyNoCall, referenceAt } = await import("./draft.mjs");
    const asked = JSON.parse(readFileSync(ASKED, "utf8"));
    const answers = ANSWERS && existsSync(ANSWERS) ? JSON.parse(readFileSync(ANSWERS, "utf8")) : null;
    const protocols = declaredProtocols();
    const why = whyNoCall(env, { protocols });
    if (why) { console.log(JSON.stringify({ ok: false, code: 1, reply: `The spec was not written: ${why}.` })); process.exit(1); }
    const ref = referenceAt(env);
    const out = await writeTheSpec({ asked, answers, call: callFor(env, { protocols }), reference: ref ? readFileSync(ref, "utf8") : "", recordsRoot: dirname(resolve(RECORDS)), seconds: specSecondsOf(env) });
    const kept = keepSpec(RECORDS, out.spec);
    console.log(JSON.stringify({ ok: true, code: 0, spec: kept.json, md: kept.md, mode: out.mode, counts: specCounts(out.spec), findings: out.findings, calls: out.calls }));
  } catch (e) {
    console.error(e.message);
    if (e instanceof NoSpec) { console.log(JSON.stringify({ ok: false, code: 4, reply: `The spec was not written: ${e.message}. Nothing was delivered. You can ask again.` })); process.exitCode = 4; }
    else process.exitCode = 1;
  }
}
