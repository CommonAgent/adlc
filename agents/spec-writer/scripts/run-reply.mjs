// run.reply: how the host reads a job's reply from the command it runs, and
// the rule the package maker holds it to. A drafted value outside the rule is
// the model's to get wrong and not the person's to decide, so it is corrected
// and said; and where the builder is not on the host to refuse it, this says
// what it would (technical debt 652: a draft's "text:counts" stopped a build
// at Package, and nothing goes back from Package to the spec).
//
//   needs: node >= 22
//   import { RUN_REPLY_STDOUT, RUN_REPLY_MEMBER, runReplyOk, runReplyProblems, fitRunReply } from "./run-reply.mjs"

/** The two forms the package maker takes for run.reply: the command's whole
 *  output, or json:<member>, one member of the JSON object it prints. Named
 *  once in build.py (RUN_REPLY_STDOUT, RUN_REPLY_MEMBER); test/run-reply.test.mjs
 *  reads them there and holds these to them (technical debt 652). */
export const RUN_REPLY_STDOUT = "stdout";
export const RUN_REPLY_MEMBER = "json:";

/** The rule, as build.py's run_reply_ok has it. */
export const runReplyOk = (v) => v === RUN_REPLY_STDOUT || (typeof v === "string" && v.startsWith(RUN_REPLY_MEMBER) && v.length > RUN_REPLY_MEMBER.length);

/** A value as Python's repr writes it, which is how the package maker quotes it. */
const pyRepr = (v) => {
  if (typeof v === "string") return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return typeof v === "number" ? String(v) : JSON.stringify(v);
};

const jobsOf = (spec) => (Array.isArray(spec?.jobs) ? spec.jobs : []);
const hasReply = (j) => !!j && typeof j.run === "object" && j.run !== null && !Array.isArray(j.run) && "reply" in j.run;

/** Why each job's run.reply would be refused at Package, in the package
 *  maker's own words and saying where it is set. Empty when every job's is
 *  absent or one the package maker takes. */
export function runReplyProblems(spec) {
  const out = [];
  for (const j of jobsOf(spec)) {
    if (!hasReply(j) || runReplyOk(j.run.reply)) continue;
    out.push(`job ${String(j.slug ?? "?").trim() || "?"}: run.reply is '${RUN_REPLY_STDOUT}' or '${RUN_REPLY_MEMBER}<member>'; bad: ${pyRepr(j.run.reply)}. `
      + "It is set in agent-runtime-requirements.json; the package maker refuses the package until it is one of those");
  }
  return out;
}

/** A member name a wrong form still carries, as in "text:counts". */
const MEMBER = /^[A-Za-z][A-Za-z0-9_-]*:([A-Za-z_][A-Za-z0-9_.-]*)$/;

/** The draft with every run.reply one the package maker takes, and what was
 *  changed in a sentence for the person ("" when nothing was). A reply that
 *  names a member after the wrong word replies with that member; anything
 *  else outside the rule replies with what the command prints. How the host
 *  reads a reply is a host fact, not one of the person's questions, so it is
 *  set here rather than asked for, and said. */
export function fitRunReply(spec) {
  if (!runReplyProblems(spec).length) return { spec, note: "" };
  const notes = [];
  const jobs = jobsOf(spec).map((j) => {
    if (!hasReply(j) || runReplyOk(j.run.reply)) return j;
    const was = j.run.reply;
    const m = typeof was === "string" ? MEMBER.exec(was.trim()) : null;
    const fitted = m ? `${RUN_REPLY_MEMBER}${m[1]}` : RUN_REPLY_STDOUT;
    const means = m ? `the reply is the member ${m[1]} of the JSON object the command prints` : "the reply is what the command prints";
    notes.push(`Job ${String(j.slug ?? "?").trim() || "?"}: the draft's run.reply ${JSON.stringify(was)} is not one the package maker takes ('${RUN_REPLY_STDOUT}' or '${RUN_REPLY_MEMBER}<member>'), so it is written as ${JSON.stringify(fitted)}: ${means}.`);
    return { ...j, run: { ...j.run, reply: fitted } };
  });
  return { spec: { ...spec, jobs }, note: notes.join(" ") };
}
