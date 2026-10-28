// The reply: what was written, how many rounds it took, what the check said,
// and, when nothing is delivered, which of the three stops it was.
//
// Order is deliberate: whether anything is delivered and why, first, because
// that is what the next step needs; then the check's words as written; then
// the writer's own account; then what the job went without. A reader who
// stops after two sentences knows whether there are scripts to take.
//
//   needs: node >= 22
//   RECORDS=<records folder> node report.mjs
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { paragraph } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The whole reply. `account` and `conflict` are the harness's own files,
 *  as text; the rest are the records. */
export function replyText({ workspace = null, runs = [], verdict = null, account = "", conflict = "", wentWithout = "" } = {}) {
  const lines = [];
  const scripts = workspace?.scripts ?? [];
  const who = workspace?.name ? workspace.name : "the package";
  const rounds = runs.length;
  const last = runs[runs.length - 1] ?? null;

  if (trim(conflict)) {
    lines.push(`Stopped without delivering after ${plural(rounds, "round")}: a test cannot pass without breaking what the spec says.`);
    lines.push(trim(conflict).slice(0, 1200));
    lines.push("Which of the two is wrong is a person's call at the review gate. Send the run back to write-the-spec or write-the-tests once it is settled.");
  } else if (verdict?.done) {
    lines.push(`Wrote ${plural(scripts.length, "script")} for ${who} in ${plural(rounds, "round")}; the suite passes, ${verdict.tests ?? last?.pass ?? 0} of ${verdict.tests ?? last?.tests ?? 0}.`);
    const said = trim(verdict.said).replace(/^Round \d+: the suite passes, \d+ of \d+\.\s*/, "");
    if (said) lines.push(said);
  } else if (verdict?.stop === "ceiling") {
    lines.push(`Stopped after ${plural(rounds, "round")} without delivering: the rounds are used up and the suite still fails${last ? `, ${last.fail} of ${last.tests}` : ""}.`);
    if (last?.failing?.length) lines.push(`Still failing: ${last.failing.slice(0, 8).join("; ")}${last.failing.length > 8 ? `; and ${last.failing.length - 8} more` : ""}.`);
    lines.push("This goes to the owner: raise the ceiling and send it again, or read the account for where it got to.");
  } else if (verdict?.stop === "fence") {
    lines.push(`Stopped without delivering: ${trim(verdict.said)}`);
  } else if (rounds) {
    lines.push(`Not done after ${plural(rounds, "round")}: the suite still fails${last ? `, ${last.fail} of ${last.tests}` : ""}. Nothing is delivered.`);
  } else {
    lines.push(`Nothing was checked for ${who}: no round was run.`);
  }

  if (trim(account)) lines.push(`The writer's account: ${trim(account).replace(/\s+/g, " ").slice(0, 900)}`);
  if (trim(wentWithout)) lines.push(trim(wentWithout));
  if (verdict?.done) lines.push("The scripts go with a signed manifest, and the package-maker takes only what that manifest lists.");
  return lines.join("\n\n");
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  if (!RECORDS) { console.error("RECORDS is required"); process.exit(2); }
  const readJson = (name) => { const p = join(RECORDS, name); if (!existsSync(p)) return null; try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
  const readText = (name) => { const p = join(RECORDS, name); return existsSync(p) ? readFileSync(p, "utf8") : ""; };
  try {
    const workspace = readJson("workspace.json");
    let name = null;
    try {
      if (workspace?.folder) {
        const manifest = join(workspace.folder, "plugin.json");
        name = JSON.parse(readFileSync(existsSync(manifest) ? manifest : join(workspace.folder, "spec.json"), "utf8")).name ?? null;
      }
    } catch { name = null; }
    const reply = replyText({
      workspace: workspace ? { ...workspace, name } : null,
      runs: readJson("runs.json")?.runs ?? [],
      verdict: readJson("verdict.json"),
      account: readText("account.md"),
      conflict: readText("conflict.md"),
      wentWithout: paragraph(RECORDS),
    });
    console.log(JSON.stringify({ ok: true, code: 0, reply }));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
