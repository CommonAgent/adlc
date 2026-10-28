// Fill a job folder from a finished watch: every delivered piece under out/,
// and pieces.json, the list the adapter reads when the reply is sent, one
// entry per piece with the step that made it. The adapter signs the job
// manifest from that list; a reply with no pieces.json carries no job.
//
// A watch hands over the report a person reads, the watch record it was
// written from, and one alarm file for each open alert, in the shape the
// incident recorder reads (alarms.mjs).
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
  "watch report": "write-the-report",
  "watch record": "write-the-report",
  "alarms": "raise-the-alarms",
};

export const REPORT_ABOUT = "Markdown: a header of `name: value` lines (`watched_by`, `watched_at`, `account`, `agents`, `alive`, `answering`, `inside_limits`, `open_alerts`, `spend_window`, `spend_total`, `every_spend_traced`, `reconciles`), then `## Agents` with a table and a `### <agent>` per agent saying whether it is alive, answering and inside its limits, each with where that was read, `## Open alerts` with each alert's reason and where its alarm went, `## Spend` (`### In total`, `### By owner`, `### By agent`, `### By job`, `### Untraced`, `### Against what was allowed`, `### Reconciliation`), `## Not known` and `## Sources`.";
export const RECORD_ABOUT = "`{watch, watched_at, watched_by, account, agents, spend, alerts, not_known, sources}`: each agent as `{named, handle, key, alive, answering, limits, alert, observations}`, and the spend report it read, as spend-report-v1, with the watcher's own check of its arithmetic.";
export const ALARM_ABOUT = "One JSON object per line, `{time, agent, event, source, seen_by}`, for one agent with an open alert, named `watch-platform-<agent>.jsonl` so the incident recorder reads it as the platform's activity record; the alarm's message, `agent: <handle>` and `time: <ISO time>`, is in the watch record's `alerts`.";

/** What to list and what to copy. Pure. */
export function plan({ reportPath = "", recordPath = "", alarms = [] } = {}) {
  if (!reportPath) throw new Error("the watch report is missing: nothing names the file it was written to");
  if (!recordPath) throw new Error("the watch record is missing: nothing names the file it was written to");
  const copies = [
    { from: reportPath, to: "out/watch-report.md", what: "the watch report" },
    { from: recordPath, to: "out/watch-record.json", what: "the watch record" },
  ];
  const entries = [
    {
      name: "watch report", step: STEP_OF["watch report"], path: "out/watch-report.md",
      media_type: "text/markdown", produced_from: ["the agents to watch", "the platform's records"], about: REPORT_ABOUT,
    },
    {
      name: "watch record", step: STEP_OF["watch record"], path: "out/watch-record.json", working: true,
      media_type: "application/vnd.agentmesh.watch-record+json", produced_from: ["the agents to watch", "the platform's records"], about: RECORD_ABOUT,
    },
  ];
  for (const a of alarms) {
    copies.push({ from: a.path, to: `out/${a.file}`, what: `the alarm for ${a.agent}` });
    entries.push({
      name: `alarms (${a.file})`, step: STEP_OF.alarms, path: `out/${a.file}`,
      media_type: "application/x-ndjson", produced_from: ["watch record"], about: ALARM_ABOUT,
    });
  }
  return { copies, entries };
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
