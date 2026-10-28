// What was asked: the statement of the job, the organization's stack, the
// platform's defaults and any earlier record, written down before anything is
// decided.
//
// This step has no opinions. It tells the pieces apart by what they are, not
// by what they are called: a stack carries bindings, the platform's defaults
// carry the reserved system names with the House Stack's product on each, an
// earlier record opens with the record's own header, and anything else that
// reads as text is part of the statement. It also tells a revision from a new
// request, and a request this role does not do from one it does, because both
// are decided by the words alone and neither needs a model.
//
//   needs: node >= 22
//   [JOB_DIR=<job folder>, else MESH_JOB_DIR] RECORDS=<records folder>
//   TEXT_FILE=<the message text> [FILES=<path::media_type,...>] node asked.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseRecord, questionsIn, statementIn } from "./architecture-record.mjs";
import { stackOf, houseAt } from "./bind.mjs";
import { note } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** How much of one text attachment is read, in characters. */
export const TEXT_CAP = 40_000;

/** FILES as the skill passes it: path::media_type, comma separated. */
export function parseFiles(text) {
  return String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((entry) => {
    const at = entry.lastIndexOf("::");
    return at > 0 ? { path: entry.slice(0, at), media_type: entry.slice(at + 2) } : { path: entry, media_type: "" };
  });
}

const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".json", ".text"]);
const isText = (path, media) => TEXT_EXT.has(extname(path).toLowerCase()) || /^text\/|json/.test(String(media ?? ""));

/** What one attached file is: "a stack", "the platform's defaults", "an
 *  architecture record", "part of the statement", or "something else", with
 *  its text when it is text. */
export function kindOf(text) {
  if (text == null) return "something else";
  if (parseRecord(text)) return "an architecture record";
  const t = trim(text);
  if (/^[{[]/.test(t)) {
    let doc = null;
    try { doc = JSON.parse(t); } catch { return "something else"; }
    if (stackOf(doc)) return "a stack";
    if (Array.isArray(doc?.systems) && doc.systems.length && doc.systems.every((s) => s && typeof s.name === "string") && doc.systems.some((s) => s.house && typeof s.house === "object")) return "the platform's defaults";
    return "something else";
  }
  return t ? "part of the statement" : "something else";
}

export function oneFile(f) {
  const path = trim(f?.path);
  if (!existsSync(path)) return { name: basename(path), path, missing: true };
  let text = null;
  if (isText(path, f.media_type)) { try { text = readFileSync(path, "utf8"); } catch { text = null; } }
  const cut = text != null && text.length > TEXT_CAP;
  return {
    name: basename(path), path, media_type: trim(f.media_type) || null, size: statSync(path).size,
    kind: kindOf(text),
    ...(text != null ? { sha256: sha(Buffer.from(text)), text: cut ? text.slice(0, TEXT_CAP) : text, text_chars: text.length, ...(cut ? { cut: true } : {}) } : {}),
  };
}

/** The keys the architect asks under, so an answer can be told from a change
 *  without a model: the open questions of the earlier record, and the shapes
 *  this agent's questions always take. */
export const ANSWER_KEY_RE = /^(limit-cost|egress-\d+|reason-\d+|binding-[a-z0-9-]+|system-[a-z0-9-]+)$/;

/** Split a revision's words into answers (`key: value` lines under a key the
 *  record asked) and the change (everything else). */
export function answersIn(text, openKeys = []) {
  const keys = new Set(openKeys);
  const answers = {};
  const rest = [];
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim().replace(/^[-*]\s+/, "").replace(/^answer\s*:\s*/i, "");
    const m = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/.exec(line);
    if (m && (keys.has(m[1]) || ANSWER_KEY_RE.test(m[1]))) answers[m[1]] = m[2].trim();
    else rest.push(raw);
  }
  return { answers, change: rest.join("\n").trim() };
}

/** The roles' lines this agent does not cross (Agent Roles, the solution
 *  architect, section 2): it does not write the statement, design the steps,
 *  or choose the agent that does a step. A message that opens by asking for
 *  one of those is declined in words, before any model is woken. */
export const DECLINES = [
  { re: /^\s*(?:please\s+)?(?:write|draft|give me|produce|make)\s+(?:me\s+)?(?:the|an?|its|this)\s+(?:agent'?s\s+)?(?:statement|requirements)\b/i,
    reply: "I do not write the statement of the job: that is the Requirements stage's, and the person's words are what an architecture answers. Send me the statement, in your own words however untidy, and I will write the architecture record for it." },
  { re: /^\s*(?:please\s+)?(?:write|draft|give me|produce|make|design)\s+(?:me\s+)?(?:the|an?|its|this)\s+(?:agent'?s\s+)?(?:spec|design|steps|plan)\b/i,
    reply: "I do not design the steps or write the spec: that is the Design stage's, held by the spec writer for an agent and the solution planner for a solution, and it designs within the record I write. Send me the statement and I will write the architecture record the Design starts from." },
  { re: /^\s*(?:please\s+)?(?:choose|pick|find|name)\s+(?:the|an?)\s+agents?\s+(?:that|to|for)\b/i,
    reply: "I do not choose the agent that does a step: that is the Source stage's, held by the catalog. I name the systems an agent reaches and bind them; send me the statement and I will write that record." },
];
export const declineOf = (text) => DECLINES.find((d) => d.re.test(String(text ?? "")))?.reply ?? null;

/** The words of a message that are part of the statement: what is left once
 *  the request for the job itself ("Write the architecture, with the
 *  statement attached") is taken off, with shell escapes a sender's tooling
 *  left in ("Write\ the\ architecture") read as the characters they escape. */
export function requestWords(text) {
  let t = String(text ?? "");
  if (/\\ /.test(t)) t = t.replace(/\\([\s,.:;!?'"()\-])/g, "$1");
  t = t.replace(/^\s*(?:please\s+)?write\s+(?:the|an|its)\s+architecture(?:\s+record)?(?:\s*(?:for|of)\s*(?=\S))?[\s,.:;-]*/i, "");
  t = t.replace(/^\s*with\s+the\s+statement(?:\s+of\s+the\s+job)?(?:\.\w+)?\s+attached[\s.,;:]*/i, "");
  return t.trim();
}

/** Whether the words are a revision of an earlier record. */
export const REVISE_RE = /^\s*(?:run r-[a-z0-9-]+(?: phase [a-z0-9-]+)?:\s*)?(?:revise\b|changes?\s*:|answers?\s*:|here is your answer\b)|\bhere is your answer\b/i;

/** A message that is nothing but answers under this agent's own keys is a
 *  revision too, even with no word saying so. */
export const onlyAnswers = (text) => {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim().replace(/^[-*]\s+/, "")).filter(Boolean);
  return lines.length > 0 && lines.every((l) => {
    const m = /^([a-z][a-z0-9-]*)\s*:/.exec(l);
    return Boolean(m) && ANSWER_KEY_RE.test(m[1]);
  });
};

/** The newest record an earlier job of this agent wrote, under the records
 *  root that holds one folder per job. */
export function earlierRecord(recordsRoot, self = "") {
  if (!recordsRoot || !existsSync(recordsRoot)) return null;
  let best = null;
  for (const name of readdirSync(recordsRoot)) {
    const p = join(recordsRoot, name, "record.md");
    if (resolve(join(recordsRoot, name)) === resolve(self) || !existsSync(p)) continue;
    const t = statSync(p).mtimeMs;
    if (!best || t > best.t) best = { path: p, t };
  }
  return best?.path ?? null;
}

export const NOTHING_ASKED = "There is nothing here to write an architecture from. Send me the statement of the job: what the agent is for, in your own words, however untidy. Attach your organization's stack if you have one, and I will bind your products first.";
export const NO_RECORD_TO_REVISE = "This revises an architecture record I do not have. Attach the record (the Markdown file I delivered) with what to change, and I will revise it; I do not write a new record from a change alone.";

/** The record this step writes. `defaultsAt` is where the platform's
 *  defaults are read from when none were attached. */
export function readingOf({ text = "", files = [], earlierPath = null, defaultsAt = houseAt() } = {}) {
  const said = String(text ?? "");
  let attached = files.map(oneFile);
  const decline = declineOf(said);
  const recordFile = attached.find((a) => a.kind === "an architecture record");
  const wantsRevision = Boolean(recordFile) || REVISE_RE.test(said) || onlyAnswers(said);
  let earlier = null;
  if (recordFile) earlier = { from: recordFile.name, text: recordFile.text };
  else if (wantsRevision && earlierPath && existsSync(earlierPath)) earlier = { from: earlierPath, text: readFileSync(earlierPath, "utf8") };
  const stackFile = attached.find((a) => a.kind === "a stack");
  const defaultsFile = attached.find((a) => a.kind === "the platform's defaults");
  const statementParts = attached.filter((a) => a.kind === "part of the statement" && trim(a.text));
  const revision = wantsRevision ? (() => {
    const open = earlier ? questionsIn(earlier.text).map((q) => q.key) : [];
    return answersIn(said.replace(/^\s*(?:run r-[a-z0-9-]+(?: phase [a-z0-9-]+)?:\s*)?(?:revise(?: the architecture(?: record)?)?|changes?)\s*[:.]?/i, ""), open);
  })() : null;
  const statement = earlier
    ? statementIn(earlier.text) || parseRecord(earlier.text)?.statement || ""
    : [requestWords(said), ...statementParts.map((a) => a.text)].map(trim).filter(Boolean).join("\n\n");
  let defaults = null;
  let defaults_from = "attached";
  if (defaultsFile) defaults = JSON.parse(defaultsFile.text);
  else if (defaultsAt) { defaults = JSON.parse(readFileSync(defaultsAt, "utf8")); defaults_from = "this package's copy"; }
  else defaults_from = "none";
  return {
    asked: "v1",
    at: new Date().toISOString(),
    said,
    ...(decline ? { declined: decline } : {}),
    statement,
    attached: attached.map(({ text: _t, ...a }) => a),
    missing_files: attached.filter((a) => a.missing).map((a) => a.name),
    stack: stackFile ? JSON.parse(stackFile.text) : null,
    stack_from: stackFile?.name ?? null,
    defaults,
    defaults_from,
    ...(wantsRevision ? { revision: { earlier_from: earlier?.from ?? null, change: revision.change } } : {}),
    earlier: earlier ? { from: earlier.from, text: earlier.text } : null,
    answers: revision?.answers ?? {},
  };
}

/** The message's words and files. Where the host gives the inbox entry itself
 *  (MESH_MESSAGE_FILE, which a container agent is always given), its words
 *  are read from there, exactly as sent, rather than from a copy a harness
 *  was asked to write. TEXT_FILE and FILES are read where there is no entry,
 *  or to fill what it lacks. */
export function messageOf({ textFile = "", files = "", messageFile = "" } = {}) {
  let entry = null;
  if (messageFile && existsSync(messageFile)) { try { entry = JSON.parse(readFileSync(messageFile, "utf8")); } catch { entry = null; } }
  const fromFile = textFile && existsSync(textFile) ? readFileSync(textFile, "utf8") : "";
  const text = typeof entry?.text === "string" && entry.text.trim() ? entry.text : fromFile;
  let list = parseFiles(files);
  if (!list.length && Array.isArray(entry?.files)) list = entry.files.filter((f) => f && f.path).map((f) => ({ path: f.path, media_type: f.media_type ?? "" }));
  return { text, files: list };
}

/** What the job goes ahead without, said where the reply will read it. */
export function wentWithoutOf(reading) {
  const out = [];
  if (!reading.stack) out.push({ wanted: "the organization's stack", did: "bound every system to the platform's default where the House Stack covers it and asked where it does not, so no binding in this record is the organization's own choice" });
  if (reading.defaults_from === "this package's copy") out.push({ wanted: "the platform's defaults", did: `took them from the copy this package carries (references/house-stack.json, read ${reading.defaults?.read_at ?? "on an unknown date"}), which may be older than the platform's own` });
  for (const name of reading.missing_files) out.push({ wanted: name, did: "wrote the record from what did arrive, and not as though it had" });
  for (const a of reading.attached) if (a.cut) out.push({ wanted: `the whole of ${a.name}`, did: `read its first ${TEXT_CAP.toLocaleString("en-US")} characters`, why: `it is ${a.text_chars.toLocaleString("en-US")} characters long` });
  return out;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS, TEXT_FILE, FILES } = process.env;
  const JOB_DIR = process.env.JOB_DIR || process.env.MESH_JOB_DIR;
  if (!RECORDS || !JOB_DIR) { console.error("JOB_DIR and RECORDS are required"); process.exit(2); }
  try {
    const { text, files } = messageOf({ textFile: TEXT_FILE, files: FILES, messageFile: process.env.MESH_MESSAGE_FILE });
    const reading = readingOf({ text, files, earlierPath: earlierRecord(dirname(resolve(RECORDS)), RECORDS) });
    mkdirSync(RECORDS, { recursive: true });
    writeFileSync(join(RECORDS, "asked.json"), JSON.stringify(reading, null, 2) + "\n");
    const stop = (reply) => { console.log(JSON.stringify({ ok: false, code: 3, reply })); process.exitCode = 3; };
    if (reading.declined) stop(reading.declined);
    else if (reading.revision && !reading.earlier) stop(NO_RECORD_TO_REVISE);
    else if (!trim(reading.statement)) stop(NOTHING_ASKED);
    else {
      for (const w of wentWithoutOf(reading)) note(RECORDS, w);
      console.log(JSON.stringify({
        ok: true, code: 0, asked: join(RECORDS, "asked.json"),
        said: `${reading.statement.split(/\s+/).filter(Boolean).length} words of statement; ${reading.stack ? `the organization's stack (${reading.stack_from})` : "no stack"}; defaults from ${reading.defaults_from}${reading.revision ? `; a revision of ${reading.earlier.from} with ${Object.keys(reading.answers).length} answers` : ""}`,
      }));
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
