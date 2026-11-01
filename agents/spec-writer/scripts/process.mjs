// The write-a-process job as one command: a person's words in, an Agent
// Processes 0.9.0 document and what is still open out, checked before it is
// handed back.
//
// The steps, in order:
//   1. read what was asked: the words, and an attached process document to
//      revise (found BY CONTENT: a file whose text opens with PROCESS:, under
//      whatever name the process runner's hops gave it);
//   2. draft-the-process: one model call drafts the parts as JSON
//      (process-draft.mjs), and code writes the document from them;
//   3. check-the-process: the checker this package carries
//      (process-check.mjs, standards/process-check.mjs byte for byte) reads
//      the document for Agent Processes 0.9.0's §17.1 items and the four tests
//      of §20.1. What it finds goes back to the model once, with the
//      document's parts, and never a third time; what is still wrong after
//      the second go is said in the reply and asked as an open question, never
//      delivered as if it were right;
//   4. the pieces: the document as out/<slug>.process.txt and the open
//      questions as out/still-open.md, listed in pieces.json; and one reply.
//
// Every run, whatever happens, writes into RECORDS: process-asked.json (what
// arrived), process-draft.json (each answer and the draft read from it),
// process-check.json (the last check), calls.json (each model call) and
// went-without.json (what the job went without and what it did instead).
//
// The model is reached only through the shared caller (model-caller.mjs) and
// the four settings the install places, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY
// and MODEL_PROTOCOL, read on every run; the package names no model.
//
//   needs: node >= 22; the four model settings
//   JOB_DIR=<job folder> (else MESH_JOB_DIR) RECORDS=<records folder> TEXT_FILE=<message file> \
//     [FILES=<path>::<media type>,...] node process.mjs
//   prints one JSON object whose `reply` is the whole answer
//   exit 0 a document was written (or the request was refused in words),
//        2 the command was called wrong, 3 nothing to write a process from,
//        4 the model gave no usable answer
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, cannotCall, readJson } from "./model-caller.mjs";
import { promptFor, readDraft, fixHolders, renderProcess, openQuestions, PROCESS_KIND } from "./process-draft.mjs";
import { checkProcess, SPEC_VERSION } from "./process-check.mjs";
import { note } from "./went-without.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The request formats the package's text-reasoning system declares, read
 *  from agent-runtime-requirements.json beside the package (one level up in
 *  the source, three in a built package's skills/<slug>/scripts/), as
 *  draft.mjs reads them; null when they cannot be read, and then nothing is
 *  sent. */
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
/** What is still open, as Markdown a person reads (the form write-a-spec's
 *  still-open.md has). */
export const openQuestionsMarkdown = (questions) =>
  ["# What is still open", "", ...questions.map((q) => `- \`${q.key}\`: ${q.question}`)].join("\n") + "\n";

export const REPLY_MAX = 3400;
export const TRIES = 2;
/** The whole drafting budget, in seconds; each call is cut at what is left. */
export const PROCESS_SECONDS = 420;
export const OUTPUT_TOKENS = 16000;
const FILE_MAX = 400_000;

const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, Math.max(0, n - 3)).trimEnd()}...` : String(s)); // cut-ok: reply text fitted to its room; the document and the questions are whole in the pieces
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** An attached process document, found by its content. */
export function earlierDocument(files = [], read = (p) => readFileSync(p, "utf8")) {
  for (const f of files) {
    if (!f?.path) continue;
    try {
      if (!existsSync(f.path) || statSync(f.path).size > FILE_MAX) continue;
      const t = read(f.path);
      if (/^\s*PROCESS:/m.test(t.split("\n").slice(0, 5).join("\n"))) return { path: f.path, text: t };
    } catch { /* an unreadable file is not a document */ }
  }
  return null;
}

/** The call this job makes when it is handed none: the prompt through the
 *  shared caller, with the package's declared protocols, as JSON. */
export function askFor(env = process.env, { protocols = declaredProtocols() } = {}) {
  return async (prompt, { seconds = PROCESS_SECONDS } = {}) => {
    if (!(Array.isArray(protocols) && protocols.length)) throw new Error(PROTOCOLS_UNREAD);
    const got = await callModel(prompt, { env, protocols, json: true, maxOutputTokens: OUTPUT_TOKENS, timeoutMs: Math.max(1000, Math.floor(seconds * 1000)) });
    return { text: got.text, answered_by: got.answered_by ?? null, tokens_in: got.tokens_in ?? null, tokens_out: got.tokens_out ?? null, model: got.model ?? null };
  };
}

/** The reply: what was written, each step, the check, and what is open. */
export function replyFor({ draft, check, questions, notes = [] }) {
  const gates = draft.phases.filter((p) => p.automation === "never").length;
  const head = `I wrote the process "${draft.name.toLowerCase()}" (<team>/${draft.slug} v1) as an Agent Processes 0.9.0 document: ${draft.phases.length} step${draft.phases.length === 1 ? "" : "s"}, ${gates} approval${gates === 1 ? "" : "s"} a person signs, ${draft.deviations.length} way${draft.deviations.length === 1 ? "" : "s"} back. No step names an agent: each is held by a role the catalog answers next, or a person.`;
  const steps = draft.phases.map((p, i) => `${i + 1}. ${p.name}: ${p.form}, held by ${p.holder.role === "whoever starts the run" ? "whoever starts the run" : `${p.holder.role} (${p.holder.kind})`}, ${p.automation}${p.reaches_outside ? `; reaches outside: ${p.reaches_outside}` : ""}`);
  const verdict = check.conforms && check.clean
    ? `The process check: it conforms to Agent Processes ${SPEC_VERSION} and has no findings (${check.digest}).`
    : `The process check: it ${check.conforms ? `conforms to Agent Processes ${SPEC_VERSION}` : `does not conform to Agent Processes ${SPEC_VERSION}`} (${check.digest}): ${[...check.failures.map((f) => `${f.section} ${f.text}`), ...check.findings.map((f) => `${f.test}: ${f.text}`)].join("; ")}`;
  const open = ["Still open:", ...questions.map((q) => `- \`${q.key}\`: ${q.question}`)].join("\n");
  const said = notes.length ? `What changed after the model answered: ${notes.join("; ")}.` : "";
  const parts = [head, steps.join("\n"), clip(verdict, 900), said ? clip(said, 400) : "", open].filter(Boolean);
  let reply = parts.join("\n\n");
  if (reply.length > REPLY_MAX) reply = `${clip(parts.slice(0, -1).join("\n\n"), REPLY_MAX - 200)}\n\nStill open: ${questions.map((q) => `\`${q.key}\``).join(", ")}, each asked in full in still-open.md.`;
  return reply;
}

/** The job. { code, reply } out; the document and the check when one was written. */
export async function writeProcess({ text = "", files = [], records, jobDir, ask, today = new Date().toISOString().slice(0, 10), seconds = PROCESS_SECONDS, env = process.env } = {}) { // cut-ok: the date part of an ISO time
  if (!records || !jobDir) return { code: 2, reply: "RECORDS and JOB_DIR are required." };
  mkdirSync(records, { recursive: true });
  const calls = [];
  const tries = [];
  const went = [];
  const json = (name, body) => writeFileSync(join(records, name), `${JSON.stringify(body, null, 2)}\n`);
  const finish = (out) => {
    json("calls.json", { model_calls: "v1", calls });
    json("process-draft.json", { process_draft: "v1", tries });
    rmSync(join(records, "went-without.json"), { force: true });
    if (went.length) for (const w of went) note(records, w);
    else writeFileSync(join(records, "went-without.json"), `${JSON.stringify({ went_without: "v1", entries: [] }, null, 2)}\n`);
    return out;
  };

  const earlier = earlierDocument(files);
  json("process-asked.json", { process_asked: "v1", words: String(text ?? ""), files: files.map((f) => ({ path: f?.path ?? "", media_type: f?.media_type ?? "" })), earlier: earlier ? { path: earlier.path, sha256: sha256(earlier.text) } : null });
  if (!one(text) && !earlier) {
    went.push({ wanted: "the person's words saying what the process is for", did: "wrote nothing and woke no model", why: "the message was empty" });
    return finish({ code: 3, reply: "There is nothing to write a process from: the message is empty and no process document came with it. Say what the work is, who does each part, and where you want to sign, and ask again." });
  }

  let asking = ask;
  if (!asking) {
    const why = whyNoCall(env);
    if (why) {
      went.push({ wanted: "a model to draft the process", did: "wrote nothing", why });
      return finish({ code: 4, reply: `I cannot write this process now: no model can be called (${why}), so no document was written.` });
    }
    asking = askFor(env);
  }

  const started = Date.now();
  let draft = null, previous = null, findings = [], check = null, notes = [], textOut = null;
  for (let i = 1; i <= TRIES; i++) {
    const left = seconds - (Date.now() - started) / 1000;
    if (i > 1 && left < 30) { went.push({ wanted: "a second go at the document", did: "kept the first", why: `${Math.round(left)} seconds were left` }); break; }
    const prompt = promptFor({ words: text, earlier: earlier?.text ?? "", findings, previous, today });
    let answer;
    try {
      answer = await asking(prompt, { seconds: Math.max(1, left) });
    } catch (e) {
      calls.push({ try: i, ok: false, error: one(e?.message ?? e) });
      tries.push({ try: i, error: one(e?.message ?? e) });
      if (i < TRIES && !draft) { findings = []; continue; }
      break;
    }
    calls.push({ try: i, ok: true, model: answer.model ?? null, answered_by: answer.answered_by ?? null, tokens_in: answer.tokens_in ?? null, tokens_out: answer.tokens_out ?? null, prompt_sha256: sha256(prompt) });
    let value = null;
    try { value = readJson(answer.text); } catch { value = null; }
    const read = readDraft(value);
    tries.push({ try: i, answer: value ?? String(answer.text ?? ""), problems: read.problems });
    if (!read.draft || (read.problems.length && !read.draft.phases.length && !read.draft.refused)) {
      findings = read.problems.length ? read.problems : ["the answer was not one JSON object"];
      went.push({ wanted: `a usable answer from the model on try ${i}`, did: i < TRIES ? "asked again once with what was wrong" : "wrote no document", why: clip(findings.join("; "), 240) });
      continue;
    }
    if (read.draft.refused) { draft = read.draft; break; }
    const fixed = fixHolders(read.draft, text);
    notes = fixed.notes;
    draft = fixed.draft;
    previous = value;
    textOut = renderProcess(draft, { today });
    check = checkProcess(textOut);
    const wrong = [...read.problems, ...check.failures.map((f) => `${f.section} ${f.text}`), ...check.findings.map((f) => `${f.test} (${f.section}): ${f.text}`)];
    if (!wrong.length) break;
    findings = wrong;
    if (i < TRIES) went.push({ wanted: "a document that conforms to Agent Processes 0.9.0 on the first go", did: "asked the model once more with what the check found", why: clip(wrong.join("; "), 240) });
  }

  if (draft?.refused) {
    json("process-check.json", { process_check: "v1", checked: false, why: "the request was refused" });
    return finish({ code: 0, reply: `I cannot write this process: ${draft.refused}` });
  }
  if (!draft || !textOut) {
    const why = tries.map((t) => t.error ?? (t.problems ?? []).join("; ")).filter(Boolean).join("; ") || "no answer";
    json("process-check.json", { process_check: "v1", checked: false, why });
    return finish({ code: 4, reply: `I cannot write this process: the model gave no usable answer on either try (${clip(why, 300)}), so no document was written.` });
  }

  const questions = openQuestions(draft, check.conforms && check.clean ? null : check);
  json("process-check.json", { process_check: "v1", conforms: check.conforms, clean: check.clean, digest: check.digest, failures: check.failures, findings: check.findings });
  const docPath = `out/${draft.slug}.process.txt`;
  mkdirSync(join(jobDir, "out"), { recursive: true });
  writeFileSync(join(jobDir, docPath), textOut);
  writeFileSync(join(jobDir, "out", "still-open.md"), openQuestionsMarkdown(questions));
  writeFileSync(join(jobDir, "pieces.json"), `${JSON.stringify([
    { name: "the process document", step: "draft-the-process", path: docPath, media_type: PROCESS_KIND, about: "The process as an Agent Processes 0.9.0 document: its trigger and what a run is handed, the steps with who holds each by role, the handoffs, the approvals and the ways back. Checked against the specification before it was handed on.", produced_from: ["what the process is for"] },
    { name: "what is still open", step: "check-the-process", path: "out/still-open.md", media_type: "text/markdown", about: "The questions nobody else could answer: the name, the owner, who signs, what may reach outside, and anything else the words left open.", produced_from: ["what the process is for"] },
  ], null, 2)}\n`);
  return finish({ code: 0, reply: replyFor({ draft, check, questions, notes }), document: textOut, check });
}

/** FILES as the harness passes it: path::media type, comma separated. */
export function filesFrom(spec = "") {
  return String(spec).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const at = s.lastIndexOf("::");
    return at > 0 ? { path: s.slice(0, at), media_type: s.slice(at + 2) } : { path: s, media_type: "" }; // cut-ok: a split at a position
  });
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(`/${thisFile}`)) {
  const env = process.env;
  const jobDir = env.JOB_DIR || env.MESH_JOB_DIR;
  if (!jobDir || !env.RECORDS) { console.error("JOB_DIR (or MESH_JOB_DIR) and RECORDS are required, with TEXT_FILE and any FILES"); process.exit(2); }
  let text = "";
  try { text = env.TEXT_FILE && existsSync(env.TEXT_FILE) ? readFileSync(env.TEXT_FILE, "utf8") : ""; } catch { text = ""; }
  try {
    const out = await writeProcess({ text, files: filesFrom(env.FILES), records: env.RECORDS, jobDir });
    console.log(JSON.stringify({ reply: out.reply }));
    process.exit(out.code);
  } catch (e) {
    console.log(JSON.stringify({ reply: `I could not finish this job: ${e?.message ?? e}` }));
    process.exit(1);
  }
}
