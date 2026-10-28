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
// The service is chosen by the model's name: a google-vertex-anthropic/ name is
// Claude on Google Vertex AI (paid for with the job's own token; TEXT_API_KEY
// then says <project>/<location>), and is the default; a bare Gemini name is
// reached at Google with TEXT_API_KEY as its key. Any other name with a provider
// in front is refused in words (owner, 2026-10-03: every Claude call goes
// through Vertex).
//
//   needs: node >= 22; TEXT_API_KEY for the text-reasoning service
//   ASKED=<asked.json> RECORDS=<records folder> [REFERENCE=<md>] [WORKED=<spec.json>]
//   [ANSWERS=<answers.json>] [TEXT_MODEL=<model>] node draft.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDraft, earlierBareJson } from "./check-spec.mjs";
import { NEEDS, TEXT_CAP } from "./asked.mjs";
import { note } from "./went-without.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** The digest a draft is delivered against: sha256 over its bytes. */
export const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The default model, and the setting that overrides it.
 *
 *  Never hardcoded at a call site: the model an agent runs is a fact its
 *  deploy record states, and the one time a package and its record disagreed
 *  an image preview model wrote four throwaway scripts and burned a twenty
 *  five minute job. TEXT_MODEL is placed by the install from the spec's own
 *  settings, so changing it is a setting change and not a new version. */
export const MODEL = "google-vertex-anthropic/claude-sonnet-5-5";
export const modelOf = (env = {}) => trim(env.TEXT_MODEL) || MODEL;

/** Two goes and no more. The second carries the findings from the first. */
export const TRIES = 2;

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
Where a person might want another format than the default, draft the
default and say so in "notes"; never decide it for them.

A job that calls a model reaches it as a bound system with access "trigger":
"text-reasoning" for text, "image-reading" for pictures, "speech-to-text" or
"text-to-speech" for speech. Its "purpose" says the capability the job needs
(text, vision, long context). The scripts read the model from AGENT_MODEL or
TEXT_MODEL through the shared caller, so the install and a run config choose
it. Never name a model or a version anywhere in the spec: not in a setting's
default, an instruction or a sentence.

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
export function requestParts({ asked = null, reference = "", worked = "", answers = null, findings = [] } = {}) {
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
  return parts;
}

/** The architecture record, as the Design is given it (Agent Roles, the
 *  solution architect; the stage's standard is agents/solution-architect/
 *  references/architecture-standard.md). The Design designs within it: the
 *  record's systems and no other, its kind, its formats and its settings. */
export const ARCHITECTURE_RULE = "Design within this record. It was written by the Architecture stage, which comes before the Design, "
  + "and it settles what the agent stands on. Declare exactly the systems it names, under the same names and with the access it gives each, and no other; "
  + "a model system is declared as the record states its capability, and no model is named. The agent's kind is the record's kind. "
  + "The formats at the agent's edge, and the settings with their defaults, are the record's. The record's products and bindings are for the install: "
  + "the spec names no product, address or credential. Where a step of your design needs a system the record does not name, do not declare it: "
  + "put \"architecture\" in \"blanks\" with the question for the architect, naming the step and the system it needs.";

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
 *  longest spec written so far and is the same on both services. */
export const OUTPUT_TOKENS = 64000;

/** Which service a model is reached through. A google-vertex-anthropic/ name is
 *  Claude on Vertex; a bare name is a Gemini model at Google; any other name
 *  with a provider in front is "none", which no call is made for. A blank name
 *  is the default, which is Claude on Vertex. */
export const serviceOf = (model) => {
  const m = trim(model) || MODEL;
  if (m.startsWith(`${VERTEX}/`)) return "vertex";
  return m.includes("/") ? "none" : "google";
};

export const GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Claude on Google Vertex AI (2026-09-29). A model named
 *  google-vertex-anthropic/<id> is called at Vertex with a token from the
 *  job's own service account (the metadata server), and the credential is not
 *  a key but where to call: "<project>/<location>". Vertex reports tokens and
 *  not money, so the cost is the tokens at the published price. */
export const VERTEX = "google-vertex-anthropic";
export const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
/** USD per million tokens, in and out, US multi-region (Vertex pricing page, 2026-09-29). */
export const VERTEX_PRICES = { "claude-sonnet-5-5": [2.2, 11], "claude-haiku-4-5": [1.1, 5.5] };

export function vertexWhere(key) {
  const [project, location] = trim(key).split("/");
  if (!project || !location) throw new Error("the text-reasoning credential for a Vertex model is <project>/<location>");
  return { project, location };
}

export function vertexUrl(model, key) {
  const { project, location } = vertexWhere(key);
  const id = trim(model).slice(VERTEX.length + 1).replace(/@default$/, "");
  const host = location === "global" ? "aiplatform.googleapis.com"
    : location === "us" || location === "eu" ? `aiplatform.${location}.rep.googleapis.com` : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${id}:rawPredict`;
}

export function vertexCost(model, tokensIn, tokensOut) {
  const id = trim(model).replace(`${VERTEX}/`, "").split("@")[0];
  const [i, o] = VERTEX_PRICES[id] ?? [2.2, 11];
  return Math.round(((tokensIn ?? 0) * i + (tokensOut ?? 0) * o) / 1e6 * 1e8) / 1e8;
}

/** A token from the metadata server of the machine the job runs on. */
export async function metadataToken(fetchImpl = fetch) {
  const r = await fetchImpl(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!r.ok) throw new Error(`the metadata server answered ${r.status}, so there is no token for Vertex`);
  const d = await r.json();
  if (!trim(d?.access_token)) throw new Error("the metadata server gave no token for Vertex");
  return d.access_token;
}

/** The call as HTTP: url, headers and body. The key goes in a header and
 *  nowhere else, so nothing that logs a body can carry it. Pure; main sends.
 *  For a Vertex model `key` is where to call and `token` pays. */
export function httpRequestFor(request, key, token = "") {
  const model = trim(request?.model) || MODEL;
  if (serviceOf(model) === "vertex") {
    const text = (request?.body?.contents?.[0]?.parts ?? []).map((p) => p.text).join("\n\n");
    return {
      url: vertexUrl(model, key),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ anthropic_version: "vertex-2023-10-16", max_tokens: OUTPUT_TOKENS, messages: [{ role: "user", content: text }] }),
    };
  }
  if (serviceOf(model) === "none") {
    throw new Error(`the model ${model} is not one this agent reaches: name a ${VERTEX}/<id> model (Claude on Vertex AI) or a bare Gemini name`);
  }
  return {
    url: `${GOOGLE_URL}/${encodeURIComponent(model)}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ ...request.body, generationConfig: { maxOutputTokens: OUTPUT_TOKENS } }),
  };
}

const count = (n) => (Number.isFinite(Number(n)) && n !== null && n !== undefined && n !== "" ? Number(n) : null);

/** What came back, whichever service sent it: the text, the model that
 *  answered and what the call used. An answer cut at the output limit is
 *  refused by name, because a cut JSON answer would otherwise be reported as
 *  "not JSON" and the real reason would be lost. `cost` is null where the
 *  service does not report one. */
export function textOf(service, data, model = "") {
  if (service === "vertex") {
    if (data?.stop_reason === "max_tokens") throw new Error("the service's answer was cut at the output limit");
    const text = (Array.isArray(data?.content) ? data.content : []).filter((c) => c?.type === "text").map((c) => c.text ?? "").join("");
    const u = data?.usage ?? {};
    const tin = count(u.input_tokens), tout = count(u.output_tokens);
    return {
      text,
      answered_by: trim(data?.model) ? `${VERTEX}/${trim(data.model)}` : null,
      usage: { tokens_in: tin, tokens_out: tout, cost: vertexCost(model || data?.model, tin, tout) },
    };
  }
  const candidate = data?.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("the service's answer was cut at the output limit");
  const u = data?.usageMetadata ?? {};
  return {
    text: (candidate?.content?.parts ?? []).map((p) => p?.text ?? "").join(""),
    answered_by: trim(data?.modelVersion) || null,
    usage: { tokens_in: count(u.promptTokenCount), tokens_out: count(u.candidatesTokenCount), cost: null },
  };
}

/** The answer, out of whatever wrapping it arrived in.
 *
 *  A model asked for JSON returns JSON in a code fence about as often as it
 *  returns it bare, and an agent that treats a fenced answer as a failure
 *  throws away work it already paid for. */
export function answerFrom(text) {
  const raw = trim(text);
  if (!raw) throw new Error("the service answered with nothing");
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(raw);
  const body = fenced ? fenced[1] : raw;
  let doc;
  try { doc = JSON.parse(body); } catch { throw new Error("the service did not answer with JSON"); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("the service answered with JSON that is not an object");
  if (!doc.spec || typeof doc.spec !== "object" || Array.isArray(doc.spec)) throw new Error("the answer carries no spec");
  const blanks = Array.isArray(doc.blanks)
    ? doc.blanks.filter((b) => b && trim(b.key)).map((b) => ({ key: trim(b.key), question: trim(b.question) }))
    : [];
  return { spec: doc.spec, blanks, notes: trim(doc.notes) };
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
export async function askForSpec({ call, check = null, tries = TRIES, ...opts } = {}) {
  if (typeof call !== "function") throw new Error("askForSpec needs a call");
  // What a good spec carries, and the format rules, holding a revision to
  // them only for the pieces it adds: what an earlier spec already sent as
  // bare JSON is kept, and named in the notes.
  const earlier = earlierBareJson(opts.asked);
  const architecture = opts.asked?.architecture ?? null;
  check ??= (spec) => checkDraft(spec, { earlier, architecture });
  let findings = [];
  let last = null;
  let calls = 0;
  const used = [];
  for (let go = 0; go < tries; go += 1) {
    const request = draftRequest({ ...opts, findings });
    calls += 1;
    // A call answers with the text alone, or with the text and what the call
    // used, which is what main's call does.
    const got = await call(request);
    const said = typeof got === "string" ? { text: got } : got;
    used.push({ model: said?.answered_by ?? null, ...(said?.usage ?? { tokens_in: null, tokens_out: null, cost: null }) });
    last = answerFrom(said?.text);
    findings = check(last.spec);
    if (!findings.length) break;
  }
  // A system the record does not name never stays in the draft.
  const fitted = fitToArchitecture(last.spec, architecture);
  const blanks = blanksOf(fitted.spec, last.blanks);
  if (fitted.blank && !blanks.some((b) => b.key === "architecture")) blanks.push(fitted.blank);
  return {
    spec: fitted.spec,
    blanks,
    notes: last.notes,
    findings: fitted.blank ? findings.filter((f) => !/which the architecture record does not name/.test(f)) : findings,
    calls,
    used,
    tried_again: calls > 1,
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
  const key = trim(env.TEXT_API_KEY);
  if (!key) { console.error("TEXT_API_KEY is required: the text-reasoning credential the install placed"); process.exit(2); }
  const read = (p) => (p && existsSync(p) ? readFileSync(p, "utf8") : "");
  try {
    const asked = JSON.parse(readFileSync(ASKED, "utf8"));
    const answers = ANSWERS && existsSync(ANSWERS) ? JSON.parse(readFileSync(ANSWERS, "utf8")) : null;
    const model = modelOf(env);
    const call = async (request) => {
      const token = serviceOf(request.model) === "vertex" ? await metadataToken() : "";
      const http = httpRequestFor(request, key, token);
      const r = await fetch(http.url, { method: "POST", headers: http.headers, body: http.body });
      if (!r.ok) throw new Error(`the text-reasoning service answered ${r.status}`);
      const d = await r.json();
      if (d?.error) throw new Error(`the text-reasoning service refused: ${trim(d.error.message) || "no reason given"}`);
      return textOf(serviceOf(request.model), d, request.model);
    };
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
      calls: "v1", model, service: serviceOf(model), made: out.calls,
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
      blanks: out.blanks.map((b) => b.key), findings: out.findings, calls: out.calls, model,
    }));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
