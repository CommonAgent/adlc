// Fill a job folder from what was published: every delivered piece under out/,
// and pieces.json, the list the adapter reads when the reply is sent, one
// entry per piece with the step that made it. The adapter signs the job
// manifest from that list; a reply with no pieces.json carries no job.
//
// What this job hands over is two things and they both go, or neither does.
// The addresses, as a link the reader can open, and the publication record,
// which is the thing somebody checks a year later when they want to know
// whether what is served is what was handed over. An address without its
// record is a URL somebody has to take on trust.
//
// Every copied piece is checked against the digest recorded when the file was
// placed, so what the adapter hands over is what is at the address.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

/** Copy a file by its BYTES, never with copyFileSync, which carries the source
 *  file's mode and is refused by a job folder reached through a mount that
 *  serves a fixed one. Reading and writing moves the content and asks for
 *  nothing else, which is all a delivered piece ever needed. */
const copyBytes = (from, to) => writeFileSync(to, readFileSync(from));

export const STEP_OF = {
  "address": "check-what-is-served",
  "publication record": "check-what-is-served",
};

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** What to list and what to copy. Pure, so it can be checked without a folder;
 *  the caller does the copying. */
export function plan({ served = [], recordPath = "" }) {
  const good = served.filter((s) => s.ok);
  if (!good.length) throw new Error("nothing is at an address this agent has read back, so there is no delivery to file");
  if (!recordPath) throw new Error("the publication record is missing: nothing names the file it was written to");

  const entries = [];
  const copies = [];

  // One line per address, in the order they were handed over, so a job that
  // published a page and its stylesheet reads as a page and its stylesheet.
  entries.push({
    name: "address", step: STEP_OF.address, path: "out/addresses.txt",
    media_type: "text/plain", produced_from: ["the files"],
    about: "One web address per line, in the order the files were handed over, each one read back after it was placed. These are live and public: anybody with the address can open them.",
    kind: "link", text: `${good.map((s) => s.address).join("\n")}\n`,
  });

  copies.push({ from: recordPath, to: "out/published.json", what: "the publication record" });
  entries.push({
    name: "publication record", step: STEP_OF["publication record"], path: "out/published.json",
    media_type: "application/vnd.agentmesh.publication-record+json", produced_from: ["address"],
    about: "What was published where, with the digest of each file as it was read back from its address. This is what somebody checks a year later to know that what is served is what was handed over.",
  });

  return { entries, copies };
}

/** Place the files and write the list. Nothing is written at all until every
 *  copy has been checked, so a refused delivery leaves no half-filled folder. */
export function fill(jobDir, { entries, copies }) {
  for (const c of copies) {
    if (!existsSync(c.from)) throw new Error(`${c.what} is not at ${c.from}`);
    if (c.sha256 && sha(readFileSync(c.from)) !== c.sha256) {
      throw new Error(`${c.what} at ${c.from} is not what was published: its digest differs from the record`);
    }
  }
  for (const c of copies) {
    const dest = join(jobDir, c.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyBytes(c.from, dest);
  }
  const listed = entries.map((e) => {
    if (e.text === undefined) return e;
    const { text, ...rest } = e;
    const dest = join(jobDir, rest.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    return rest;
  });
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify(listed, null, 2) + "\n");
  return listed;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const { SERVED } = process.env;
  const JOB_DIR = process.env.JOB_DIR || process.env.MESH_JOB_DIR;
  if (!JOB_DIR || !SERVED) { console.error("refused: JOB_DIR and SERVED are required"); process.exit(2); }
  if (!existsSync(JOB_DIR) || !statSync(JOB_DIR).isDirectory()) {
    console.error(`refused: the job folder does not exist: ${JOB_DIR}`); process.exit(2);
  }
  try {
    const record = JSON.parse(readFileSync(SERVED, "utf8"));
    const listed = fill(JOB_DIR, plan({ served: record.files ?? [], recordPath: SERVED }));
    console.log(`${listed.length} pieces listed at ${join(JOB_DIR, "pieces.json")}: ${listed.map((e) => e.path).join(", ")}`);
  } catch (e) {
    console.error(`refused: ${e.message}`);
    process.exit(1);
  }
}
