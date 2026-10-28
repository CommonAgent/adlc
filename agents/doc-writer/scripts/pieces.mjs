// Fill a job folder from a checked documentation: every delivered piece under
// out/, and pieces.json, the list the adapter reads when the reply is sent,
// one entry per piece with the step that made it. The adapter signs the job
// manifest from that list; a reply with no pieces.json carries no job.
//
// What this job hands over is two things and they both go, or neither does:
// the documentation, and the trace the check wrote of it, which names the
// source and the place of every line. Documentation without its trace asks a
// reader to take every line on trust, which is what this agent exists to
// spare them.
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
  "documentation": "write-the-documentation",
  "trace": "check-every-line",
};

export const DOC_ABOUT = "Markdown: a header `agent, version, written_by, written_at`, then `## What it does`, `## Where to send it work`, `## How to use it` with a `### <job>` per job (`#### What to give it`, `#### What comes back`, `#### How it is done`, `#### Its steps`, `#### Examples`), `## What it will not do`, `## When it hands work back to a person`, `## What it reaches`, `## What it costs`, `## What it leaves behind`, `## Verdicts`, `## How it has run`, `## Versions`, `## Not documented` and `## Sources`. Every line that says something ends with `[S<n>: <place>]`, `[S<n>: <place> absent]` or `[given]`; a section with nothing in it is left out.";
export const TRACE_ABOUT = "`{trace, ok, findings, lines}`: `lines` has one entry per line that says something, `{line, source, place, template, verdict}`, and `findings` is empty when the documentation was delivered.";

/** What to list and what to copy. Pure. */
export function plan({ docPath = "", tracePath = "" } = {}) {
  if (!docPath) throw new Error("the documentation is missing: nothing names the file it was written to");
  if (!tracePath) throw new Error("the trace is missing: nothing names the file it was written to");
  return {
    copies: [
      { from: docPath, to: "out/documentation.md", what: "the documentation" },
      { from: tracePath, to: "out/trace.json", what: "the trace" },
    ],
    entries: [
      {
        name: "documentation", step: STEP_OF.documentation, path: "out/documentation.md",
        media_type: "text/markdown", produced_from: ["agent descriptor", "runtime requirements", "AgentDoc", "records", "verdicts"],
        about: DOC_ABOUT,
      },
      {
        name: "trace", step: STEP_OF.trace, path: "out/trace.json", working: true,
        media_type: "application/vnd.agentmesh.doc-trace+json", produced_from: ["documentation"],
        about: TRACE_ABOUT,
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
