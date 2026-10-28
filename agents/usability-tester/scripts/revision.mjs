// A change to a usability report already delivered (Common Agent 5.7). When
// the person asks for a change, the adapter puts the job's earlier pieces in
// <job>/prior/, named in prior/manifest.json, and the message is the change
// in their words.
//
// The earlier report says which agent was tested. A change that only adds a
// person's judgment (`understood:`, `could use:`, `did the job:`, `note:`)
// keeps every run as it was and writes the judgment in: nothing is run
// again. Any other change tests the agent again, as the earlier report's
// request with the change's labelled lines laid over it (`offering:`,
// `change:`), and words it cannot act on are said back in the reply. When
// the earlier report did not come with the change, nothing can be changed,
// and the job says so before anything runs.
//
//   needs: node >= 22
//   import { readPrior, judgmentOnly } from "./revision.mjs"
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readHeader } from "./report.mjs";
import { labelled } from "./read-request.mjs";

const trim = (s) => String(s ?? "").trim();
const JUDGMENT = ["understood", "could use", "did the job", "note"];

/** The earlier report, or null when this job is not a change. */
export function readPrior(job) {
  if (!job) return null;
  const dir = join(job, "prior");
  if (!existsSync(join(dir, "manifest.json"))) return null;
  for (const name of readdirSync(dir)) {
    if (name === "manifest.json") continue;
    let text = "";
    try { text = readFileSync(join(dir, name), "utf8"); } catch { continue; }
    const header = readHeader(text);
    if (header?.agent) return { text, header };
  }
  return { missing: "the earlier usability report did not come with this change, so there is nothing to change; ask for a new test, naming the agent" };
}

/** Whether a change only adds a person's judgment. */
export function judgmentOnly(text) {
  const l = labelled(text);
  return l.length > 0 && l.every((k) => JUDGMENT.includes(k));
}

/** The change's own words: the message without its labelled lines. */
export function changeWords(text) {
  return String(text ?? "").replace(/^\s*(?:[-*]\s*)?(agent|offering|change|understood|could use|could_use|did the job|did_the_job|note)\s*:.*$/gim, "").replace(/\s+/g, " ").trim();
}

/** The earlier report with the person's judgment written in, and its header's mark. */
export function withJudgment(text, judgment) {
  const yn = (v) => (v === true ? "yes" : v === false ? "no" : "not said");
  const section = [
    "## A person's judgment", "",
    `- Understood what it does: ${yn(judgment.understood)}`,
    `- Could use the result: ${yn(judgment.could_use)}`,
    `- It did the job: ${yn(judgment.did_the_job)}`,
    ...(trim(judgment.note) ? [`- Note: ${trim(judgment.note).replace(/\n+/g, " ")}`] : []),
    "",
  ].join("\n");
  const out = String(text).replace(/## A person's judgment\n[\s\S]*?(?=\n## |\s*$)/, section.trimEnd() + "\n");
  return out
    .replace(/^- A person's judgment: whether they understood it.*\r?\n/m, "")
    .replace(/^person_judgment: .*$/m, "person_judgment: added");
}
