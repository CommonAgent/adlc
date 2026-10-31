// Draft the spec: the one step here that wakes a model, and the only one.
//
// It is given three things and never goes looking for a fourth: the record the
// gathering step wrote, the reference that says what a good spec carries, and
// one whole worked spec that produced an agent which runs today. It comes back
// with a draft and with the blanks it could not fill, and the blanks are the
// half that matters. A drafting step that invents a name, a price or an access
// grant rather than saying it does not know has done the one thing this agent
// must never do.
//
// The draft is checked for what it carries before anything else sees it, and
// where the check finds something the same request goes once more with the
// findings appended. Never a third time: two goes and then the draft stands as
// it is, with every finding that survives said out loud. A model that has been
// told twice and still writes a spec with no refusals is not going to write
// one on the third ask, and the person is owed the draft plus the truth about
// it rather than another two minutes of waiting.
//
// An answer that is not one JSON object (wrapped in prose, fenced, or broken
// part way) is read for the object inside it first, and only when there is
// none is the same request sent once more with a "JSON only" reminder. The
// whole step runs inside a time budget (DRAFT_SECONDS, 240 by default): no
// call starts without a minute left, each call is cut at what remains, and a
// step that ends without a usable draft exits 4 with a reply saying so, so the
// job ends in words and never runs on to the job's own time limit
// (2026-10-28: three of four runs on dev did).
//
// The model is reached through the shared model caller (model-caller.mjs,
// Common Agent 12.4.1) and nothing else: which model, where it is, the
// credential and the request format are the four settings the install places,
// MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, read on every
// call, and the package names no model and no address of its own. The prompt
// goes as plain text, each call limited to the seconds the step has left. With
// a setting missing, a protocol the package's text-reasoning system does not
// declare, or the declared protocols unreadable, no call is made and the job
// is refused in words.
//
//   needs: node >= 22; MODEL_NAME, MODEL_ENDPOINT, MODEL_PROTOCOL, and MODEL_KEY
//   where the endpoint asks for one
//   ASKED=<asked.json> RECORDS=<records folder> [REFERENCE=<md>] [WORKED=<spec.json>]
//   [ANSWERS=<answers.json>] node draft.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDraft, earlierBareJson } from "./check-spec.mjs";
import { fitJobSeconds } from "./job-seconds.mjs";
import { fitRunReply } from "./run-reply.mjs";
import { CAN_USE_RULE, canUseProblems, fitCanUse, loadSchemas } from "./can-use.mjs";
import { NEEDS, TEXT_CAP } from "./asked.mjs";
import { note } from "./went-without.mjs";
import { callModel, cannotCall, modelSettings } from "./model-caller.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** The digest a draft is delivered against: sha256 over its bytes. */
export const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The model, as the shared caller reads it from the install's settings. The
 *  package names no model of its own, because a model named in a package is a
 *  rebuild waiting to happen: models are retired on somebody else's schedule.
 *  With none set, the job is refused in the caller's words. */
export const modelOf = (env = {}) => modelSettings(env).name;

/** The request formats the package's text-reasoning system declares, read
 *  from agent-runtime-requirements.json beside the package (one level up in
 *  the source, three in a built package's skills/<slug>/scripts/). Where the
 *  declaration is not found, cannot be read or names none, null, and then
 *  nothing is sent and the job is refused (PROTOCOLS_UNREAD). `here` is the
 *  scripts folder the file is looked for above, so a test can point it at
 *  another file. */
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

/** Why the job is refused when the declared protocols could not be read:
 *  without them the caller would hold MODEL_PROTOCOL to nothing and send
 *  whatever it speaks (Common Agent 12.4.1), so nothing is sent. */
export const PROTOCOLS_UNREAD = "the model system's declared protocols could not be read from agent-runtime-requirements.json, so nothing was sent to the model";

/** Why no call is made, or "" when one can be: a setting the caller refuses,
 *  or the declared protocols unread. */
export function whyNoCall(env = process.env, { protocols = declaredProtocols() } = {}) {
  const read = Array.isArray(protocols) && protocols.length;
  return cannotCall(env, { protocols: read ? protocols : undefined }) || (read ? "" : PROTOCOLS_UNREAD);
}

/** Two goes and no more. The second carries the findings from the first. */
export const TRIES = 2;

/** One more call, at most, when an answer is not one JSON object. */
export const JSON_RETRIES = 1;

/** The time the whole drafting step may take, every call included, unless
 *  DRAFT_SECONDS says otherwise. The job has ten minutes, and the harness, the
 *  builder check and the reply need what is left. */
export const DRAFT_SECONDS = 240;

/** No call starts with less than this left: an answer takes about a minute. */
export const MIN_CALL_SECONDS = 60;

/** The exit code, and the error, of a step that ends with no usable draft. */
export const NO_DRAFT_EXIT = 4;
export class NoDraft extends Error {}

/** The draft step's budget in seconds, from DRAFT_SECONDS when it is a
 *  positive number, else the default. */
export const draftSecondsOf = (env = {}) => {
  const n = Number(trim(env.DRAFT_SECONDS));
  return Number.isFinite(n) && n > 0 ? n : DRAFT_SECONDS;
};

/** Said once more, after an answer that was not one JSON object. */
export const JSON_ONLY = "Answer with exactly one JSON object and nothing else: no words before or after it, no code fence, "
  + "no comments and no trailing commas. Its members are \"spec\", \"blanks\" and \"notes\", as above.";

export const INSTRUCTION = `You are writing one spec, as JSON, for an agent package.

You are given, in order: what somebody asked for, what they attached with it,
any answers they have given to earlier questions, a spec they attached if they
did, a reference saying what a good spec carries, and one whole spec that
produced an agent which runs today.

Write the spec they described. What they attached is part of what they asked
for: a document says what the agent will work on, and a spec they sent back
is a draft they have read. Follow the reference: it was measured off eight
working packages, not invented, and where it gives a number that number came
from counting.

Three things you must never invent, because they are not yours to choose:
the agent's name, its price, and access to any system. Where the request does
not settle one of those, leave it out of the draft and put it in "blanks" with
the question you would ask. A guessed name becomes a handle somebody is stuck
with; a guessed price is somebody's money; a guessed system is authority
nobody granted.

An empty "systems" list is a real answer, and only when the request names
nothing outside the agent's own folder. A request that says the agent reads
a platform, a service, a directory another agent keeps, an activity record,
a ledger, or anything else it does not make itself has named a system: put
it in "systems" with the access it needs, or, where the request does not say
what it is or how it is reached, put "systems" in "blanks" with the question.
Never answer that question with an empty list.

Anything else you may draft, because a draft they correct is worth more to
them than a question they have to answer. Put a note in "notes" when you drafted
something the request did not settle, so they know which parts to read hardest.

Default every job to a program: how.control "script", how.intelligence "none",
how.cost "none", how.contract "full". Step up to intelligence "called" only
where a judgment genuinely needs a model, and say in "does" what the judgment
is. A model in control has to earn it, and when it is in control the contract
is the ends and never the method.

Every input and output kind is one of text, identifier, url, document, or
one media type such as text/markdown. "array of ..." and "list of ..." are
not kinds: several files of one kind are one input.

Choose each kind for who reads the piece:
- Content one agent hands another, or a person reviews, is "text/markdown"
  by default, with a light convention: a short header for the few structured
  fields, then fixed headings. Sketch the convention in the piece's "about",
  with the header's fields and each heading in backticks, for example
  "about": "Markdown: a header \`source, read_at\`, then \`## Key points\`
  with one bullet per point, then \`## Not read\`."
- JSON is only for exact typed data that code consumes and a person never
  reads: IDs, coordinates, timings, numeric series. Then the kind says what
  it is, "application/vnd.agentmesh.<name>+json", and the "about" sketches
  its top-level shape in backticks, such as \`{points, source}\`.
- Never a bare "application/json": the package maker refuses a new agent
  that declares one.
- Every input says who gives it: "given_by" is "person", "agent" or "either".
When you revise a spec that already declares a piece as bare
"application/json", keep that piece as it is, because the agent already
sends it and changing it is its own decision, and name it in "notes" as one
to make specific.
Where a person might want another format than the default, make the format
a setting (below), with the default and its choices, and say so in "notes".

Inputs are only the material the job is about: the page, the brief, the
facts. Anything that only shapes how the job runs (a voice, a tone, a length,
a style, a format choice, anything with a fixed set of values or a default)
is a run-config setting and never an input, so a person's page draws a choice
and not a free-text box. Declare it in "run_config": {"settings": [...]},
each with "name", "kind" "preference", "label", "about", a "default",
"allowed" (its choices, decided now and never left open), "value_labels" (a
label for each allowed value) and "job_may_set" true; a number gets "min",
"max" and "step" in place of "allowed". Brand, palette, a style guide and
templates are the organization's standing assets, declared in "can_use", and
never inputs.

A job that calls a model reaches it as a bound system with access "trigger":
"text-reasoning" for text, "image-reading" for pictures, "speech-to-text" or
"text-to-speech" for speech. Its "purpose" says the capability the job needs
(text, vision, long context). The system is of kind "model" with "protocols",
the request formats its scripts speak: list all three the shared caller speaks,
"anthropic-messages", "openai-chat" and "gemini", so a customer's own model
gateway works, unless the job relies on something one of them cannot carry;
then leave that one out and say in the spec which it is and why. It takes no
credential, env or settings: the scripts
reach the model through the shared caller and the four settings the install
places, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, so the
install and a run config choose it. Never name a model or a version anywhere
in the spec: not in a setting's default, an instruction or a sentence.

No address goes anywhere in "systems": not in a setting, not in a purpose.
A product somebody binds is named by its system and credential. A public read
that needs no key is a system with access "read", kind "service", no
credential and no settings, and its address is a constant in the script. An
address the caller gives is an input of kind url. draft-host is brokered: its
entry has no credential, env or settings.

A refusal is something the agent will NOT do. If a refusal names an act one
of the jobs performs, it is not a refusal; write the act it declines instead.

When the kind is third-party-framework or mesh-coded, write the container
spec the reference's last section describes: no job names scripts,
references, run or instructions, and the container block comes from the scan.
When no scan was attached, write the rest and put "container" in "blanks"
with the question, rather than giving up. Never write a handle as a value.

Answer with one JSON object and nothing else:

{"spec": { ...the spec... },
 "blanks": [{"key": "name", "question": "..."}],
 "notes": "what you drafted that the request did not settle"}`;

/** The parts of the request, in order, as text. Pure and exported so the whole
 *  prompt can be read in a test rather than inferred from a fixture. */
export function requestParts({ asked = null, reference = "", worked = "", answers = null, findings = [], notJson = "" } = {}) {
  // A revision with no draft in hand is not drafted: a spec written from an
  // answer's own words is a spec for the wrong agent (2026-09-15).
  const hasFiles = (asked?.attached ?? []).some((a) => a.kind === "an agent's own file" && typeof a.text === "string");
  if (asked?.revision && !hasFiles && !(asked?.attached ?? []).some((a) => a.kind === "a spec" && typeof a.text === "string")) {
    throw new Error("this is a revision and no draft came with it; nothing is drafted from an answer alone");
  }
  const parts = [INSTRUCTION];
  parts.push(`--- WHAT THEY ASKED FOR ---\n${trim(asked?.said) || "(nothing was said in words)"}`);
  const attached = (asked?.attached ?? []).filter((a) => !a.missing);
  if (attached.length) {
    parts.push(`--- WHAT CAME WITH IT ---\n${attached.map((a) => `${a.name} (${a.kind}${a.media_type ? `, ${a.media_type}` : ""})`).join("\n")}`);
  }
  // One attached spec is the draft they are sending back, or a shape they
  // want copied; it is handed over on its own below, after their answers.
  // Every other text attachment is handed over here, whole, because what a
  // document says is part of what they asked for and a draft written from
  // its filename has not read it.
  const sentBack = attached.find((a) => a.kind === "a spec" && typeof a.text === "string") ?? null;
  // The architecture record is handed over on its own below, with what the
  // Design owes it, rather than as one more document.
  const record = attached.find((a) => a.kind === "an architecture record" && typeof a.text === "string") ?? null;
  for (const a of attached) {
    if (a === sentBack || a === record || typeof a.text !== "string" || !trim(a.text)) continue;
    parts.push(`--- ${a.name.toUpperCase()}, ${a.kind.toUpperCase()}, AS ATTACHED ---\n${trim(a.text)}${a.cut ? `\n(cut here; the whole file is ${a.text_chars} characters)` : ""}`);
  }
  if ((asked?.missing_files ?? []).length) {
    parts.push(`--- NAMED AND NOT THERE ---\n${asked.missing_files.join("\n")}\nDo not write the spec as though these arrived.`);
  }
  // Answers to earlier questions come after the request and before the
  // reference, because they are the person's words and they outrank anything
  // drafted for them.
  if (answers && Object.keys(answers).length) {
    parts.push(`--- THEY HAVE SINCE ANSWERED ---\n${Object.entries(answers).map(([k, v]) => `${k}: ${trim(v)}`).join("\n")}`);
  }
  // The spec they attached comes after their answers and before the reference:
  // it is the thing their answers change, and a second round that redrafts
  // from nothing throws away what they have already read and accepted.
  if (!sentBack && hasFiles && asked?.revision) {
    parts.push("--- THE DRAFT THEY ARE ANSWERING ABOUT ---\nThe agent's own files above, the ones this agent delivered, are the draft. "
      + "This is a revision, not a new request. Write the spec those files state, for the agent they describe and only it. "
      + "Keep every line they did not ask to change; change only what their answers touch; report as a blank only what their answers still leave open.");
  } else if (sentBack && asked?.revision) {
    parts.push(`--- THE DRAFT THEY ARE ANSWERING ABOUT: ${sentBack.name} ---\n${trim(sentBack.text)}${sentBack.cut ? `\n(cut here; the whole file is ${sentBack.text_chars} characters)` : ""}\n`
      + "This is a revision, not a new request. The agent to write is the one this spec names, and only it. "
      + "Keep every line they did not ask to change; change only what their answers touch; report as a blank only what their answers still leave open.");
  } else if (sentBack) {
    parts.push(`--- A SPEC THEY ATTACHED: ${sentBack.name} ---\n${trim(sentBack.text)}${sentBack.cut ? `\n(cut here; the whole file is ${sentBack.text_chars} characters)` : ""}\n`
      + "Read what they asked for to tell whether they are revising this spec or copying its shape for something new. "
      + "If they are revising it, keep everything they did not ask to change, and change only what their words and their answers touch.");
  }
  if (record) parts.push(architecturePart(record, asked?.architecture));
  if (trim(reference)) parts.push(`--- WHAT A GOOD SPEC CARRIES ---\n${trim(reference)}`);
  if (trim(worked)) parts.push(`--- A WHOLE SPEC THAT WORKS ---\n${trim(worked)}`);
  if (findings.length) {
    parts.push(`--- WHAT WAS WRONG WITH YOUR LAST DRAFT ---\n${findings.map((f) => `- ${f}`).join("\n")}\nWrite it again with these fixed. Change nothing else.`);
  }
  if (trim(notJson)) {
    parts.push(`--- YOUR LAST ANSWER COULD NOT BE READ ---\n${trim(notJson)}.\n${JSON_ONLY}`);
  }
  return parts;
}

/** The architecture record, as the Design is given it (Agent Roles, the
 *  solution architect; the stage's standard is standards/
 *  architecture-standard.md). The Design designs within it: the record's
 *  systems and no other, its kind, its formats, its standing assets and its
 *  settings. */
export const ARCHITECTURE_RULE = "Design within this record. It was written by the Architecture stage, which comes before the Design, "
  + "and it settles what the agent stands on. Declare exactly the systems it names, under the same names and with the access it gives each, and no other; "
  + "a model system is declared as the record states its capability, and no model is named. The agent's kind is the record's kind. "
  + "The formats at the agent's edge, and the settings with their defaults, are the record's. The record's products and bindings are for the install: "
  + "the spec names no product, address or credential. Where a step of your design needs a system the record does not name, do not declare it: "
  + "put \"architecture\" in \"blanks\" with the question for the architect, naming the step and the system it needs. "
  + CAN_USE_RULE;

export function architecturePart(record, architecture = null) {
  const n = Number(architecture?.questions) || 0;
  const open = architecture && !architecture.done
    ? `\nThe record is not finished: ${n === 1 ? "one question is" : `${n} questions are`} still open in it. Leave them open; they are the architect's and the person's, not yours.`
    : "";
  return `--- THE ARCHITECTURE RECORD: ${record.name} ---\n${trim(record.text)}\n${ARCHITECTURE_RULE}${open}`;
}

/** The draft fitted to the record after the last go: a system the record does
 *  not name is taken out of the draft and asked of the architect, never kept
 *  on the Design's word. Returns the draft and the blank to add, if any. */
export function fitToArchitecture(spec, architecture = null) {
  if (!architecture || !Array.isArray(architecture.systems) || !Array.isArray(spec?.systems)) return { spec, blank: null };
  const named = new Set(architecture.systems);
  const nameOf = (s) => trim(s?.name ?? s?.role);
  const extra = spec.systems.filter((s) => !named.has(nameOf(s)));
  if (!extra.length) return { spec, blank: null };
  const names = extra.map(nameOf);
  return {
    spec: { ...spec, systems: spec.systems.filter((s) => named.has(nameOf(s))) },
    blank: {
      key: "architecture",
      question: `The design needs ${names.join(" and ")}, which the architecture record does not name, so ${names.length === 1 ? "it was" : "they were"} left out of the draft. `
        + `This goes back to the solution architect: should the agent reach ${names.join(" and ")}? The record is revised first, and then the design.`,
    },
  };
}

export function draftRequest(opts = {}) {
  return {
    model: modelOf(opts.env ?? {}),
    body: { contents: [{ parts: requestParts(opts).map((text) => ({ text })) }] },
  };
}

/** The most the service may write back in one answer.
 *
 *  A whole spec is long, and an answer cut in the middle of its JSON reads as
 *  "not JSON", which hides the real reason. The limit is set well above the
 *  longest spec written so far, and an answer cut at it is refused by the
 *  shared caller as cut, never read as whole. */
export const OUTPUT_TOKENS = 64000;

/** The request as the plain text the model is sent: its parts, in order. */
export const promptOf = (request) => (request?.body?.contents?.[0]?.parts ?? []).map((p) => p?.text ?? "").join("\n\n");

/** The call askForSpec makes when it is handed none: the prompt as plain text
 *  through the shared caller, with this env and the package's declared
 *  protocols, limited to the seconds the step has left. It answers the text,
 *  the model that answered and what the call used; the service reports tokens
 *  and not money, and a price table would name models, so no cost is stated.
 *  With the declared protocols unread it throws PROTOCOLS_UNREAD before
 *  anything is sent. */
export function callFor(env = process.env, { protocols = declaredProtocols(), fetchImpl } = {}) {
  return async (request, { seconds = DRAFT_SECONDS } = {}) => {
    if (!(Array.isArray(protocols) && protocols.length)) throw new Error(PROTOCOLS_UNREAD);
    const got = await callModel(promptOf(request), {
      env,
      protocols,
      ...(fetchImpl ? { fetchImpl } : {}),
      maxOutputTokens: OUTPUT_TOKENS,
      json: true,
      timeoutMs: Math.max(1, Math.floor(seconds * 1000)),
    });
    return { text: got.text, answered_by: got.answered_by ?? null, usage: { tokens_in: got.tokens_in, tokens_out: got.tokens_out, cost: null } };
  };
}

/** The answer, out of whatever wrapping it arrived in.
 *
 *  A model asked for JSON returns JSON in a code fence about as often as it
 *  returns it bare, and an agent that treats a fenced answer as a failure
 *  throws away work it already paid for. A sentence before or after the
 *  object, or a fence in the middle of prose, is the same answer: the object
 *  is taken out of it. */
export function answerFrom(text) {
  const raw = trim(text);
  if (!raw) throw new Error("the service answered with nothing");
  const doc = jsonIn(raw);
  if (doc === undefined) throw new Error("the service did not answer with JSON");
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("the service answered with JSON that is not an object");
  if (!doc.spec || typeof doc.spec !== "object" || Array.isArray(doc.spec)) throw new Error("the answer carries no spec");
  const blanks = Array.isArray(doc.blanks)
    ? doc.blanks.filter((b) => b && trim(b.key)).map((b) => ({ key: trim(b.key), question: trim(b.question) }))
    : [];
  return { spec: doc.spec, blanks, notes: trim(doc.notes) };
}

/** The places a JSON value may sit in an answer, most likely first: the
 *  whole answer, each fenced block, and each balanced {...} in the prose
 *  (read with strings and escapes respected, so a brace inside a string does
 *  not end it). Pure. */
export function jsonCandidates(raw) {
  const out = [raw];
  for (const m of raw.matchAll(/```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g)) out.push(m[1].trim());
  for (let i = raw.indexOf("{"); i !== -1; i = raw.indexOf("{", i + 1)) {
    const end = objectEnd(raw, i);
    if (end !== -1) {
      out.push(raw.slice(i, end + 1));
      i = end; // the next candidate starts after this object, not inside it
    }
  }
  return [...new Set(out.filter(Boolean))];
}

/** Where the object opened at `start` closes, or -1 when it never does. */
function objectEnd(s, start) {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === "\"") inString = false;
      continue;
    }
    if (c === "\"") inString = true;
    else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return c === "}" ? i : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** The first candidate that parses: an object when there is one, else the
 *  first value of any other kind, else undefined. */
export function jsonIn(raw) {
  let other;
  for (const c of jsonCandidates(raw)) {
    let v;
    try { v = JSON.parse(c); } catch { continue; }
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    if (other === undefined) other = v;
  }
  return other;
}

/** The blanks, with the three that are never the model's to fill added back
 *  whenever the draft did not settle them.
 *
 *  A model that forgets to report a blank is the failure this guards: the
 *  draft then looks complete, somebody approves it, and an invented name is
 *  on the mesh. So the three are checked against the draft itself rather than
 *  taken on the model's word. */
export function blanksOf(spec, said = []) {
  const out = new Map(said.map((b) => [b.key, b]));
  const ask = (key) => {
    if (out.has(key)) return;
    const need = NEEDS.find((n) => n.key === key);
    out.set(key, { key, question: need?.ask ?? `What should ${need?.what ?? key} be?` });
  };
  if (!/^[a-z][a-z0-9-]*$/.test(trim(spec?.name))) ask("name");
  if (!spec?.price || typeof spec.price !== "object") ask("price");
  // Systems are different: an empty list is a real answer, and a common one.
  // It is only a blank when the draft never decided, which is the absent key.
  if (!Array.isArray(spec?.systems)) ask("systems");
  return [...out.values()];
}

/** Ask, check what came back, and ask once more with the findings. Returns the
 *  draft, whatever survived, and what it cost. */
export async function askForSpec({
  call, check = null, tries = TRIES, jsonRetries = JSON_RETRIES,
  seconds = null, minCallSeconds = MIN_CALL_SECONDS, now = Date.now, ...opts
} = {}) {
  // With no call handed in and the settings handed in as env, the shared
  // caller is the call, with that env. With neither, there is nothing to ask.
  if ((call === undefined || call === null) && opts.env && typeof opts.env === "object") call = callFor(opts.env);
  if (typeof call !== "function") throw new Error("askForSpec needs a call");
  const deadline = now() + 1000 * (seconds ?? draftSecondsOf(opts.env ?? {}));
  const left = () => (deadline - now()) / 1000;
  // What a good spec carries, and the format rules, holding a revision to
  // them only for the pieces it adds: what an earlier spec already sent as
  // bare JSON is kept, and named in the notes.
  const earlier = earlierBareJson(opts.asked);
  const architecture = opts.asked?.architecture ?? null;
  check ??= (spec) => checkDraft(spec, { earlier, architecture });
  let findings = [];
  let last = null;
  let calls = 0;
  let notJson = "";
  let retriesLeft = jsonRetries;
  let stopped = null;
  let timedNote = "";
  const used = [];
  for (let go = 0; go < tries;) {
    // Never start a call that cannot finish inside the step's time.
    if (left() < minCallSeconds) {
      stopped = "the drafting step ran out of time";
      break;
    }
    const request = draftRequest({ ...opts, findings: last ? findings : [], notJson });
    calls += 1;
    // A call answers with the text alone, or with the text and what the call
    // used, which is what main's call does. It is given the seconds left, so
    // it is cut there rather than run on past the step's time.
    let said;
    try {
      const got = await call(request, { seconds: left() });
      said = typeof got === "string" ? { text: got } : got;
    } catch (e) {
      // A service that fails after a usable draft is in hand ends the asking,
      // and the draft stands with its findings; with none, the step ends.
      if (!last) throw new NoDraft(e.message);
      stopped = e.message;
      break;
    }
    used.push({ model: said?.answered_by ?? null, ...(said?.usage ?? { tokens_in: null, tokens_out: null, cost: null }) });
    let answer;
    try {
      answer = answerFrom(said?.text);
    } catch (e) {
      // Not one JSON object: asked once more with the reminder, and never
      // more than that. A draft already in hand still stands.
      if (retriesLeft > 0) { retriesLeft -= 1; notJson = e.message; continue; }
      if (!last) throw new NoDraft(e.message);
      stopped = e.message;
      break;
    }
    notJson = "";
    // The cap on one job is the package maker's range, not the model's to
    // get wrong: a value outside it is set to the nearest bound here, and the
    // reply says so (technical debt 648: 30, kept on the second go, stopped
    // a build at Package).
    const timed = fitJobSeconds(answer.spec);
    // How the host reads a job's reply is the package maker's rule too: a
    // run.reply outside it is corrected here and said (technical debt 652:
    // "text:counts" stopped a build at Package).
    const replied = fitRunReply(timed.spec);
    last = { ...answer, spec: replied.spec };
    timedNote = [timed.note, replied.note].filter(Boolean).join(" ");
    findings = check(last.spec);
    go += 1;
    if (!findings.length) break;
  }
  if (!last) throw new NoDraft(stopped ?? "the service gave no draft");
  // A system the record does not name never stays in the draft.
  const fitted = fitToArchitecture(last.spec, architecture);
  // The standing assets are the record's: exactly those, as can_use, each
  // with reads, does and without (the architecture standard, section 10).
  const table = opts.table === undefined ? loadSchemas() : opts.table;
  const withAssets = fitCanUse(fitted.spec, architecture, table);
  const blanks = blanksOf(withAssets.spec, last.blanks);
  if (fitted.blank && !blanks.some((b) => b.key === "architecture")) blanks.push(fitted.blank);
  const kept = (fitted.blank ? findings.filter((f) => !/which the architecture record does not name/.test(f)) : findings)
    .filter((f) => !/^can_use |declare it in can_use$/.test(f));
  return {
    spec: withAssets.spec,
    blanks,
    notes: [last.notes, timedNote, ...withAssets.notes].filter(Boolean).join(" "),
    findings: [...kept, ...canUseProblems(withAssets.spec, architecture, table)],
    calls,
    used,
    tried_again: calls > 1,
    // Why the asking ended before the draft was clean, when it did.
    stopped: findings.length ? stopped : null,
  };
}

/** What this step goes ahead without, from the gathering record: a file the
 *  person named that never arrived, and the rest of any attachment that was
 *  cut at the cap. Both are things a reader of the draft cannot see, because
 *  a spec written from half the material looks exactly like one written from
 *  all of it. Pure; the caller writes them to the record. */
export function wentWithoutOf(asked = null) {
  const out = [];
  // The Design comes after the Architecture. A new draft written without a
  // record chose its systems itself, which is the architect's decision.
  if (asked && !asked.architecture && !asked.revision) {
    out.push({
      wanted: "an architecture record",
      did: "chose the systems in the design itself, which is the Architecture stage's decision; send the statement to the solution architect first and attach its record, so the Design starts from systems already named and bound",
    });
  }
  for (const name of asked?.missing_files ?? []) {
    out.push({ wanted: name, did: "wrote the spec from what did arrive, and not as though it had" });
  }
  for (const a of asked?.attached ?? []) {
    if (a?.cut && typeof a.text === "string") {
      out.push({
        wanted: `the whole of ${a.name}`,
        did: `read its first ${TEXT_CAP.toLocaleString("en-US")} characters and drafted from those`,
        why: `it is ${Number(a.text_chars ?? 0).toLocaleString("en-US")} characters and the drafting step reads ${TEXT_CAP.toLocaleString("en-US")} at most`,
      });
    }
  }
  return out;
}

/** What the reference and the worked example are, when nothing names them.
 *  In a built package they sit under references/ beside this script's folder;
 *  in the example folder they are one level up. */
export function referenceAt(env = {}, here = HERE) {
  const named = trim(env.REFERENCE);
  const tries = named ? [named] : [
    join(here, "..", "references", "what-a-good-spec-carries.md"),
    join(here, "..", "..", "spec-writer", "references", "what-a-good-spec-carries.md"),
  ];
  return tries.find((p) => existsSync(p)) ?? null;
}
export function workedAt(env = {}, here = HERE) {
  const named = trim(env.WORKED);
  const tries = named ? [named] : [
    join(here, "..", "references", "a-spec-that-works.json"),
    join(here, "..", "..", "publisher", "spec.json"),
  ];
  return tries.find((p) => existsSync(p)) ?? null;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const env = process.env;
  const { ASKED, RECORDS, ANSWERS } = env;
  if (!ASKED || !RECORDS) { console.error("ASKED and RECORDS are required"); process.exit(2); }
  const read = (p) => (p && existsSync(p) ? readFileSync(p, "utf8") : "");
  try {
    const asked = JSON.parse(readFileSync(ASKED, "utf8"));
    const answers = ANSWERS && existsSync(ANSWERS) ? JSON.parse(readFileSync(ANSWERS, "utf8")) : null;
    // The four model settings are the install's; with one missing, a
    // protocol this package does not declare, or the declared protocols
    // unreadable, nothing is sent and the job is refused in words.
    // MODEL_KEY may be empty.
    const protocols = declaredProtocols();
    const why = whyNoCall(env, { protocols });
    if (why) {
      console.log(JSON.stringify({ ok: false, code: 1, reply: `The spec was not drafted: ${why}.` }));
      console.error(why);
      process.exit(1);
    }
    const model = modelOf(env);
    // The prompt goes as plain text, each call cut at the seconds the step
    // has left, so no call outlives the step.
    const call = callFor(env, { protocols });
    const out = await askForSpec({
      call, asked, answers,
      reference: read(referenceAt(env)),
      worked: read(workedAt(env)),
      env,
    });
    mkdirSync(RECORDS, { recursive: true });
    // Written before the draft, so a run that dies between the two still
    // says what it was short of.
    for (const w of wentWithoutOf(asked)) note(RECORDS, w);
    const draftText = JSON.stringify(out.spec, null, 2) + "\n";
    writeFileSync(join(RECORDS, "draft.json"), draftText);
    writeFileSync(join(RECORDS, "calls.json"), JSON.stringify({
      calls: "v1", model, service: modelSettings(env).protocol, made: out.calls,
      // The digest of the draft as this step wrote it. pieces.mjs delivers
      // the draft only while it still matches, so a draft edited by hand
      // after this step (a harness's file tool cuts lines over 2000
      // characters, debt 43) is refused rather than delivered cut.
      draft_sha256: digestOf(draftText),
      answered_by: [...out.used].reverse().find((u) => u.model)?.model ?? null,
      each: out.used.map((u) => ({ answered_by: u.model, tokens_in: u.tokens_in, tokens_out: u.tokens_out, cost: u.cost })),
    }, null, 2) + "\n");
    writeFileSync(join(RECORDS, "blanks.json"), JSON.stringify({ blanks: "v1", blanks: out.blanks, notes: out.notes }, null, 2) + "\n");
    console.log(JSON.stringify({
      ok: true, code: 0, draft: join(RECORDS, "draft.json"),
      blanks: out.blanks.map((b) => b.key), findings: out.findings, calls: out.calls, stopped: out.stopped, model,
    }));
  } catch (e) {
    console.error(e.message);
    if (e instanceof NoDraft) {
      // The job ends here, in words. Running this step again will not do
      // better inside the same job, so the reply says to ask again later.
      console.log(JSON.stringify({
        ok: false, code: NO_DRAFT_EXIT,
        reply: `The spec was not drafted: ${e.message}. Nothing was delivered. You can ask again.`,
      }));
      process.exitCode = NO_DRAFT_EXIT;
    } else {
      process.exitCode = 1;
    }
  }
}
