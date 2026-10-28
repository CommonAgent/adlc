// Fill a job folder from a finished record: every delivered piece under out/,
// and pieces.json, the list the adapter reads when the reply is sent, one
// entry per piece with the step that made it and a sentence saying what it is.
// The adapter signs the job manifest from that list.
//
// Each piece goes under the name of the output it is, with the kind that
// output declares, so the package maker and the test writer's format check
// can hold the delivery to the declaration.
//
// The record is delivered only while it is byte for byte what the check wrote:
// a record edited after that step is not this agent's work.
//
//   needs: node >= 22
//   [JOB_DIR=<job folder>, else MESH_JOB_DIR] RECORDS=<records folder> node pieces.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** The outputs, as the descriptor declares them. */
export const PIECES = [
  { name: "the architecture record", file: "record.md", to: "out/architecture-record.md", step: "check-the-record", media_type: "text/markdown",
    about: "The architecture record: the systems the agent reaches, the product bound to each in each environment and who chose it, its dependencies, kind, limits, egress, formats, settings, and every decision with its reason. Markdown with a front matter header (record, statement, environments, kind, done, questions, systems, bindings) the next stage reads the bindings from." },
  { name: "what is still open", file: "still-open.md", to: "out/still-open.md", step: "check-the-record", media_type: "text/markdown",
    about: "The questions the record could not settle without the person, each under the key an answer goes back with. Until these are answered the record is not finished." },
  { name: "what changed", file: "what-changed.md", to: "out/what-changed.md", step: "check-the-record", media_type: "text/markdown",
    about: "In a revision: the lines of the record that are new or gone, and the reason for each decision that changed." },
];

/** What to list and copy, from what is in the records folder. Pure over the
 *  `exists` it is given. */
export function plan(records, exists = existsSync) {
  return PIECES.filter((p) => exists(join(records, p.file))).map((p) => ({
    entry: { name: p.name, step: p.step, path: p.to, media_type: p.media_type, about: p.about, produced_from: ["the statement of the job"] },
    from: join(records, p.file),
  }));
}

/** Whether the record is still the one the check wrote: null when it is. */
export function recordChanged(records) {
  const at = join(records, "checks.json");
  if (!existsSync(at)) return null;
  const want = JSON.parse(readFileSync(at, "utf8")).record_sha256;
  if (!want) return null;
  return sha256(readFileSync(join(records, "record.md"))) === want ? null
    : "The record was changed after the check wrote it, so it is not delivered: only check-record.mjs writes a record. Run the commands again with the same variables, and never edit record.md by hand.";
}

export function fill(jobDir, records) {
  const items = plan(records);
  for (const it of items) {
    const dest = join(jobDir, it.entry.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(it.from));
  }
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify(items.map((i) => i.entry), null, 2) + "\n");
  return items.map((i) => i.entry);
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  const JOB_DIR = process.env.JOB_DIR || process.env.MESH_JOB_DIR;
  if (!JOB_DIR || !RECORDS) { console.error("JOB_DIR and RECORDS are required"); process.exit(2); }
  if (!existsSync(JOB_DIR) || !statSync(JOB_DIR).isDirectory()) { console.error(`the job folder does not exist: ${JOB_DIR}`); process.exit(2); }
  try {
    const changed = recordChanged(RECORDS);
    if (changed) { console.log(JSON.stringify({ ok: false, code: 1, reply: changed })); process.exit(1); }
    const listed = fill(JOB_DIR, RECORDS);
    console.log(`${listed.length} piece${listed.length === 1 ? "" : "s"} listed at ${join(JOB_DIR, "pieces.json")}`);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, code: 1, reply: e.message }));
    console.error(e.message);
    process.exit(1);
  }
}
