// Draft from the code: the one step here that wakes a model.
//
// On adoption the draft is made in bounded passes, so no one answer has to
// hold the whole codebase:
//   - one pass for the architecture as built, the interfaces and the gaps,
//     shown every file that fits the reading budget;
//   - behavior passes, each shown a few source files whole (PASS_CHARS at
//     most, MAX_BEHAVIOR_PASSES passes at most, PARALLEL at a time), asked
//     for the behaviors of those files only, one per anchor (kinds.mjs);
//   - one pass for what each test covers, shown the test files and the
//     behaviors the passes before it drafted.
// Every pass is shown the facts already read by rule (facts.mjs and
// surface.mjs): the exports, the files written and the shape read off them,
// the commands and their flags, the patterns and the constants. The model
// describes and links them; it does not have to recall them. Each pass is
// one call (and one more only when its answer has no JSON), and each is
// recorded in calls.json. A pass that fails leaves its part as a gap; the
// others stand.
//
// On drift the draft is one pass, shown only the changed files, the diff and
// the last record's behaviors, because a change is small next to a codebase.
//
// Nothing a pass says is delivered until evidence.mjs and behaviors.mjs have
// checked it.
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
//   needs: node >= 22; MODEL_NAME, MODEL_ENDPOINT, MODEL_PROTOCOL, and MODEL_KEY
//   where the endpoint asks for one
//   import { draftInPasses, draftRecord, whyNoCall, callFor } from "./draft.mjs"
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCKFILES, linesOf, slash } from "./codebase.mjs";
import { callModel, cannotCall, readJson } from "./model-caller.mjs";
import { BEHAVIOR_KINDS, GRANULARITY, RULE_KINDS, kindLines } from "./kinds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** How much of the code the architecture pass is shown: all files together,
 *  and any one. */
export const READ_CHARS = 400_000;
export const FILE_CHARS = 60_000;
/** A behavior pass: the most characters of code it is shown, how many there
 *  may be, and how many run at once. */
export const PASS_CHARS = 80_000;
export const MAX_BEHAVIOR_PASSES = 12;
export const PARALLEL = 4;
/** Each answer's budget, and the seconds the whole step may take. */
export const OUTPUT_TOKENS = 32000;
export const DRAFT_SECONDS = 480;

/** Source files that hold behaviors: code, not tests. */
const CODE_FILE = /\.(m?[jt]sx?|cjs|cts|mts|py|go|rs|java|kt|rb|php|cs|sh|bash)$/i;
const TEST_PATH = (f) => /(^|\/)(test|tests|__tests__|spec)\//.test(f) || /\.(test|spec)\./.test(f) || /(^|\/)test_[^/]*\.py$/.test(f) || /_test\.go$/.test(f);

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
export function chooseFiles(files, read, { only = null, first = [], budget = READ_CHARS } = {}) {
  const pool = (only ? files.filter((f) => only.has(f)) : files).filter((f) => !LOCKFILES.has(basename(f)));
  const rank = (f) => {
    if (first.includes(f)) return 0;
    if (["package.json", "Dockerfile", "Procfile", "go.mod", "Cargo.toml", "pyproject.toml", "requirements.txt"].includes(f)) return 1;
    if (CODE_FILE.test(f) && !TEST_PATH(f)) return 2;
    if (TEST_PATH(f)) return 3;
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
    if (used + text.length > budget) { notSent.push({ file: f, why: `the ${budget.toLocaleString("en-US")} characters the model reads were used by the files before it` }); continue; }
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
  "Exact words matter: a pattern, a magic string or a sentence other code depends on is copied from the code byte for byte.",
  "A setting or credential is named, never given a value.",
  "Answer with JSON only.",
].join(" ");

const BEHAVIOR_SHAPE = `{"id": "B1", "anchor": "the anchor it describes: scripts/a.mjs#readThing, or scripts/a.mjs for a command's main block",
    "kind": "${BEHAVIOR_KINDS.map((k) => k.kind).join(" | ")}",
    "name": "a few words", "does": "one sentence: what the code does, in the present tense",
    "offering": "only when the code itself shows one (a command, a route, an exported function that is offered); otherwise leave it out",
    "inputs": ["what it takes"], "outputs": ["what it gives back"], "refusals": ["what it turns away, and how"],
    "error_handling": ["the error handling actually present"],
    "quotes": [{"what": "what the words are, such as the stop notice pattern or the reply when nothing loads", "text": "copied from the code byte for byte", "evidence": [{"file": "src/a.js", "line": 4}]}],
    "rules": [{"kind": "${RULE_KINDS.map((k) => k.kind).join(" | ")}", "rule": "one sentence", "quote": "optional: the code that states it, byte for byte", "evidence": [{"file": "src/a.js", "line": 9}]}],
    "evidence": [{"file": "src/a.js", "line": 12, "end_line": 20}]}`;

const ARCHITECTURE_SHAPE = `{
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
  }`;

const INTERFACE_SHAPE = `{"id": "I1", "kind": "http | command | message | file | function", "name": "...", "does": "...",
    "export": "for a function read by rule: its module#name", "returns": "for a function: what it gives back",
    "path": "for a file read by rule: its path", "command": "for a command read by rule: its file",
    "evidence": [...], "schema": {"format": "openapi | json-schema", "document": {}}}`;

const GAP_SHAPE = `{"kind": "unreachable | run-time-only | unclear", "about": "...", "why": "...", "evidence": [...]}`;

/** The JSON the single drift pass is asked for, as words and a sketch. */
export const SHAPE = `{
  "behaviors": [${BEHAVIOR_SHAPE.replace(/}$/, `,
    "change": "drift only: new, changed or removed", "was": "drift only, for changed or removed: the id it had in the last record"}`)}],
  "architecture": ${ARCHITECTURE_SHAPE},
  "interfaces": [${INTERFACE_SHAPE}],
  "tests": [{"file": "test/a.test.js", "covers": ["B1"], "evidence": [...]}],
  "gaps": [${GAP_SHAPE}]
}`;
export const SHAPE_ARCHITECTURE = `{\n  "architecture": ${ARCHITECTURE_SHAPE},\n  "interfaces": [${INTERFACE_SHAPE}],\n  "gaps": [${GAP_SHAPE}]\n}`;
export const SHAPE_BEHAVIORS = `{\n  "behaviors": [${BEHAVIOR_SHAPE}],\n  "gaps": [${GAP_SHAPE}]\n}`;
export const SHAPE_TESTS = `{\n  "tests": [{"file": "test/a.test.js", "covers": ["B1"], "evidence": [{"file": "test/a.test.js", "line": 5, "end_line": 9}]}]\n}`;

const RULES_COMMON = [
  "- Every claim names evidence as {file, line} or {file, line, end_line}, using the line numbers shown.",
  "- Describe what the code does, in the present tense. Do not say whether it is right, a bug, wanted, intended or correct.",
  "- Do not infer purpose from names or comments. Where you cannot tell, add a gap.",
  "- Settings and credentials by name only, never a value.",
  "- Do not write tests and do not suggest changes.",
];
const RULES_BEHAVIORS = [
  "- Each behavior has a kind from the list; when more than one fits, the first in the list is the kind.",
  "- Quote exactly, in quotes, every pattern or wording other components depend on: regular expressions (as written, slashes and flags included), magic strings and format ids, reply sentences and refusals (a template as written, ${...} included), notices it recognizes. The text must be in the cited lines byte for byte; a quote that is not is dropped.",
  "- State as rules, each with its evidence: the order things are tried in (which source is tried first, then next), the limits (caps, timeouts, sizes, counts), the request headers it sends, and the defaults it falls back to. Give the number or the words as the code has them.",
  "- A function no anchor reaches is a gap of kind unreachable, never a behavior. Behavior seen only when the code runs is a gap of kind run-time-only.",
];

/** The facts read by rule, as the prompt shows them; `only` limits the
 *  surface to some files. */
export function factsShown(facts, { only = null, patterns = false } = {}) {
  const s = facts.surface ?? { anchors: [], exports: [], entries: [], writes: [], patterns: [], constants: [], outside: [], flags: [] };
  const inF = (f) => !only || only.has(f);
  const at = (e) => e.map((x) => `${x.file}:${x.line}`);
  return {
    ...(only ? {} : {
      settings: facts.settings.map((x) => ({ name: x.name, at: at(x.evidence) })),
      declared_settings: (facts.declared_settings ?? []).map((x) => x.name),
      entry_points: facts.entry_points.map((e) => ({ name: e.name, how: e.how })),
      starts_and_runs: facts.starts_and_runs.map((x) => x.step),
      test_files: facts.tests.map((t) => t.file),
      test_command: facts.test_command.command ?? null,
      schemas_found: facts.schemas.map((x) => ({ file: x.file, format: x.format })),
      imports_outside_the_codebase: s.outside.map((o) => `${o.file}:${o.line} imports ${o.spec}`),
    }),
    ...(only ? { settings_read_here: facts.settings.filter((x) => x.evidence.some((e) => inF(e.file))).map((x) => ({ name: x.name, at: at(x.evidence.filter((e) => inF(e.file))) })) } : {}),
    anchors: s.anchors.filter((a) => inF(a.module)).map((a) => ({ anchor: a.id, kind: a.kind, line: a.line, why: a.why })),
    exports: s.exports.filter((e) => inF(e.module)).map((e) => ({
      export: `${e.module}#${e.name}`, kind: e.kind, line: e.line,
      ...(e.kind === "function" ? { async: e.async, params: e.params, ...(e.throws?.length ? { throws: e.throws.map((t) => t.error ?? `rethrows ${t.rethrows}`) } : {}) } : {}),
      ...(e.value !== undefined ? { value: e.value } : {}),
      ...(e.imported_by?.length ? { imported_by: e.imported_by } : {}),
    })),
    commands: s.entries.filter((e) => inF(e.file)).map((e) => ({ command: e.file, why: e.why, flags: e.flags ?? [] })),
    files_written: s.writes.filter((w) => w.evidence.some((e) => inF(e.file))).map((w) => ({ path: w.path ?? `(named by ${w.written_as})`, content: w.content, at: at(w.evidence), ...(w.schema ? { schema_read_by_rule: w.schema } : {}) })),
    ...(patterns ? {
      patterns: s.patterns.filter((p) => inF(p.file)).map((p) => ({ at: `${p.file}:${p.line}`, ...(p.name ? { name: p.name } : {}), text: p.text })),
      constants: s.constants.filter((c) => inF(c.file)).map((c) => ({ at: `${c.file}:${c.line}`, name: c.name, ...(c.value !== undefined ? { value: c.value } : {}) })),
    } : { flags: s.flags.map((f) => f.name) }),
  };
}

const header = (repository, commit) => [`Repository: ${repository}`, `Commit: ${commit}`, ""];
const json = (v) => ["```json", JSON.stringify(v, null, 2), "```"];

/** The single drift prompt (and an adoption one, when passes are not used). */
export function promptOf({ repository, commit, files, sent, notSent, facts, drift = null }) {
  const L = header(repository, commit);
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
  L.push("Facts already read by rule (do not repeat them as gaps; add to them only with evidence):", ...json(factsShown(facts, { patterns: true })), "");
  L.push("What counts as one behavior:", ...GRANULARITY.map((g) => `- ${g}`), "", "Behavior kinds:", kindLines(BEHAVIOR_KINDS), "", "Rule kinds:", kindLines(RULE_KINDS), "");
  if (notSent.length) L.push("Files you are not shown (say nothing about what is in them; they are listed as gaps already):", ...notSent.map((n) => `- ${n.file}: ${n.why}`), "");
  L.push("The code, each line numbered:", "", ...sent.map((s) => numbered(s.file, s.text)), "");
  L.push("Answer with one JSON object of this shape:", SHAPE, "", "Rules for the answer:", ...RULES_COMMON, ...RULES_BEHAVIORS,
    "- A schema is given only where the code shows the shape field by field; otherwise leave it out.");
  return L.join("\n");
}

/** The architecture and interfaces pass. */
export function promptArchitecture({ repository, commit, files, sent, notSent, facts }) {
  const L = ["Pass: architecture and interfaces", "", ...header(repository, commit)];
  L.push("This pass drafts the architecture as built, the interfaces and the gaps. Behaviors and test coverage are drafted in other passes: leave them out.", "");
  L.push("Every file at this commit:", ...files.map((f) => `- ${f}`), "");
  L.push("Facts already read by rule (do not repeat them as gaps; add to them only with evidence):", ...json(factsShown(facts)), "");
  if (notSent.length) L.push("Files you are not shown in this pass:", ...notSent.map((n) => `- ${n.file}: ${n.why}`), "");
  L.push("The code, each line numbered:", "", ...sent.map((s) => numbered(s.file, s.text)), "");
  L.push("Answer with one JSON object of this shape:", SHAPE_ARCHITECTURE, "", "Rules for the answer:", ...RULES_COMMON,
    "- The exports, the files written and the commands listed above are interfaces already, read by rule. Describe each one you can as an interface: a function with \"export\": \"module#name\", what it does and what it returns; a file with \"path\" and, where the schema read by rule leaves a part as a $comment (the items of a list, a field built elsewhere), a JSON Schema that fills it in field by field from the code; a command with \"command\" and what it does. Do not restate parameters, async, throws or flags: they are read by rule.",
    "- Add other interfaces (HTTP routes, messages, files read) with evidence.",
    "- In a schema, copy every constant value (a format id, a fixed word) from the code byte for byte, and name only fields the code writes.",
    "- A function no path reaches is a gap of kind unreachable. Behavior seen only when the code runs is a gap of kind run-time-only.");
  return L.join("\n");
}

/** One behavior pass. */
export function promptBehaviors({ repository, commit, files, sent, facts, pass, of }) {
  const only = new Set(sent.map((s) => s.file));
  const shown = factsShown(facts, { only, patterns: true });
  const L = [`Pass: behaviors ${pass} of ${of}`, "", ...header(repository, commit)];
  L.push(`This pass drafts the behaviors of these files only: ${[...only].join(", ")}. Other passes draft the other files, the architecture, the interfaces and the test coverage.`, "");
  L.push("Every file at this commit:", ...files.map((f) => `- ${f}`), "");
  L.push("What counts as one behavior:", ...GRANULARITY.map((g) => `- ${g}`), "");
  L.push(shown.anchors.length ? "The anchors in these files: write exactly one behavior for each, with its anchor." : "No anchors are read by rule in these files: use the rule for code with no anchors.");
  L.push(...shown.anchors.map((a) => `- ${a.anchor} (${a.kind}, line ${a.line}: ${a.why})`), "");
  L.push("Behavior kinds (the first that fits):", kindLines(BEHAVIOR_KINDS), "", "Rule kinds:", kindLines(RULE_KINDS), "");
  L.push("Facts already read by rule for these files (the patterns and constants are copied from the code; quote from them):", ...json(shown), "");
  L.push("The code, each line numbered:", "", ...sent.map((s) => numbered(s.file, s.text)), "");
  L.push("Answer with one JSON object of this shape:", SHAPE_BEHAVIORS, "", "Rules for the answer:", ...RULES_COMMON, ...RULES_BEHAVIORS);
  return L.join("\n");
}

/** The pass for what each test covers. */
export function promptTests({ repository, commit, sent, behaviors }) {
  const L = ["Pass: what each test covers", "", ...header(repository, commit)];
  L.push("The behaviors drafted from the code (id, kind, name, anchor, where):");
  for (const b of behaviors) L.push(`- ${b.id} [${trim(b.kind)}] ${trim(b.name)}${trim(b.anchor) ? ` (${trim(b.anchor)})` : ""}: ${trim(b.does)}`);
  L.push("", "The test files, each line numbered:", "", ...sent.map((s) => numbered(s.file, s.text)), "");
  L.push("Answer with one JSON object of this shape:", SHAPE_TESTS, "", "Rules for the answer:",
    "- One entry per test file and behavior it covers; covers names behavior ids from the list above only.",
    "- Evidence is the lines of the test cases that call or check the behavior.",
    "- Do not judge the tests and do not suggest new ones.");
  return L.join("\n");
}

/** One call for JSON, and one more with a reminder when the answer has
 *  none: {doc, used, calls, problem}. */
export async function askJson(call, prompt, { seconds }) {
  const started = Date.now();
  const left = () => seconds - (Date.now() - started) / 1000;
  const used = [];
  let ask = prompt;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (left() < 30) return { doc: null, used, calls: attempt - 1, problem: "the time for drafting ran out before the model answered" };
    let got;
    try { got = await call(ask, { seconds: left(), system: SYSTEM }); } catch (e) {
      return { doc: null, used, calls: attempt, problem: `the model could not be reached: ${trim(e.message)}` };
    }
    used.push({ answered_by: got.answered_by ?? null, tokens_in: got.tokens_in ?? null, tokens_out: got.tokens_out ?? null });
    try {
      const doc = readJson(got.text);
      if (doc && typeof doc === "object" && !Array.isArray(doc)) return { doc, used, calls: attempt, problem: "" };
    } catch { /* asked again below */ }
    ask = `${prompt}\n\nYour last answer was not one JSON object. Answer with the JSON object only, with no words before or after it.`;
  }
  return { doc: null, used, calls: 2, problem: "the model answered twice without one JSON object" };
}

/** The draft in one pass (drift): {draft, calls, used, problem}. */
export async function draftRecord({ call, prompt, seconds = DRAFT_SECONDS }) {
  const r = await askJson(call, prompt, { seconds });
  return { draft: r.doc ? normalize(r.doc) : null, calls: r.calls, used: r.used, problem: r.problem };
}

/** The source files the behavior passes read, in batches: {passes: [{sent}],
 *  notSent: [{file, why}]}. Files with anchors come first, each batch at most
 *  PASS_CHARS characters, at most MAX_BEHAVIOR_PASSES batches. */
export function planBehaviorPasses(files, read, facts, { charsPerPass = PASS_CHARS, maxPasses = MAX_BEHAVIOR_PASSES } = {}) {
  const anchored = new Set((facts.surface?.anchors ?? []).map((a) => a.module));
  const source = files.filter((f) => CODE_FILE.test(f) && !TEST_PATH(f) && !LOCKFILES.has(basename(f)))
    .sort((a, b) => Number(anchored.has(b)) - Number(anchored.has(a)) || a.localeCompare(b));
  const passes = []; const notSent = [];
  let cur = null;
  for (const f of source) {
    const text = read(f);
    if (text === null || text === undefined) { notSent.push({ file: f, why: "it is not text" }); continue; }
    if (text.length > FILE_CHARS) { notSent.push({ file: f, why: `it is ${text.length.toLocaleString("en-US")} characters, over the ${FILE_CHARS.toLocaleString("en-US")} one file may take in a behavior pass` }); continue; }
    if (!cur || cur.chars + text.length > charsPerPass) {
      if (passes.length >= maxPasses) { notSent.push({ file: f, why: `the ${maxPasses} behavior passes allowed were used by the files before it` }); continue; }
      cur = { sent: [], chars: 0 };
      passes.push(cur);
    }
    cur.sent.push({ file: f, text });
    cur.chars += text.length;
  }
  return { passes: passes.map((p) => ({ sent: p.sent })), notSent };
}

/** Run tasks with at most `limit` at once, answering their results in order. */
async function inTurn(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

/** The file a drafted behavior belongs to: its anchor's module, else the
 *  file its first evidence names. */
export function homeOf(b) {
  const a = slash(trim(b?.anchor)).split("#")[0];
  if (a && CODE_FILE.test(a)) return a;
  const e = Array.isArray(b?.evidence) ? b.evidence[0] : b?.evidence;
  if (typeof e === "string") return slash(e.replace(/:\d+(-\d+)?$/, ""));
  return slash(trim(e?.file ?? e?.path));
}

/** The draft on adoption, in passes: {draft, problem, calls, used, passes,
 *  notSent, filesSent}. `draft.missing` lists the parts a failed pass left
 *  undrafted, each with why. */
export async function draftInPasses({ call, files, read, facts, repository, commit, seconds = DRAFT_SECONDS, charsPerPass = PASS_CHARS, maxPasses = MAX_BEHAVIOR_PASSES }) {
  const started = Date.now();
  const left = () => seconds - (Date.now() - started) / 1000;
  const used = []; const passes = []; const missing = []; const sentFiles = new Set();
  let calls = 0;
  const record = (pass, filesShown, r, more = {}) => {
    calls += r.calls;
    r.used.forEach((u) => used.push({ pass, ...u }));
    filesShown.forEach((f) => sentFiles.add(f));
    passes.push({ pass, files: filesShown, ok: Boolean(r.doc), calls: r.calls, ...(r.problem ? { problem: r.problem } : {}), ...more });
  };

  // The architecture and interfaces pass, and the behavior passes, at once.
  const arch = chooseFiles(files, read, { first: facts.entry_points.map((e) => e.name.replace(/^\.\//, "")) });
  const plan = planBehaviorPasses(files, read, facts, { charsPerPass, maxPasses });
  const archTask = async () => askJson(call, promptArchitecture({ repository, commit, files, sent: arch.sent, notSent: arch.notSent, facts }), { seconds: left() });
  const behaviorTasks = plan.passes.map((p, i) => async () => askJson(call, promptBehaviors({ repository, commit, files, sent: p.sent, facts, pass: i + 1, of: plan.passes.length }), { seconds: left() }));
  const [archOut, ...behaviorOuts] = await inTurn([archTask, ...behaviorTasks], PARALLEL);

  record("architecture and interfaces", arch.sent.map((s) => s.file), archOut);
  const archDoc = archOut.doc ? normalize(archOut.doc) : null;
  if (!archDoc) for (const part of ["architecture as built", "interfaces"]) missing.push({ part, about: `the ${part}`, why: archOut.problem });

  const behaviors = []; const gaps = [...(archDoc?.gaps ?? [])];
  const anchorOrder = new Map((facts.surface?.anchors ?? []).map((a, i) => [a.id, i]));
  const inSomePass = new Set(plan.passes.flatMap((p) => p.sent.map((s) => s.file)));
  const gapKey = (g) => `${trim(g.kind)}\n${trim(g.about)}`;
  const gapSeen = new Set(gaps.map(gapKey));
  behaviorOuts.forEach((r, i) => {
    const shown = plan.passes[i].sent.map((s) => s.file);
    const mine = new Set(shown);
    const doc = r.doc ? normalize(r.doc) : null;
    let dropped = 0;
    if (doc) {
      for (const b of doc.behaviors) {
        // A behavior whose file no pass was shown (or that names none) stays
        // with the first pass, so the evidence check says why it fails.
        const home = homeOf(b);
        if (mine.has(home) || (!inSomePass.has(home) && i === 0)) behaviors.push({ b, pass: i, at: behaviors.length }); else dropped += 1;
      }
      for (const g of doc.gaps) if (!gapSeen.has(gapKey(g))) { gapSeen.add(gapKey(g)); gaps.push(g); }
    } else missing.push({ part: "behaviors", about: `the behaviors of ${shown.join(", ")}`, why: r.problem, files: shown });
    record(`behaviors ${i + 1} of ${plan.passes.length}`, shown, r, dropped ? { dropped_outside_pass: dropped, dropped_why: "a behavior whose anchor or first evidence is a file this pass was not shown is left to the pass that shows it" } : {});
  });
  // Provisional ids in a fixed order: by anchor, then the unanchored in the order drafted.
  const rank = (x) => anchorOrder.get(slash(trim(x.b.anchor))) ?? Number.MAX_SAFE_INTEGER;
  behaviors.sort((x, y) => rank(x) - rank(y) || x.pass - y.pass || x.at - y.at);
  const merged = behaviors.map((x, i) => ({ ...x.b, id: `B${i + 1}` }));

  // What each test covers, from the behaviors drafted.
  let tests = [];
  const testFiles = new Set(facts.tests.map((t) => t.file));
  if (testFiles.size && merged.length) {
    const chosen = chooseFiles(files, read, { only: testFiles });
    const r = await askJson(call, promptTests({ repository, commit, sent: chosen.sent, behaviors: merged }), { seconds: left() });
    record("what each test covers", chosen.sent.map((s) => s.file), r);
    if (r.doc) tests = normalize(r.doc).tests;
    else missing.push({ part: "what each test covers", about: "what each test covers", why: r.problem });
  }

  const anyOk = passes.some((p) => p.ok);
  const notSent = [
    ...arch.notSent.map((n) => ({ ...n, pass: "architecture and interfaces" })),
    ...plan.notSent.map((n) => ({ ...n, pass: "behaviors" })),
  ];
  const draft = anyOk ? {
    ...normalize({ behaviors: merged, architecture: archDoc?.architecture ?? {}, interfaces: archDoc?.interfaces ?? [], tests, gaps }),
    missing,
    behavior_files: plan.passes.filter((_, i) => behaviorOuts[i].doc).flatMap((p) => p.sent.map((s) => s.file)),
  } : null;
  const problem = anyOk ? "" : (passes.find((p) => p.problem)?.problem ?? "no pass answered");
  return { draft, problem, calls, used, passes, notSent, filesSent: [...sentFiles].sort() };
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
