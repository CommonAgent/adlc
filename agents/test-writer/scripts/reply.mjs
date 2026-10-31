// The reply: what was written, what the check said, and what could not be
// written.
//
// The suite always goes, even when its check found something on the second
// go: a suite with a thin spot named is more use than no suite, and the
// finding is said in the reply where the person reads it. What must never
// happen is the other thing: a suite delivered as checked when the check
// said it asserts nothing.
//
// Order is deliberate: what it is, then what the check said, then what could
// not be tested and why, then what the job went without. A reader who stops
// after two sentences has read the part that decides whether to use it.
//
//   needs: node >= 22
//   RECORDS=<records folder> node reply.mjs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { paragraph } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line saying what was written, or, when nothing was written and a
 *  suite was proved, what was checked. */
export function wroteLine(declared = null, suite = null, checked = null) {
  const files = suite?.files ?? [];
  const tests = files.reduce((n, f) => n + (f.tests ?? 0), 0);
  const who = declared ? `${declared.name}${declared.version ? ` ${declared.version}` : ""}` : "the package";
  if (!files.length) {
    const checkedFiles = checked?.files ?? [];
    if (checkedFiles.length) return `Checked the suite of ${plural(checkedFiles.length, "file")} for ${who}: ${checkedFiles.map((p) => String(p).replace(/^test\//, "")).join(", ")}.`;
    return `Nothing was written for ${who}.`;
  }
  const names = files.map((f) => f.path.replace(/^test\//, "")).join(", ");
  const kept = suite?.kept ?? [];
  const revised = suite?.revised ?? [];
  if (revised.length) {
    const each = files.map((f) => `${f.path.replace(/^test\//, "")} (${plural(f.tests ?? 0, "test")})`).join(", ");
    return `Revised ${plural(revised.length, "test file")} the code step sent back for ${who}: ${each}.`
      + (kept.length ? ` The other ${plural(kept.length, "file")} ${kept.length === 1 ? "was" : "were"} kept exactly as ${kept.length === 1 ? "it was" : "they were"} and ${kept.length === 1 ? "is" : "are"} not sent back.` : "");
  }
  if (kept.length) {
    return `Added ${plural(tests, "test")} in ${plural(files.length, "new file")} to the suite ${who} already has: ${names}. The ${plural(kept.length, "file")} it already had ${kept.length === 1 ? "was" : "were"} kept exactly as ${kept.length === 1 ? "it was" : "they were"} and ${kept.length === 1 ? "is" : "are"} not sent back.`;
  }
  const inParts = suite?.parts > 1 ? ` It was written in ${suite.parts} parts, because one answer could not hold it.` : "";
  return `Wrote ${plural(tests, "test")} in ${plural(files.length, "file")} for ${who}: ${names}.${inParts}`;
}

/** The whole reply. Every part is optional but the first. */
export function replyText({ declared = null, suite = null, checked = null, wentWithout = "" } = {}) {
  const lines = [wroteLine(declared, suite, checked)];
  if (trim(checked?.verdict)) lines.push(trim(checked.verdict));
  else if (suite?.stand_ins) {
    // The writing step ran the stand-ins itself; say what it saw even when
    // the checking step never ran.
    const s = suite.stand_ins;
    lines.push(s.fails
      ? `Against empty stand-ins for the ${plural(s.scripts, "script")} it names, the suite fails (${s.pass} of ${s.tests} pass), which is what a suite written before the scripts must do.`
      : `Against empty stand-ins the suite passes (${s.pass} of ${s.tests}), so it asserts nothing about the scripts. It is not a suite yet.`);
  }
  const findings = suite?.findings ?? [];
  if (findings.length) {
    lines.push(`After two goes the suite still has ${plural(findings.length, "thing")} wrong with it, and it goes with ${findings.length === 1 ? "that" : "those"} said: ${findings.join("; ")}.`);
  }
  for (const c of suite?.could_not ?? []) {
    if (!trim(c?.what)) continue;
    lines.push(`It could not write a test for ${trim(c.what)}${trim(c.why) ? `: ${trim(c.why).replace(/\.$/, "")}` : ""}.`);
  }
  if (trim(suite?.notes)) lines.push(`It assumed: ${trim(suite.notes).replace(/\.$/, "")}.`);
  if (trim(wentWithout)) lines.push(trim(wentWithout));
  lines.push("The scripts that meet this suite are the code writer's to write, and nothing here will change a test to make them pass.");
  return lines.join("\n\n");
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  if (!RECORDS) { console.error("RECORDS is required"); process.exit(2); }
  const readJson = (name) => {
    const p = join(RECORDS, name);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
  };
  try {
    const reply = replyText({
      declared: readJson("declared.json"),
      suite: readJson("suite.json"),
      checked: readJson("checked.json"),
      wentWithout: paragraph(RECORDS),
    });
    console.log(JSON.stringify({ ok: true, code: 0, reply }));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
