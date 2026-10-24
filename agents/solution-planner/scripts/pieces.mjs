// Fill a job folder with the plan: out/plan.json, and pieces.json, the list the
// adapter reads when the reply is sent, one entry per piece with the step that
// made it. The adapter signs the job manifest from that list; a reply with no
// pieces.json carries no job. A job that has no plan lists nothing and writes
// nothing, so pieces.json only ever exists next to a plan.
//
// Pure where it can be: plan() says what to list, fill() does the writing, and
// nothing is written until the plan text has been checked.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const STEP_OF = {
  "plan": "write-the-plan",
};

/** One plain sentence saying what a piece is, for a reader who has only the file. */
export function aboutOf(kind, plan = {}) {
  if (kind === "plan") {
    const n = Array.isArray(plan?.steps) ? plan.steps.length : 0;
    return plan?.refused
      ? "A build-plan-v1 file for a request the planner would not plan; it holds the one sentence saying why and offers no steps."
      : `A build-plan-v1 file with ${n} step${n === 1 ? "" : "s"}, each saying what kind of work it is, what it takes and what it hands back. It names no agent: the catalog answers each step at Source.`;
  }
  return "";
}

/** What to list and what to write. */
export function plan({ plan: doc } = {}) {
  if (!doc || typeof doc !== "object" || doc.format !== "build-plan-v1") {
    throw new Error("there is no build-plan-v1 plan to file");
  }
  const entries = [{
    name: "plan", step: STEP_OF.plan, path: "out/plan.json",
    media_type: "application/json", produced_from: ["the request"],
    about: aboutOf("plan", doc),
    text: `${JSON.stringify(doc, null, 2)}\n`,
  }];
  return { entries, copies: [] };
}

/** Write the pieces and the list. */
export function fill(jobDir, { entries }) {
  const listed = entries.map((e) => {
    const { text, ...rest } = e;
    if (text !== undefined) {
      const dest = join(jobDir, rest.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text);
    }
    return rest;
  });
  writeFileSync(join(jobDir, "pieces.json"), `${JSON.stringify(listed, null, 2)}\n`);
  return listed;
}
