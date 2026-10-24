// Fill a job folder from a finished draft: every delivered piece under out/,
// and pieces.json, the list the adapter reads when the reply is sent, one
// entry per piece with the step that made it and a sentence saying what it is.
// The adapter signs the job manifest from that list; a reply with no
// pieces.json carries no job.
//
// Two pieces, and the second one is the point. The spec is what they asked
// for. What is still open is what they have to do about it, and it goes as a
// file of its own rather than only as prose in the reply, because a reply is
// read once and a file is still there next week when somebody comes back to
// finish the thing.
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

export const STEP_OF = {
  "spec": "draft-the-spec",
  "what is still open": "ask-what-is-missing",
};

const ABOUT = {
  "spec": "The spec.json itself, which is a declaration and not a package: it says what the agent offers, what each job takes and produces, how each job is done, what it refuses, and what it records. The scripts it names do not exist yet.",
  "what is still open": "The questions nobody else could answer, each one a thing that was deliberately not invented. Until these are settled the spec will not build.",
};

/** What to list and what to copy. Pure, so it can be checked without a folder;
 *  the caller does the copying. */
export function plan({ draftPath = "", blanks = [] } = {}) {
  if (!draftPath) throw new Error("there is no draft to deliver: nothing names draft.json");
  const entries = [{
    // Named by its file name, because the name is what the file is called
    // wherever it lands next: the adapter delivers a piece under its name,
    // and a runner forwards it under that name again. Called "spec" it
    // reached the code-writer with no extension (2026-09-15).
    name: "spec.json", step: STEP_OF.spec, path: "out/spec.json",
    media_type: "application/json", about: ABOUT.spec, produced_from: ["what it should do"],
  }];
  const copies = [{ from: draftPath, to: "out/spec.json", what: "the draft spec" }];
  const questions = questionsFor(blanks);
  // Only when there is something open. A file saying nothing is open is a
  // file somebody opens for nothing.
  if (questions.length) {
    entries.push({
      name: "still-open.txt", step: STEP_OF["what is still open"], path: "out/still-open.txt",
      media_type: "text/plain", about: ABOUT["what is still open"], produced_from: ["spec"],
    });
    copies.push({
      to: "out/still-open.txt", what: "the open questions",
      text: questions.map((q) => `${q.key}: ${q.question}`).join("\n") + "\n",
    });
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
    const listed = fill(JOB_DIR, plan({ draftPath, blanks }));
    console.log(`${listed.length} piece${listed.length === 1 ? "" : "s"} listed at ${join(JOB_DIR, "pieces.json")}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
