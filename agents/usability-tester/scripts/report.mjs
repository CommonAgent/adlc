// The usability report: a YAML header an auditor reads, then what a person
// would meet, offering by offering, the descriptor checks, every finding
// labelled descriptor or agent with the stage that fixes it, a person's
// judgment where one was added, and what was not checked and why.
//
// The verdict:
//   not_usable            an offering a person starts could not be run from
//                         an example, its form could not be filled, its run
//                         delivered nothing, or nothing it delivered can be
//                         read by a person
//   usable_with_findings  every offering ran, delivered and can be read, and
//                         there is at least one finding
//   usable                every offering ran, delivered, can be read and took
//                         a change, with no finding
//
//   needs: node >= 22
//   import { trialFindings, verdictOf, writeReport, readHeader, ABOUT } from "./report.mjs"

const trim = (s) => String(s ?? "").trim();
export const ABOUT = "The usability report: a YAML header (usability_report, agent, version, package_digest, descriptor_digest, verdict, tested_at, tested_by, the counts of offerings and findings, person_judgment), then for each offering a person starts whether its form could be filled from the Descriptor, whether a real run delivered in its declared form, whether the result can be read and whether a change came back as a new version; the descriptor checks; each finding labelled descriptor or agent with the stage that fixes it; a person's judgment where one was added; and what was not checked. The verdict is usable, usable_with_findings or not_usable.";

const A = (check, place, what, consequence) => ({ label: "agent", fixed_by: "code", check, place, what, consequence });
const D = (check, place, what, consequence) => ({ label: "descriptor", fixed_by: "design", check, place, what, consequence });

/** The four answers for one offering, and its findings. */
export function trialFindings(t) {
  const f = [];
  const place = `offering ${t.id}`;
  const ans = { form: "not run", delivers: "not run", readable: "not run", change: "not run" };
  if (!t.example) return { answers: ans, findings: f };
  if (!t.form?.ok) {
    ans.form = "no";
    for (const p of t.form?.problems ?? []) f.push(D("form", place, p, "a person filling the form from the Descriptor cannot make a request that runs"));
    return { answers: ans, findings: f };
  }
  ans.form = "yes";
  const r = t.run;
  if (!r) return { answers: ans, findings: f };
  if (r.state === "not started") f.push(A("delivers", place, `Run started nothing: ${r.error}`, "a person presses Run and no job begins"));
  else if (r.state === "refused") f.push(A("delivers", place, `it refused the example: "${trim(r.refusal).slice(0, 300)}"`, "a person who gives what the Descriptor asks for is turned away"));
  else if (r.state === "answered" && !r.delivers) f.push(A("delivers", place, `it answered in words and delivered nothing: "${trim(r.words).slice(0, 200)}"`, "a person waiting for the result gets a message instead"));
  else if (/^still /.test(trim(r.state))) f.push(A("delivers", place, `no result came back within ${Math.max(1, Math.round(r.waited_seconds / 60))} minutes (the job is ${r.state.replace(/^still /, "").replace(/ when the wait ran out$/, "")})`, "a person waits and gets nothing"));
  else if (!r.delivers) f.push(A("delivers", place, r.pieces.length ? "what came back holds none of the outputs the offering declares" : "the job came back with no pieces", "a person gets no result"));
  ans.delivers = r.delivers ? "yes" : "no";
  for (const m of r.missing ?? []) if (r.delivers) f.push(A("delivers", `${place}, output "${m}"`, "the output is declared and was not delivered", "a person expecting it from the page does not get it"));
  for (const q of r.pieces ?? []) {
    const own = q.problems.filter((x) => !/with no presentation|not one a page knows/.test(x));
    if (!q.matches) f.push(A("delivers", `${place}, piece "${q.name}"`, own.join("; "), "a page that trusts the declared kind shows it wrongly, and the next agent cannot read it"));
    else if (q.for_a_person && !q.readable && own.length) f.push(A("readable", `${place}, piece "${q.name}"`, own.join("; "), "a person cannot read it as it comes"));
  }
  if (r.delivers) {
    ans.readable = r.readable ? "yes" : "no";
    if (!r.readable) {
      const data = r.pieces.filter((q) => !q.for_a_person);
      if (data.length && data.length === r.pieces.length) f.push(D("readable", place, `everything it delivered is structured data with no presentation (${data.map((q) => `${q.name}: ${q.kind}`).join(", ")})`, "a person is handed data to read as it is; the output needs a presentation, or a Markdown piece beside it"));
      else f.push(A("readable", place, "nothing it delivered can be read by a person as it comes", "a person cannot use the result"));
    }
  }
  const c = t.change;
  if (!r.delivers) return { answers: ans, findings: f };
  if (!c || c.not) { ans.change = c?.not ? "not tried" : "not run"; if (c?.declared === false) { ans.change = "not offered"; f.push(D("change", place, "the offering does not say a change can be asked for (revisions)", "a page offers no way to ask for a change, and a person starts again for every correction")); } return { answers: ans, findings: f }; }
  if (c.price) { ans.change = "not tried"; return { answers: ans, findings: f }; }
  if (c.refused) { ans.change = "no"; f.push(A("change", place, `it did not take the change "${c.asked}": "${trim(c.refused).slice(0, 300)}"`, "a person who asks for a change gets nothing new")); return { answers: ans, findings: f }; }
  if (c.error || !c.version) { ans.change = "no"; f.push(A("change", place, c.error || "no new version came back", "a person who asks for a change gets nothing new")); return { answers: ans, findings: f }; }
  ans.change = c.delivers ? "yes" : "no";
  if (!c.delivers) f.push(A("change", place, `version ${c.version} came back without the deliverable`, "a person who asks for a change loses the result"));
  return { answers: ans, findings: f };
}

/** The verdict from the offerings' answers and the findings. */
export function verdictOf(trials, findings) {
  const bad = trials.some((t) => t.answers.form !== "yes" || t.answers.delivers !== "yes" || t.answers.readable !== "yes");
  if (bad) return "not_usable";
  return findings.length ? "usable_with_findings" : "usable";
}

const yamlValue = (v) => (v === null || v === undefined || v === "" ? "null" : /[:#\n"']|^\s|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v));

/** The report's header, read back: the members an auditor reads. */
export function readHeader(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(String(text));
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (!k) continue;
    let v = k[2].trim();
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { /* as written */ } }
    out[k[1]] = v === "null" ? null : v;
  }
  return out.usability_report ? out : null;
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
const VERDICT_WORDS = {
  usable: "A person can run every offering they start from its example, get a result in its declared form, read it and get a change back.",
  usable_with_findings: "A person can run every offering they start from its example, get a result and read it; the findings below say what still gets in their way.",
  not_usable: "A person cannot get through at least one offering they start: the offering below that says no shows where they are stopped.",
};

/**
 * The report. `t` holds: handle, name, key, version, package_digest,
 * descriptor_digest, tested_at, tested_by, checks {checks, findings},
 * trials [{id, name, example, example_from, form, run, change, answers}],
 * judgment {understood, could_use, did_the_job, note} or null, not_checked [].
 */
export function writeReport(t) {
  const descriptorFindings = t.checks.findings;
  const trialF = t.trials.flatMap((x) => x.findings ?? []);
  const findings = [...descriptorFindings, ...trialF];
  const verdict = t.trials.length ? verdictOf(t.trials, findings) : findings.length ? "usable_with_findings" : "usable";
  const header = {
    usability_report: "v1",
    agent: t.handle, version: t.version, package_digest: t.package_digest, descriptor_digest: t.descriptor_digest,
    verdict, tested_at: t.tested_at, tested_by: t.tested_by,
    offerings_a_person_starts: t.trials.length,
    offerings_run: t.trials.filter((x) => x.run).length,
    findings: findings.length,
    descriptor_findings: findings.filter((x) => x.label === "descriptor").length,
    agent_findings: findings.filter((x) => x.label === "agent").length,
    person_judgment: t.judgment ? "added" : "none",
  };
  const L = ["---", ...Object.entries(header).map(([k, v]) => `${k}: ${yamlValue(v)}`), "---", ""];
  L.push(`# Usability report: ${t.name || t.handle}`, "");
  L.push(`${t.name || t.handle} (${t.handle}, version ${t.version ?? "not stated"}) is **${verdict.replace(/_/g, " ")}**. ${t.trials.length ? VERDICT_WORDS[verdict] : "No offering is started by a person, so there was nothing to run as one."}`, "");
  L.push("## Offerings a person starts", "");
  if (!t.trials.length) L.push("None. Every offering says it is started by another agent (started_by).", "");
  else {
    L.push("| Offering | Example | Form | Delivers | Readable | Change |", "|---|---|---|---|---|---|");
    for (const x of t.trials) L.push(`| ${cell(x.name || x.id)} | ${cell(x.example_from ?? "none")} | ${x.answers.form} | ${x.answers.delivers} | ${x.answers.readable} | ${x.answers.change} |`);
    L.push("");
    for (const x of t.trials) {
      L.push(`### ${x.name || x.id} (\`${x.id}\`)`, "");
      if (!x.example) { L.push("- **Example:** none, in the Descriptor or with the request, so it was not run.", ""); continue; }
      L.push(`- **Example:** ${x.example_from}. A good result, it says: "${cell(trim(x.example.good_result) || "not stated")}"`);
      if (x.form?.ok) L.push(`- **Form:** filled from the Descriptor: ${x.form.shown.map((s) => `${s.input} = ${cell(s.value)}`).join("; ") || "nothing to fill"}.`);
      else L.push(`- **Form:** could not be filled: ${(x.form?.problems ?? []).map(cell).join("; ")}.`);
      const r = x.run;
      if (r) {
        L.push(`- **Run:** job ${r.job ?? "none"}, ${r.state}${r.waited_seconds ? ` after ${r.waited_seconds} seconds` : ""}${r.agent_version ? `, made by version ${r.agent_version}` : ""}.${r.asked ? ` It asked: "${cell(r.asked.slice(0, 200))}"${r.answered ? `, and the tester answered as a person in a hurry would.` : "."}` : ""}${r.error ? ` ${cell(r.error)}.` : ""}`);
        if (r.pieces.length) {
          L.push("- **What came back:**");
          for (const q of r.pieces) L.push(`  - ${q.name} (${q.kind}): ${q.readable ? "readable" : q.for_a_person ? "not readable" : "for an agent, not a person"}${q.words ? `, ${cell(q.words)}` : ""}${q.problems.length ? `; ${q.problems.map(cell).join("; ")}` : ""}.`);
        }
      }
      const c = x.change;
      if (c && !c.not && c.asked) L.push(`- **Change:** asked "${cell(c.asked)}"${c.steps?.length ? ` (redo: ${c.steps.join(", ")})` : ""}: ${c.price ? `not sent, because it has a price (${cell(c.price)}); the tester never pays` : c.refused ? `refused, "${cell(trim(c.refused).slice(0, 200))}"` : c.version ? `version ${c.version} came back after ${c.waited_seconds} seconds${c.delivers ? "" : ", without the deliverable"}` : cell(c.error ?? "no new version")}.`);
      else if (c?.not) L.push(`- **Change:** not asked: ${cell(c.not)}.`);
      L.push("");
    }
  }
  L.push("## Descriptor checks", "");
  for (const c of t.checks.checks) L.push(`- **${c.check}**: ${c.result}. ${cell(c.evidence)}`);
  L.push("");
  L.push("## Findings", "");
  if (!findings.length) L.push("None.");
  findings.forEach((x, i) => L.push(`${i + 1}. **${x.label}** (${x.check}) · ${cell(x.place)}: ${cell(x.what)}. ${cell(x.consequence).replace(/^./, (ch) => ch.toUpperCase())}. Fixed by: ${x.fixed_by}.`));
  L.push("");
  L.push("## A person's judgment", "");
  if (!t.judgment) L.push("No person added a judgment to this report.");
  else {
    const yn = (v) => (v === true ? "yes" : v === false ? "no" : "not said");
    L.push(`- Understood what it does: ${yn(t.judgment.understood)}`);
    L.push(`- Could use the result: ${yn(t.judgment.could_use)}`);
    L.push(`- It did the job: ${yn(t.judgment.did_the_job)}`);
    if (trim(t.judgment.note)) L.push(`- Note: ${cell(t.judgment.note)}`);
  }
  L.push("");
  L.push("## Not checked", "");
  if (!t.not_checked.length) L.push("Nothing.");
  for (const n of t.not_checked) L.push(`- ${cell(n)}`);
  L.push("");
  return { text: L.join("\n"), header, verdict, findings };
}
