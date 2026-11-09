// Read the request: the command's own arguments, the message's `name: value`
// lines, and the attached files, each known by what it holds.
//
// What a job is given:
//   - the repository and the commit, as words: `repository: <its address>`
//     and `commit: <digest>` lines in the message, or --repository and
//     --commit on the command line;
//   - the codebase: a folder (--codebase, on the command line), or a gzip tar
//     archive of the folder attached to the job, unpacked into the job's work
//     folder (an archive that holds its .git folder keeps its history, so the
//     commit can be checked and drift read);
//   - optionally the last as-built record, attached (its record.json, and its
//     behaviors.json if it is at hand), which makes the job drift;
//   - optionally whether it may run things: the run config's `may_run`
//     setting, a `may run: yes` line, or --may-run yes.
// A path or an address written in the message is never followed: the folder
// comes from the command line or an attached archive, and the repository line
// is words that tie the record to its source, never fetched.
//
//   needs: node >= 22
//   import { fromArgv, readRequest } from "./read-request.mjs"
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { handedSettings, settingsFor } from "./run-config.mjs";

const trim = (s) => String(s ?? "").trim();

export function fromArgv(args = []) {
  const parsed = { files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--job") parsed.job = args[++i];
    else if (a === "--records") parsed.records = args[++i];
    else if (a === "--work") parsed.work = args[++i];
    else if (a === "--text-file") parsed.textFile = args[++i];
    else if (a === "--codebase") parsed.codebase = args[++i];
    else if (a === "--repository") parsed.repository = args[++i];
    else if (a === "--commit") parsed.commit = args[++i];
    else if (a === "--may-run") parsed.mayRun = args[++i];
    else if (a === "--previous") parsed.files.push({ path: String(args[++i] ?? ""), declared: "" });
    else if (a === "--file") {
      const v = String(args[++i] ?? "");
      const at = v.lastIndexOf("::");
      parsed.files.push(at === -1 ? { path: v, declared: "" } : { path: v.slice(0, at), declared: v.slice(at + 2) });
    }
  }
  return parsed;
}

/** The `name: value` lines of the message this agent reads. */
export function linesIn(text = "") {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*(repository|repo|commit|commit digest|may run|run)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k === "repository" || k === "repo") out.repository = m[2];
    else if (k === "commit" || k === "commit digest") out.commit = m[2];
    else out.mayRun = m[2];
  }
  return out;
}

/** yes/no from the words a person or a host writes, or null. */
export function yesNo(v) {
  const t = trim(v).toLowerCase();
  if (["yes", "y", "true", "1", "allowed", "run"].includes(t)) return true;
  if (["no", "n", "false", "0", "read only", "read-only", "no run"].includes(t)) return false;
  return null;
}

/** The settings this agent declares (the Descriptor's run_config). */
export const SETTINGS = [
  { name: "may_run", kind: "rule", default: "no", allowed: ["no", "yes"] },
  { name: "baseline_seconds", kind: "preference", default: 300, range: { min: 30, max: 600, step: 30 } },
];

const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Sort the attached files by what each holds: {archives, previous,
 *  previousBehaviors, runContext, unread}. */
export function sortFiles(files = []) {
  const out = { archives: [], previous: [], previousBehaviors: [], runContext: [], unread: [] };
  for (const f of files) {
    const name = basename(f.path);
    let bytes;
    try { bytes = readFileSync(f.path); } catch { out.unread.push({ name, why: "it could not be read" }); continue; }
    if (isGzip(bytes)) { out.archives.push({ ...f, name }); continue; }
    if (/run-context/i.test(name)) { out.runContext.push(f.path); continue; }
    let doc = null;
    try { doc = JSON.parse(bytes.toString("utf8")); } catch { /* not JSON */ }
    if (doc?.format === "as-built-record-v1") out.previous.push({ ...f, name, doc, bytes });
    else if (doc?.format === "as-built-behaviors-v1") out.previousBehaviors.push({ ...f, name, doc });
    else if (doc?.["run-context"]) out.runContext.push(f.path);
    else out.unread.push({ name, why: doc ? "it is JSON this agent does not read (it reads an as-built record or its behaviors)" : "it is neither a gzip tar archive of the codebase nor an as-built record" });
  }
  return out;
}

/** The request, read: {repository, commit, codebase, archives, previous,
 *  mayRun, seconds, refused, unread, said}. */
export function readRequest(args, text = "") {
  const said = linesIn(text);
  const sorted = sortFiles(args.files);
  const handed = handedSettings(sorted.runContext);
  const settings = settingsFor(SETTINGS, handed);
  const fromLines = yesNo(args.mayRun ?? said.mayRun);
  const mayRun = settings.refused ? false : fromLines ?? settings.values.may_run === "yes";
  return {
    repository: trim(args.repository ?? said.repository),
    commit: trim(args.commit ?? said.commit).toLowerCase(),
    codebase: trim(args.codebase),
    archives: sorted.archives,
    previous: sorted.previous[0] ?? null,
    previousCount: sorted.previous.length,
    previousBehaviors: sorted.previousBehaviors[0]?.doc ?? null,
    mayRun,
    seconds: settings.refused ? 300 : settings.values.baseline_seconds,
    refused: settings.refused ?? "",
    unread: sorted.unread,
  };
}
