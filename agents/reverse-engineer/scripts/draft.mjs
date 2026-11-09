// Draft from the code: the one step here that wakes a model.
//
// The model is shown the codebase (its file list, and the text of the files
// that fit the reading budget, each line numbered), the facts already read by
// rule (facts.mjs), and on drift the diff since the last record and the last
// record's behaviors. It is asked for one JSON object: the behaviors, the
// architecture as built, the interfaces, what each test covers, and the gaps.
// Every claim it makes names its evidence as a file and line. It drafts, and
// nothing it says is delivered until evidence.mjs has checked it.
//
// The model is reached through the shared model caller (model-caller.mjs,
// Common Agent 12.4.1) and nothing else: which model, where it is, the
// credential and the request format are the four settings the install places,
// MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, read on every
// call. The package names no model and no address of its own. With a setting
// missing, a protocol the package's text-reasoning system does not declare,
// or the declared protocols unreadable, no call is made, and the record is
// delivered with the parts made by rule and the drafted parts marked as gaps.
//
// An answer that is not one JSON object is read for the object inside it
// first, and only when there is none is the request sent once more with a
// reminder. Never a third time.
//
//   needs: node >= 22; MODEL_NAME, MODEL_ENDPOINT, MODEL_PROTOCOL, and MODEL_KEY
//   where the endpoint asks for one
//   import { draftRecord, whyNoCall, callFor } from "./draft.mjs"
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCKFILES, linesOf } from "./codebase.mjs";
import { callModel, cannotCall, readJson } from "./model-caller.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** How much of the code the model is shown: all files together, and any one. */
export const READ_CHARS = 400_000;
export const FILE_CHARS = 60_000;
/** The answer's budget, and the seconds the whole step may take. */
export const OUTPUT_TOKENS = 32000;
export const DRAFT_SECONDS = 480;

/** The request formats the package's text-reasoning system declares, read
 *  from agent-runtime-requirements.json beside the package (one level up in
 *  the source, three in a built package's skills/<slug>/scripts/), or null. */
export function declaredProtocols(here = HERE) {
  for (const at of [join(here, "..", "agent-runtime-requirements.json"), join(here, "..", "..", "..", "agent-runtime-requirements.json")]) {
    if (!existsSync(at)) continue;
    try {
      const sys = (JSON.parse(readFileSync(at, "utf8"))?.systems ?? []).find((s) => s?.name === "text-reasoning");
      if (Array.isArray(sys?.protocols) && sys.protocols.length) return sys.protocols.map(String);
    } catch { /* an unreadable declaration is no declaration */ }
  }
  return null;
}

export const PROTOCOLS_UNREAD = "the model system's declared protocols could not be read from agent-runtime-requirements.json, so nothing was sent to the model";

/** Why no call is made, or "" when one can be. */
export function whyNoCall(env = process.env, { protocols = declaredProtocols() } = {}) {
  const read = Array.isArray(protocols) && protocols.length;
  return cannotCall(env, { protocols: read ? protocols : undefined }) || (read ? "" : PROTOCOLS_UNREAD);
}

/** The package's own call: the prompt as text through the shared caller,
 *  asking for JSON, cut at the seconds given. Answers {text, answered_by,
 *  tokens_in, tokens_out}. */
export function callFor(env = process.env, { protocols = declaredProtocols(), fetchImpl } = {}) {
  return async (prompt, { seconds = DRAFT_SECONDS, system = "" } = {}) => {
    if (!(Array.isArray(protocols) && protocols.length)) throw new Error(PROTOCOLS_UNREAD);
    const got = await callModel(prompt, {
      env, protocols, ...(fetchImpl ? { fetchImpl } : {}),
      maxOutputTokens: OUTPUT_TOKENS, json: true, system,
      timeoutMs: Math.max(1000, Math.floor(seconds * 1000)),
    });
    return { text: got.text, answered_by: got.answered_by ?? got.model ?? null, tokens_in: got.tokens_in ?? null, tokens_out: got.tokens_out ?? null };
  };
}

/** Which files the model reads, in order, inside the budget: manifests and
 *  entry points first, then source, then tests, then the rest. Lockfiles and
 *  files that are not text are never sent. Answers {sent, notSent}. */
export function chooseFiles(files, read, { only = null, first = [] } = {}) {
  const pool = (only ? files.filter((f) => only.has(f)) : files).filter((f) => !LOCKFILES.has(basename(f)));
  const rank = (f) => {
    if (first.includes(f)) return 0;
    if (["package.json", "Dockerfile", "Procfile", "go.mod", "Cargo.toml", "pyproject.toml", "requirements.txt"].includes(f)) return 1;
    if (/\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|sh)$/i.test(f) && !/(^|\/)(test|tests|__tests__|spec)\//.test(f) && !/\.(test|spec)\./.test(f)) return 2;
    if (/(^|\/)(test|tests|__tests__|spec)\//.test(f) || /\.(test|spec)\./.test(f)) return 3;
    if (/\.(json|ya?ml|toml|md|txt|graphql|proto|sql)$/i.test(f)) return 4;
    return 5;
  };
  const ordered = [...pool].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  let used = 0;
  const sent = []; const notSent = [];
  for (const f of ordered) {
    const text = read(f);
    if (text === null || text === undefined) { notSent.push({ file: f, why: "it is not text" }); continue; }
    if (text.length > FILE_CHARS) { notSent.push({ file: f, why: `it is ${text.length.toLocaleString("en-US")} characters, over the ${FILE_CHARS.toLocaleString("en-US")} one file may take` }); continue; }
    if (used + text.length > READ_CHARS) { notSent.push({ file: f, why: `the ${READ_CHARS.toLocaleString("en-US")} characters the model reads were used by the files before it` }); continue; }
    used += text.length;
    sent.push({ file: f, text });
  }
  return { sent, notSent };
}

/** A file as the model reads it: each line with its number. */
export const numbered = (file, text) => [`=== ${file}`, ...linesOf(text).map((l, i) => `${String(i + 1).padStart(5)}| ${l}`)].join("\n");

export const SYSTEM = [
  "You are the reverse engineer of the Agent Development Lifecycle.",
  "You write down what an existing codebase is: what it does, how it is built, what it reaches, and what its tests cover.",
  "You never judge whether the code is right, wrong, wanted or a bug: you describe what it does, and the person decides later.",
  "You never infer what the code was meant to do from names, comments or habit. Where the evidence stops, you say so as a gap.",
  "You never write tests and never suggest changes.",
  "Every claim names its evidence as a file and line of the code you are shown (or a range of lines). A claim you cannot point at is a gap, not a claim.",
  "A setting or credential is named, never given a value.",
  "Answer with JSON only.",
].join(" ");

/** The JSON the model is asked for, as words and a sketch. */
export const SHAPE = `{
  "behaviors": [{"id": "B1", "name": "a few words", "does": "one sentence: what the code does, in the present tense",
    "offering": "only when the code itself shows one (a command, a route, an exported function that is offered); otherwise leave it out",
    "inputs": ["what it takes"], "outputs": ["what it gives back"], "refusals": ["what it turns away, and how"],
    "error_handling": ["the error handling actually present"],
    "evidence": [{"file": "src/a.js", "line": 12, "end_line": 20}],
    "change": "drift only: new, changed or removed", "was": "drift only, for changed or removed: the id it had in the last record"}],
  "architecture": {
    "kind": {"kind": "plugin-on-harness | mesh-coded | third-party-framework | other", "why": "what in the code shows it", "evidence": [...]},
    "parts": [{"name": "...", "does": "...", "evidence": [...]}],
    "entry_points": [{"name": "...", "how": "...", "evidence": [...]}],
    "data_stores": [{"name": "...", "how": "...", "evidence": [...]}],
    "systems": [{"name": "plain system word: database, files, mail, text-reasoning, http-api...", "product": "the product the code names, if it names one", "access": "read | write | trigger", "why": "...", "evidence": [...]}],
    "networks": [{"destination": "what it reaches, by what it is (an address only if the code writes one)", "why": "...", "evidence": [...]}],
    "settings": [{"name": "VARIABLE_NAME", "credential": true, "evidence": [...]}],
    "starts_and_runs": [{"step": "...", "evidence": [...]}],
    "dependencies": [{"name": "...", "what": "agent | service | library", "why": "...", "evidence": [...]}],
    "formats": [{"direction": "in | out", "piece": "...", "kind": "a media type where the code shows one", "evidence": [...]}]
  },
  "interfaces": [{"id": "I1", "kind": "http | command | message | file | function", "name": "...", "does": "...", "evidence": [...],
    "schema": {"format": "openapi | json-schema", "document": {}}}],
  "tests": [{"file": "test/a.test.js", "covers": ["B1"], "evidence": [...]}],
  "gaps": [{"kind": "unreachable | run-time-only | unclear", "about": "...", "why": "...", "evidence": [...]}]
}`;

/** The whole prompt. */
export function promptOf({ repository, commit, files, sent, notSent, facts, drift = null }) {
  const L = [];
  L.push(`Repository: ${repository}`, `Commit: ${commit}`, "");
  if (drift) {
    L.push(`This is drift: the code changed since the last as-built record, made at commit ${drift.since}.`,
      "Describe only what changed since that record. Every new or changed behavior cites at least one changed line at this commit.",
      `A behavior that is gone cites the line it had at the last record's commit, as {"file": ..., "line": ..., "at": "${drift.since}"}, with "change": "removed".`,
      "Do not describe again anything that did not change.", "",
      "The files that changed:", ...drift.changed.map((c) => `- ${c.file} (${c.status}${c.was ? `, was ${c.was}` : ""})`), "",
      "The last record's behaviors (reuse an id in \"was\" for one that changed or is gone):",
      ...(drift.previousBehaviors.length ? drift.previousBehaviors.map((b) => `- ${b.id}: ${b.name}${b.files?.length ? ` (${b.files.join(", ")})` : ""}`) : ["- (the last record listed none)"]), "",
      "The diff:", "```diff", drift.diff, "```", "");
  }
  L.push("Every file at this commit:", ...files.map((f) => `- ${f}`), "");
  L.push("Facts already read by rule (do not repeat them as gaps; add to them only with evidence):", "```json", JSON.stringify({
    settings: facts.settings.map((s) => ({ name: s.name, at: s.evidence.map((e) => `${e.file}:${e.line}`) })),
    entry_points: facts.entry_points.map((e) => ({ name: e.name, how: e.how })),
    starts_and_runs: facts.starts_and_runs.map((s) => s.step),
    test_files: facts.tests.map((t) => t.file),
    test_command: facts.test_command.command ?? null,
    schemas_found: facts.schemas.map((s) => ({ file: s.file, format: s.format })),
  }, null, 2), "```", "");
  if (notSent.length) L.push("Files you are not shown (say nothing about what is in them; they are listed as gaps already):", ...notSent.map((n) => `- ${n.file}: ${n.why}`), "");
  L.push("The code, each line numbered:", "", ...sent.map((s) => numbered(s.file, s.text)), "");
  L.push("Answer with one JSON object of this shape:", SHAPE, "",
    "Rules for the answer:",
    "- Every behavior, part, entry point, system, interface and test entry names evidence as {file, line} or {file, line, end_line}, using the line numbers shown.",
    "- Describe what the code does, in the present tense. Do not say whether it is right, a bug, wanted, intended or correct.",
    "- Do not infer purpose from names or comments. Where you cannot tell, add a gap.",
    "- A function no path reaches is a gap of kind unreachable, never a behavior.",
    "- Behavior seen only when the code runs is a gap of kind run-time-only.",
    "- Settings and credentials by name only, never a value.",
    "- A schema is given only where the code shows the shape field by field; otherwise leave it out.",
    "- Do not write tests and do not suggest changes.");
  return L.join("\n");
}

/** The draft, read from the model: {draft, calls, used, problem}. `call` is
 *  callFor's shape. One more call, at most, when the answer has no JSON. */
export async function draftRecord({ call, prompt, seconds = DRAFT_SECONDS }) {
  const started = Date.now();
  const left = () => seconds - (Date.now() - started) / 1000;
  const used = [];
  let ask = prompt;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (left() < 30) return { draft: null, calls: attempt - 1, used, problem: "the time for drafting ran out before the model answered" };
    let got;
    try { got = await call(ask, { seconds: left(), system: SYSTEM }); } catch (e) {
      return { draft: null, calls: attempt, used, problem: `the model could not be reached: ${trim(e.message)}` };
    }
    used.push({ answered_by: got.answered_by ?? null, tokens_in: got.tokens_in ?? null, tokens_out: got.tokens_out ?? null });
    try {
      const doc = readJson(got.text);
      if (doc && typeof doc === "object" && !Array.isArray(doc)) return { draft: normalize(doc), calls: attempt, used, problem: "" };
    } catch { /* asked again below */ }
    ask = `${prompt}\n\nYour last answer was not one JSON object. Answer with the JSON object only, with no words before or after it.`;
  }
  return { draft: null, calls: 2, used, problem: "the model answered twice without one JSON object" };
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

/** The draft with every list a list, so the checks read one shape. */
export function normalize(doc) {
  const a = doc.architecture && typeof doc.architecture === "object" ? doc.architecture : {};
  return {
    behaviors: list(doc.behaviors),
    architecture: {
      kind: a.kind && typeof a.kind === "object" ? a.kind : null,
      parts: list(a.parts), entry_points: list(a.entry_points), data_stores: list(a.data_stores),
      systems: list(a.systems), networks: list(a.networks), settings: list(a.settings),
      starts_and_runs: list(a.starts_and_runs), dependencies: list(a.dependencies), formats: list(a.formats),
    },
    interfaces: list(doc.interfaces),
    tests: list(doc.tests),
    gaps: list(doc.gaps),
  };
}
