// Fill a job folder from a finished review: the review under out/, and
// pieces.json, the list the adapter reads when the reply is sent, one entry
// per piece with the step that made it. The adapter signs the job manifest
// from that list; a reply with no pieces.json carries no job.
//
// What this job hands over is one thing: the review, which is the statement
// or the refusal. It goes whole or not at all.
//
//   needs: node >= 22
//   import { plan, fill } from "./pieces.mjs"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Copy a file by its BYTES, never with copyFileSync, which carries the source
 *  file's mode and is refused by a job folder reached through a mount that
 *  serves a fixed one. */
const copyBytes = (from, to) => writeFileSync(to, readFileSync(from));

export const STEP_OF = { "security review": "write-the-review" };

export const ABOUT = "Markdown: a header (YAML front matter) `review, package, version, digest, verdict, reviewed_at, architecture_record, spending_limit, reaches, spends, never_does, no_reason_recorded, refused_for`, then `## Verdict`, `## Reaches`, `## Spends`, `## Never does`, `## No reason recorded`, `## Programs`, `## Parts`, `## Accepted knowingly`, `## Reasons weighed` and `## Not reviewed`.";

/** What to list and what to copy. Pure, so it can be checked without a folder. */
export function plan({ reviewPath = "" } = {}) {
  if (!reviewPath) throw new Error("the review is missing: nothing names the file it was written to");
  return {
    copies: [{ from: reviewPath, to: "out/security-review.md", what: "the security review" }],
    entries: [{
      name: "security review", step: STEP_OF["security review"], path: "out/security-review.md",
      media_type: "text/markdown", produced_from: ["the package", "the architecture record", "the owner's spending limit"],
      about: ABOUT,
    }],
  };
}

/** Place the files and write the list. Nothing is written until every source
 *  is found, so a refused delivery leaves no half-filled folder. */
export function fill(jobDir, { entries, copies }) {
  for (const c of copies) if (!existsSync(c.from)) throw new Error(`${c.what} is not at ${c.from}`);
  for (const c of copies) {
    const dest = join(jobDir, c.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyBytes(c.from, dest);
  }
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify(entries, null, 2) + "\n");
  return entries;
}
