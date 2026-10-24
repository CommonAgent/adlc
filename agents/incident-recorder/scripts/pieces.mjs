// Fill a job folder from a recorded incident: every delivered piece under
// out/, and pieces.json, the list the adapter reads when the reply is sent,
// one entry per piece with the step that made it. The adapter signs the job
// manifest from that list; a reply with no pieces.json carries no job.
//
// What this job hands over is two things and they both go, or neither does:
// the incident record, and the timeline it was written from. A record without
// its timeline is a list of facts nobody can place in order, and a timeline
// without its record does not say what the gaps mean.
//
//   needs: node >= 22
//   import { plan, fill } from "./pieces.mjs"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Copy a file by its BYTES, never with copyFileSync, which carries the source
 *  file's mode and is refused by a job folder reached through a mount that
 *  serves a fixed one. */
const copyBytes = (from, to) => writeFileSync(to, readFileSync(from));

export const STEP_OF = {
  "incident record": "write-incident-record",
  "timeline": "write-incident-record",
};

/** What to list and what to copy. Pure, so it can be checked without a
 *  folder; the caller does the copying. */
export function plan({ incidentPath = "", timelinePath = "" } = {}) {
  if (!incidentPath) throw new Error("the incident record is missing: nothing names the file it was written to");
  if (!timelinePath) throw new Error("the timeline is missing: nothing names the file it was written to");
  return {
    copies: [
      { from: incidentPath, to: "out/incident.json", what: "the incident record" },
      { from: timelinePath, to: "out/timeline.json", what: "the timeline" },
    ],
    entries: [
      {
        name: "incident record", step: STEP_OF["incident record"], path: "out/incident.json",
        media_type: "application/json", produced_from: ["agent handle", "failure time", "records"],
        about: "The incident record: each fact the records state, with the file it came from, that file's digest and the byte offset of the line, and every gap where the records say nothing. It names no cause and no fix.",
      },
      {
        name: "timeline", step: STEP_OF.timeline, path: "out/timeline.json",
        media_type: "application/json", produced_from: ["records"],
        about: "The timeline the record was written from: the events in time order and the intervals where no record was found, each marked unknown rather than filled in.",
      },
    ],
  };
}

/** Place the files and write the list. Nothing is written until every source
 *  is found, so a refused delivery leaves no half-filled folder. */
export function fill(jobDir, { entries, copies }) {
  for (const c of copies) {
    if (!existsSync(c.from)) throw new Error(`${c.what} is not at ${c.from}`);
  }
  for (const c of copies) {
    const dest = join(jobDir, c.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyBytes(c.from, dest);
  }
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify(entries, null, 2) + "\n");
  return entries;
}
