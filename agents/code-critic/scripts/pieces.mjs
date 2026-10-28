// File the findings: the document under out/, and pieces.json, the list the
// adapter reads when the reply is sent, with the step that made the piece
// and a sentence saying what it is. The adapter signs the job manifest from
// that list; a reply with no pieces.json carries no job.
//
// One piece, always the same name and kind, because the next reader (a
// person, or the agent that answers the findings) goes by both.
//
//   needs: node >= 22
//   [JOB_DIR=<job folder>, else MESH_JOB_DIR] RECORDS=<this job's records folder> node pieces.mjs
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PIECE = {
  name: "the findings",
  step: "write-the-findings",
  path: "out/findings.md",
  media_type: "text/markdown",
};

/** The entry for a document, with a sentence a reader who has only the file can use. */
export function entryFor(doc) {
  const field = (k) => (new RegExp(`^-\\s*${k}:\\s*(.*)$`, "mi").exec(String(doc ?? "")) ?? [])[1] ?? "?";
  return {
    ...PIECE,
    about: `The review of ${field("package")}: ${field("findings")} findings, ${field("open")} open, each with its place, rule, claim, consequence and an Answer line to write a reason on. Send it back with the package to have the answers checked.`,
    produced_from: ["the programs"],
  };
}

/** Place the document and write the list. */
export function fill(jobDir, doc) {
  if (!String(doc ?? "").trim()) throw new Error("there is no findings document to deliver");
  const at = join(jobDir, PIECE.path);
  mkdirSync(join(jobDir, "out"), { recursive: true });
  writeFileSync(at, doc);
  const entries = [entryFor(doc)];
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
    const listed = fill(JOB_DIR, readFileSync(join(RECORDS, "findings.md"), "utf8"));
    console.log(`${listed.length} piece listed at ${join(JOB_DIR, "pieces.json")}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
