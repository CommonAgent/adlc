// What was asked for: the request as it arrived, what came with it, and the
// checklist of what a spec needs, written down before anything is drafted.
//
// This step has no opinions. It does not decide what the message settles and
// what it leaves open, because that is a judgment and judgments belong to the
// step that calls a model. What it does is make the raw material legible: the
// words as received, each attached file with what it mechanically appears to
// be, and the list of things a finished spec carries, so that what is still
// missing is visible from the first record rather than discovered at the end.
//
//   needs: node >= 22
//   [JOB_DIR=<job folder>, else MESH_JOB_DIR] RECORDS=<records folder>
//   TEXT_FILE=<the message text> [FILES=<path::media_type,...>] node asked.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { agentFilesAmong, layOutAgentFiles, skillSlugOf, specOfFolder } from "./agent-folder.mjs";
import { parseRecord } from "./architecture-record.mjs";

const trim = (s) => String(s ?? "").trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** What a spec carries, in the order it carries it.
 *
 *  `settled_by` is the honest half. Most of a spec can be drafted from what
 *  somebody said and then put to them for correction. Three things cannot be
 *  drafted at all, and inventing them is worse than asking: a name is theirs
 *  to choose, a price is their money, and access to a system is authority
 *  nobody can grant on their behalf. Those three are asked, never guessed. */
export const NEEDS = [
  { key: "name", what: "what the agent is called", settled_by: "the person",
    ask: "What should this agent be called? It becomes its handle on the mesh and cannot be changed later without a redeploy." },
  { key: "offering", what: "the one thing a caller orders", settled_by: "drafting" },
  { key: "when", what: "when this job is the right one, for somebody choosing between jobs", settled_by: "drafting" },
  { key: "good", what: "what a good result looks like, as the artifact and not the effort", settled_by: "drafting" },
  { key: "empty", what: "what it does when there is nothing to give", settled_by: "drafting" },
  { key: "inputs", what: "what the job takes", settled_by: "drafting" },
  { key: "outputs", what: "what the job produces", settled_by: "drafting" },
  { key: "steps", what: "what the agent runs to deliver the offering", settled_by: "drafting" },
  { key: "how", what: "control, intelligence, cost and contract for each job", settled_by: "drafting" },
  { key: "refuses", what: "the acts it will not perform", settled_by: "drafting" },
  { key: "records", what: "what it leaves behind for somebody to audit", settled_by: "drafting" },
  { key: "systems", what: "what it reaches, at what access, with which credential", settled_by: "the person",
    ask: "Does this agent need to reach anything outside its own folder: a service, a directory, an MCP server? Name it and say whether it only reads or also writes. I cannot grant access nobody mentioned." },
  { key: "price", what: "what it costs a caller", settled_by: "the person",
    ask: "What should this cost per job, or should it be free? Flat is the usual answer." },
];

export const ASKED_OF_PERSON = NEEDS.filter((n) => n.settled_by === "the person").map((n) => n.key);

/** What an attached file mechanically appears to be.
 *
 *  Mechanically, and nothing more. A file's name and its first bytes are
 *  facts; what the person meant by attaching it is not, and is left to the
 *  drafting step. The one kind worth telling apart with real care is a spec:
 *  somebody who attaches one is revising or copying it, and that changes what
 *  the draft should be far more than any other attachment. */
export const KINDS = ["a spec", "an agent's own file", "an architecture record", "a descriptor", "a script", "a document", "data", "an image", "something else"];

/** One of the files this agent delivers, the layout a package is authored in:
 *  a draft descriptor or runtime requirements (told by their format), a
 *  manifest (an Agent Plugins manifest with this platform's extension), or a
 *  SKILL.md (frontmatter naming the skill). Somebody who sends these back is
 *  revising the draft they describe. */
export function looksLikeAgentFile(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (doc.format === "agent-descriptor-v1" || doc.format === "agent-runtime-requirements-v1" || doc.format === "agent-install-v1") return true;
  const ext = doc.extensions;
  return Boolean(ext && typeof ext === "object" && "net.agentdoc.package" in ext);
}
export const looksLikeSkill = (text) => skillSlugOf(text) !== null;

const SCRIPT_EXT = new Set([".mjs", ".js", ".cjs", ".ts", ".py", ".sh", ".bash"]);
const DOC_EXT = new Set([".md", ".markdown", ".txt", ".rst", ".pdf"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

/** How much of a text attachment travels to the drafting step, in characters.
 *
 *  What somebody attached is part of what they asked for: a person who sends
 *  a design document and gets a draft written from its filename has been
 *  answered by somebody who did not read it. So text is carried, whole up to
 *  this much and cut past it, with the cut said in the record. The cap is
 *  there because one attachment is not allowed to be the whole request. */
export const TEXT_CAP = 40_000;

/** Is this something a reader can open as text? Scripts, JSON and plain
 *  documents are; a PDF is a document and is not text, so it is named and
 *  not opened. Images and anything unrecognised are never read. */
export function isText(path, mediaType = "") {
  const ext = extname(String(path ?? "")).toLowerCase();
  const media = String(mediaType ?? "");
  if (IMAGE_EXT.has(ext) || media.startsWith("image/") || ext === ".pdf" || media.includes("pdf")) return false;
  return SCRIPT_EXT.has(ext) || ext === ".json" || media.includes("json") || DOC_EXT.has(ext) || media.startsWith("text/");
}

/** Does this JSON look like a package spec? Every spec the builder accepts
 *  carries a name, a version and jobs, and a job carries a slug. Checked
 *  rather than assumed from the file name, because "spec.json" is a name
 *  anything can have. */
export function looksLikeSpec(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (typeof doc.name !== "string" || !doc.name) return false;
  if (!Array.isArray(doc.jobs) || !doc.jobs.length) return false;
  return doc.jobs.every((j) => j && typeof j === "object" && typeof j.slug === "string" && j.slug);
}

/** Does this JSON look like a bound or draft descriptor? */
export function looksLikeDescriptor(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  return Array.isArray(doc.offerings) && (typeof doc.agent === "string" || typeof doc.name === "string");
}

export function kindOf(path, mediaType = "", body = null) {
  const ext = extname(String(path ?? "")).toLowerCase();
  if (IMAGE_EXT.has(ext) || String(mediaType).startsWith("image/")) return "an image";
  if (SCRIPT_EXT.has(ext)) return "a script";
  if (ext === ".json" || String(mediaType).includes("json")) {
    if (body != null) {
      let doc = null;
      try { doc = JSON.parse(body); } catch { return "data"; }
      if (looksLikeSpec(doc)) return "a spec";
      if (looksLikeAgentFile(doc)) return "an agent's own file";
      if (looksLikeDescriptor(doc)) return "a descriptor";
    }
    return "data";
  }
  if (body != null && looksLikeSkill(body)) return "an agent's own file";
  // The Architecture stage's record (agents/solution-architect): the systems
  // this agent may reach and the products bound to them. Told by its own
  // header, never by its name.
  if (body != null && parseRecord(body)) return "an architecture record";
  if (DOC_EXT.has(ext) || String(mediaType).startsWith("text/")) return "a document";
  return "something else";
}

/** FILES as the skill passes it: path::media_type, comma separated. A media
 *  type is optional; the extension answers when it is absent. */
export function parseFiles(text) {
  return String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((entry) => {
    const at = entry.lastIndexOf("::");
    return at > 0
      ? { path: entry.slice(0, at), media_type: entry.slice(at + 2) }
      : { path: entry, media_type: "" };
  });
}

const readerOf = (io) => io?.read ?? ((p) => readFileSync(p, "utf8"));
const sizerOf = (io) => io?.size ?? ((p) => statSync(p).size);
const existsOf = (io) => io?.exists ?? ((p) => existsSync(p));

/** One attached file, as a fact. A file that is not there is recorded as not
 *  there rather than dropped: an attachment the sender believes they sent and
 *  this agent never opened is exactly the thing that has to be visible. */
export function oneFile(f, io = {}) {
  const path = trim(f?.path);
  const media_type = trim(f?.media_type);
  if (!existsOf(io)(path)) return { name: basename(path), path, media_type, kind: null, missing: true };
  let size = 0;
  try { size = sizerOf(io)(path); } catch { /* recorded below as unreadable */ }
  let body = null;
  // Only text is opened: to tell a spec from any other JSON, and to carry what
  // the person attached to the step that drafts from it. Nothing here reads
  // an image or a binary into memory to guess at it.
  if (isText(path, media_type)) {
    try { body = readerOf(io)(path); } catch { body = null; }
  }
  const cut = body != null && body.length > TEXT_CAP;
  return {
    name: basename(path), path, media_type: media_type || null,
    kind: kindOf(path, media_type, body), size,
    ...(body != null ? { sha256: sha(Buffer.from(body)) } : {}),
    // The text itself, so the drafting step reads what was sent and not its
    // name. `text_chars` is the whole length; a reader of the record can tell
    // a cut file from a short one.
    ...(body != null ? { text: cut ? body.slice(0, TEXT_CAP) : body, text_chars: body.length, ...(cut ? { cut: true } : {}) } : {}),
  };
}

/** What a message that revises an earlier draft looks like, and the answers
 *  in it. The runner relays an owner's answer as "here is your answer",
 *  sends a draft back with "changes: ...", and a person writes "answer: ..."
 *  or "name: x" lines. On 2026-09-15 a relayed answer with no draft attached
 *  was read as a new request and a spec was drafted for the wrong agent from
 *  the answer's own words; a "changes" send-back was redrafted from nothing.
 *  Neither is a request: both are answers about a draft that already exists.
 *  Returns null for a plain request. */
export function revisionIn(text) {
  const t = String(text ?? "").replace(/\r/g, "");
  const lines = t.split("\n").map((l) => l.trim());
  const relayed = /^run r-[a-z0-9-]+ phase [a-z0-9-]+: here is your answer/i.test(lines[0] ?? "")
    || /\bhere is your answer\b/i.test(t);
  const sentBack = /(^|\n)\s*(?:run r-[a-z0-9-]+(?: phase [a-z0-9-]+)?:\s*)?changes\s*:/i.test(t)
    || /\bwhy this phase runs again: deviation \[changes\]/i.test(t);
  const answered = /(^|\n)\s*(?:run r-[a-z0-9-]+(?: phase [a-z0-9-]+)?:\s*)?answer\s*:/i.test(t);
  const keyed = {};
  for (const l of lines) {
    const m = /^(name|systems|price)\s*:\s*(.+)$/i.exec(l.replace(/^(?:run r-[a-z0-9-]+(?: phase [a-z0-9-]+)?:\s*)?(?:changes|answer)\s*:\s*/i, ""));
    if (m) keyed[m[1].toLowerCase()] = m[2].trim();
  }
  if (!relayed && !sentBack && !answered && !Object.keys(keyed).length) return null;
  // A new request may settle the name and the price in the same "name: x"
  // lines an answer uses: the Build page's request opens "Write a spec." and
  // says "what it should do:", then names both. That is a request, not an
  // answer about an earlier draft. On 2026-10-03 it was read as a revision:
  // the step stopped where no earlier draft existed, and where one did it
  // took an unrelated agent's draft as the one to revise.
  const newRequest = /^write a spec\b/i.test(lines[0] ?? "") && lines.some((l) => /^what it should do\s*:/i.test(l));
  if (newRequest && !relayed && !sentBack && !answered) return null;
  // Everything said, minus the runner's own frame lines, as the answer when
  // no key names it: the drafting step hands it to the model beside the draft.
  const said = lines.filter((l) => l && !/^run r-[a-z0-9-]+ phase [a-z0-9-]+: here is your answer$/i.test(l)
    && !/^\(answered (?:by|from) /i.test(l) && !/^Continue the work and reply/i.test(l)).join("\n");
  return { how: relayed ? "relayed answer" : sentBack ? "sent back with changes" : answered ? "answer" : "keyed answers",
    answers: { ...(Object.keys(keyed).length ? keyed : {}), ...(said ? { said } : {}) } };
}

/** The newest draft an earlier job of this agent wrote, under the records
 *  root that holds one folder per job. Null when there is none. */
export function earlierDraft(recordsRoot, io = {}) {
  const list = io.list ?? ((d) => readdirSync(d));
  const mtime = io.mtime ?? ((p) => statSync(p).mtimeMs);
  const exists = io.exists ?? existsSync;
  if (!recordsRoot || !exists(recordsRoot)) return null;
  let best = null;
  for (const name of list(recordsRoot)) {
    const p = join(recordsRoot, name, "draft.json");
    if (!exists(p)) continue;
    const t = mtime(p);
    if (!best || t > best.t) best = { path: p, t };
  }
  return best?.path ?? null;
}

/** The record this step writes.
 *
 *  `needs` is the whole checklist every time, with nothing marked settled,
 *  because this step does not judge. What it does say is which of them the
 *  person has to answer themselves whatever the draft says. */
export function readingOf({ text = "", files = [], io = {} } = {}) {
  const attached = (files ?? []).map((f) => oneFile(f, io));
  const said = String(text ?? "");
  const revision = revisionIn(said);
  return {
    asked: "v1",
    at: new Date().toISOString(),
    said,
    // A revision: answers about a draft that already exists, never a request
    // for a new agent. The drafting step refuses to draft from one without
    // the draft in hand.
    ...(revision ? { revision } : {}),
    words: said.split(/\s+/).filter(Boolean).length,
    attached,
    missing_files: attached.filter((a) => a.missing).map((a) => a.name),
    // A spec somebody attached is the single most consequential thing in the
    // request, so it is named at the top level rather than left for a reader
    // to find by scanning kinds.
    spec_attached: attached.filter((a) => a.kind === "a spec").map((a) => a.name),
    // The files this agent delivers, sent back: a revision of the draft they
    // describe, read whole by the drafting step like any other attachment.
    files_attached: attached.filter((a) => a.kind === "an agent's own file").map((a) => a.name),
    // The architecture record the Design starts from: the systems it names
    // are the only systems the draft may declare (references/
    // what-a-good-spec-carries.md, "Design starts from the architecture").
    ...architectureOf(attached),
    needs: NEEDS.map((n) => ({ key: n.key, what: n.what, settled_by: n.settled_by })),
    to_ask: ASKED_OF_PERSON,
  };
}

/** The architecture record among the attachments, read: the file's name and
 *  its header (systems, environments, kind, whether it is finished, how many
 *  questions it leaves open). Empty when none came. */
export function architectureOf(attached = []) {
  const a = attached.find((x) => x.kind === "an architecture record" && typeof x.text === "string");
  const h = a ? parseRecord(a.text) : null;
  return h ? { architecture: { from: a.name, systems: h.systems, environments: h.environments, kind: h.kind, done: h.done, questions: h.questions, bindings: h.bindings, standing_assets: h.standing_assets } } : {};
}

/** What this step says out loud. Not the reply to the buyer, which the last
 *  step writes; this is the line the next step and the operator's log read. */
export function summary(reading) {
  const n = reading.attached.length;
  const kinds = [...new Set(reading.attached.filter((a) => !a.missing).map((a) => a.kind))];
  const bits = [`${reading.words} words`];
  if (n) bits.push(`${n} file${n === 1 ? "" : "s"}${kinds.length ? ` (${kinds.join(", ")})` : ""}`);
  else bits.push("nothing attached");
  if (reading.missing_files.length) bits.push(`${reading.missing_files.length} named and not there: ${reading.missing_files.join(", ")}`);
  if (reading.spec_attached.length) bits.push(`a spec came with it: ${reading.spec_attached.join(", ")}`);
  if (reading.architecture) bits.push(`an architecture record came with it: ${reading.architecture.from} (${reading.architecture.systems.join(", ") || "no systems"}${reading.architecture.done ? "" : ", not finished"})`);
  if (reading.files_attached?.length) bits.push(`the agent's own files came with it: ${reading.files_attached.join(", ")}`);
  return bits.join("; ");
}

export const NO_DRAFT_TO_REVISE =
  "This answers questions about a draft I do not have. Attach the draft's files (agent-descriptor.json, "
  + "agent-runtime-requirements.json, plugin.json and the SKILL.md files) with the answers and I will "
  + "revise it; I do not write a new draft from an answer.";

export const NOTHING_ASKED =
  "There is nothing here to write a spec from. Say what you want the agent to do, in your own words, "
  + "and attach anything that shows what it will work on. I do not need the answer to be tidy.";

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS, TEXT_FILE, FILES } = process.env;
  const JOB_DIR = process.env.JOB_DIR || process.env.MESH_JOB_DIR;
  if (!RECORDS || !JOB_DIR) { console.error("JOB_DIR and RECORDS are required"); process.exit(2); }
  try {
    const text = TEXT_FILE && existsSync(TEXT_FILE) ? readFileSync(TEXT_FILE, "utf8") : "";
    const files = parseFiles(FILES);
    let reading = readingOf({ text, files });
    mkdirSync(RECORDS, { recursive: true });
    // The agent's own files sent back are read as the spec they state, the
    // way the builder reads a folder, so a revision starts from exactly what
    // was delivered (and any change made to it) and not from a model's
    // reading of the files.
    if (reading.revision && !reading.spec_attached.length && reading.files_attached.length) {
      const found = agentFilesAmong(files.map((f) => f.path));
      if (found) {
        const back = layOutAgentFiles(found, join(RECORDS, "sent-back"));
        const at = join(RECORDS, "sent-back.json");
        writeFileSync(at, JSON.stringify(specOfFolder(back), null, 2) + "\n");
        reading = readingOf({ text, files: [...files, { path: at, media_type: "application/json" }] });
        reading.revision.draft_from = "the attached files";
        // The seed is the draft revised whether or not it has a name yet:
        // an open name is the usual first round.
        const seed = reading.attached.find((a) => a.path === at);
        if (seed && seed.kind !== "a spec") { seed.kind = "a spec"; reading.spec_attached.push(seed.name); }
      }
    }
    // A revision with no draft attached takes the newest draft an earlier
    // job of this agent wrote; the harness used to be asked to find it and
    // did not. Still none, and this step stops before any model is woken.
    if (reading.revision && !reading.spec_attached.length && !reading.files_attached.length) {
      const earlier = earlierDraft(dirname(resolve(RECORDS)));
      if (earlier) {
        reading = readingOf({ text, files: [...files, { path: earlier, media_type: "application/json" }] });
        reading.revision.draft_from = earlier;
      }
    }
    const out = join(RECORDS, "asked.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(reading, null, 2) + "\n");
    if (reading.revision) {
      // The answers, keyed, where the drafting step reads them. The harness
      // used to write this file itself and wrote it wrong or not at all.
      writeFileSync(join(RECORDS, "answers.json"), JSON.stringify(reading.revision.answers, null, 2) + "\n");
    }
    if (reading.revision && !reading.spec_attached.length && !reading.files_attached.length) {
      console.log(JSON.stringify({ ok: false, code: 3, reply: NO_DRAFT_TO_REVISE, asked: out }));
      process.exitCode = 3;
    } else if (!reading.words && !reading.attached.some((a) => !a.missing)) {
    // Nothing to work from is a stop, and it is this step's to make: the
    // drafting step would otherwise spend a model call to discover it.
      console.log(JSON.stringify({ ok: false, code: 3, reply: NOTHING_ASKED, asked: out }));
      process.exitCode = 3;
    } else {
      console.log(JSON.stringify({ ok: true, code: 0, asked: out, said: summary(reading) + (reading.revision ? `; a revision (${reading.revision.how})` : "") }));
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
