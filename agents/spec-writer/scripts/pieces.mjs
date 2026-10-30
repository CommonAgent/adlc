// Fill a job folder from a finished draft: every delivered piece under out/,
// and pieces.json, the list the adapter reads when the reply is sent, one
// entry per piece with the step that made it and a sentence saying what it is.
// The adapter signs the job manifest from that list; a reply with no
// pieces.json carries no job.
//
// The pieces are the agent's own files, the layout Common Agent 13.2 says a
// package is authored in: agent-descriptor.json, agent-runtime-requirements.json,
// plugin.json and one SKILL.md per skill, as builds.mjs took them from what
// the builder made of the draft. Whoever takes them next (the test writer,
// the code writer, the package maker) finds each one by its content, and the
// package maker builds the folder they make. Nothing here delivers a spec.json:
// the draft is this agent's working record, kept under its records.
//
// What is still open goes as a file of its own rather than only as prose in
// the reply, because a reply is read once and a file is still there next week
// when somebody comes back to finish the thing.
//
// A draft the builder did not take has no files, and none are delivered: a
// declaration nothing can build is not handed on as though it were one. The
// reply says why, and the next round starts from the kept draft.
//
//   needs: node >= 22
//   [JOB_DIR=<job folder>, else MESH_JOB_DIR] RECORDS=<records folder> node pieces.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { questionsFor } from "./ask.mjs";

/** Copy a file by its BYTES, never with copyFileSync, which carries the
 *  source file's mode and is refused by a job folder reached through a mount
 *  that serves a fixed one. */
const copyBytes = (from, to) => writeFileSync(to, readFileSync(from));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

export const STEP_OF = {
  "files": "draft-the-spec",
  "the container spec": "draft-the-spec",
  "what is still open": "ask-what-is-missing",
};

const ABOUT = {
  "agent-descriptor.json": "The draft Agent Descriptor: what the agent offers, what each job takes and produces, how each job is done, what it refuses and what it records. One of the agent's own files, with the runtime requirements, plugin.json and the skills; the scripts they name do not exist yet.",
  "agent-runtime-requirements.json": "The draft runtime requirements: what a host must have and do to run the agent, each system's binding, its directories and how each job runs. One of the agent's own files.",
  "plugin.json": "The agent's manifest, with the builder's own entry naming the files each skill carries. One of the agent's own files.",
  skill: "A skill's SKILL.md: when the job is the right one, what a good result looks like, what it does when there is nothing to give, and how it is done. One of the agent's own files.",
  "the container spec": "A container agent's checked spec: its code is a program in its own repository, so it makes no package and has none of the files a package is built from, and a container deploy is filed with this.",
  "what is still open": "The questions nobody else could answer, each one a thing that was deliberately not invented. Until these are settled the draft is not finished.",
};

/** The kind each of the agent's own files is delivered as: the kinds the test
 *  writer, the code writer and the package maker take them by. A SKILL.md is
 *  Markdown. The container spec is the spec.json a container deploy is filed
 *  with. */
export const KIND_OF = {
  "agent-descriptor.json": "application/vnd.agentmesh.agent-descriptor+json",
  "agent-runtime-requirements.json": "application/vnd.agentmesh.agent-runtime-requirements+json",
  "plugin.json": "application/vnd.agentmesh.agent-plugin+json",
  spec: "application/vnd.agentmesh.agent-spec+json",
};

/** What is still open, as Markdown a person reads: a heading, then one bullet
 *  per question with its key. */
export const openQuestionsMarkdown = (questions) =>
  ["# What is still open", "", ...questions.map((q) => `- \`${q.key}\`: ${q.question}`)].join("\n") + "\n";

/** The name a file goes under as a piece. The three authored files keep
 *  theirs; a SKILL.md is named for its skill, because a piece is delivered
 *  under its name, and several called SKILL.md would be one name for
 *  different files wherever they land next. */
export const pieceNameOf = (rel) => {
  const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
  return m ? `${m[1]}.SKILL.md` : rel;
};

/** What to list and what to copy. Pure, so it can be checked without a folder;
 *  the caller does the copying. `files` is builds.json's list ({path,
 *  sha256}) and `filesDir` the folder it was written under. `container` is
 *  the container agent's checked spec, by its path, or true with the path as
 *  `specPath`. */
export function plan({ files = [], filesDir = "", blanks = [], container = null, specPath = null } = {}) {
  const entries = [];
  const copies = [];
  if (container === true && specPath) container = specPath;
  // A container agent's draft makes no package and has no files: what a
  // container deploy is filed with is the checked spec, until container
  // agents carry the two files (the plan's milestone 2). It is the one
  // spec.json this agent still delivers, as the output "the container spec".
  if (container) {
    entries.push({
      name: "the container spec", step: STEP_OF["the container spec"], path: "out/spec.json", media_type: KIND_OF.spec,
      about: ABOUT["the container spec"], produced_from: ["what it should do"],
    });
    copies.push({ from: container, to: "out/spec.json", what: "the container agent's checked spec" });
  }
  for (const f of files) {
    const name = pieceNameOf(f.path);
    entries.push({
      name, step: STEP_OF.files, path: `out/agent/${f.path}`,
      media_type: KIND_OF[f.path] ?? "text/markdown",
      about: ABOUT[f.path] ?? ABOUT.skill, produced_from: ["what it should do"],
    });
    copies.push({ from: join(filesDir, f.path), to: `out/agent/${f.path}`, what: `the draft's ${f.path}`, sha256: f.sha256 });
  }
  const questions = questionsFor(blanks);
  // Only when there is something open. A file saying nothing is open is a
  // file somebody opens for nothing.
  if (questions.length) {
    entries.push({
      name: "what is still open", step: STEP_OF["what is still open"], path: "out/still-open.md",
      media_type: "text/markdown", about: ABOUT["what is still open"], produced_from: ["what it should do"],
    });
    copies.push({ to: "out/still-open.md", what: "the open questions", text: openQuestionsMarkdown(questions) });
  }
  return { entries, copies };
}

/** Whether the draft is still the one the drafting step wrote. Null when it
 *  is, or when the record names no digest (a draft written before the digest
 *  was recorded); otherwise the sentence the reply carries.
 *
 *  Why: a harness asked to revise a spec once opened draft.json with its own
 *  file tool, which cuts every line over 2000 characters, edited it, and the
 *  spec went out with its longest instructions cut (debt 43). The scripts
 *  are the only thing that writes a draft, and this is what makes that so. */
export function draftChanged(draftText, calls = null) {
  const want = typeof calls?.draft_sha256 === "string" ? calls.draft_sha256 : "";
  if (!want) return null;
  const got = createHash("sha256").update(draftText).digest("hex");
  if (got === want) return null;
  return "The draft was changed after the drafting step wrote it, so it is not delivered: only draft.mjs writes a draft. Run the four commands again with the same variables, and never open or edit draft.json by hand.";
}

/** Place the files and write the list. Nothing is written until every copy
 *  that names a source has one, so a refused delivery leaves no half-filled
 *  folder. */
export function fill(jobDir, { entries, copies }) {
  for (const c of copies) {
    if (c.from && !existsSync(c.from)) throw new Error(`${c.what} is not at ${c.from}`);
    // The same rule as the draft's: only builds.mjs writes these, and a
    // file changed after it did is not delivered.
    if (c.from && c.sha256 && sha256(readFileSync(c.from)) !== c.sha256) {
      throw new Error(`${c.what} was changed after the builder made it, so nothing is delivered: run the four commands again, and never edit the files by hand`);
    }
  }
  for (const c of copies) {
    const dest = join(jobDir, c.to);
    mkdirSync(dirname(dest), { recursive: true });
    if (c.from) copyBytes(c.from, dest);
    else writeFileSync(dest, c.text);
  }
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify(entries, null, 2) + "\n");
  return entries;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  const JOB_DIR = process.env.JOB_DIR || process.env.MESH_JOB_DIR;
  if (!JOB_DIR || !RECORDS) { console.error("JOB_DIR and RECORDS are required"); process.exit(2); }
  if (!existsSync(JOB_DIR) || !statSync(JOB_DIR).isDirectory()) { console.error(`the job folder does not exist: ${JOB_DIR}`); process.exit(2); }
  try {
    const draftPath = join(RECORDS, "draft.json");
    const blanksPath = join(RECORDS, "blanks.json");
    const blanks = existsSync(blanksPath) ? (JSON.parse(readFileSync(blanksPath, "utf8")).blanks ?? []) : [];
    const callsPath = join(RECORDS, "calls.json");
    const calls = existsSync(callsPath) ? JSON.parse(readFileSync(callsPath, "utf8")) : null;
    if (existsSync(draftPath)) {
      const changed = draftChanged(readFileSync(draftPath), calls);
      if (changed) { console.log(JSON.stringify({ ok: false, code: 1, reply: changed })); process.exit(1); }
    }
    const buildsPath = join(RECORDS, "builds.json");
    const builds = existsSync(buildsPath) ? JSON.parse(readFileSync(buildsPath, "utf8")) : null;
    const listed = fill(JOB_DIR, plan({ files: builds?.files?.list ?? [], filesDir: join(RECORDS, "agent"), blanks,
      container: builds?.container ? draftPath : null }));
    console.log(`${listed.length} piece${listed.length === 1 ? "" : "s"} listed at ${join(JOB_DIR, "pieces.json")}`);
  } catch (e) {
    // One JSON object whose reply says why, like the refusal above, so the
    // skill prints it as the whole answer.
    console.log(JSON.stringify({ ok: false, code: 1, reply: e.message }));
    console.error(e.message);
    process.exit(1);
  }
}
