// Check the evidence: every claim the draft makes names a file and line that
// exists at the commit, or the observed run, or it is not delivered.
//
// The model drafts; this file decides what is delivered. For each claim it
// reads the evidence the claim names and keeps only what checks: the file is
// inside the codebase and among the files read at the commit, the line is a
// line of that file, a range ends after it starts and inside the file, and an
// observed run is cited only when the run happened. A claim left with no
// evidence that checks is taken out of its part and listed among the gaps as
// a claim that could not be checked, with what it cited and why that failed.
//
// Two more things hold a claim back, because the role forbids them: words
// that judge the code (a bug, wrong, should, broken) and words that infer
// beyond what is seen (meant to, probably, seems to). Words inside quotes or
// backticks are the code's own and never count. A claim held back is listed
// among the gaps with the word that held it.
//
// On drift a claim must also be about what changed: a new or changed claim
// cites at least one line that changed since the last record, and a removed
// one cites a line of the last record's commit that is gone or changed. A
// claim about lines that did not change is not delivered, and is listed as
// outside the change, because the last record already says it.
//
//   needs: node >= 22. Nothing here writes a file.
//   import { checkEvidence, checkClaims } from "./evidence.mjs"
import { linesOf, slash } from "./codebase.mjs";

const trim = (s) => String(s ?? "").trim();

/** Words that judge what the code does. */
export const JUDGING = /\b(bugs?|buggy|wrong(ly)?|incorrect(ly)?|should(n't| not)?|broken|mistakes?|flaw(ed|s)?|correct(ly)?|properly|improperly|sloppy|faulty|erroneous(ly)?|intended|unintended|accidental(ly)?|oversight)\b/i;
/** Words that infer beyond what is seen. */
export const INFERRING = /\b(meant to|supposed to|probably|likely|presumably|seems? to|appears? to|apparently|might be|may be intended|was designed to|the author|perhaps|guess)\b/i;

/** Text with quoted and backticked spans taken out, so the code's own words
 *  are never read as the record's. */
export const unquoted = (s) => String(s ?? "").replace(/`[^`]*`/g, " ").replace(/"[^"]*"/g, " ").replace(/'[^'\n]{1,200}'/g, " ");

/** One evidence entry, read from the forms a draft writes: {file, line,
 *  end_line?, at?}, "file:12", "file:12-20", or {run: "baseline"}. */
export function readEvidence(e) {
  if (typeof e === "string") {
    const s = trim(e);
    if (/^run(:|$)/i.test(s) || /^observed run/i.test(s)) return { run: "baseline" };
    const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(s);
    return m ? { file: slash(m[1]), line: Number(m[2]), ...(m[3] ? { end_line: Number(m[3]) } : {}) } : { unreadable: s };
  }
  if (!e || typeof e !== "object") return { unreadable: JSON.stringify(e) };
  if (e.run) return { run: "baseline" };
  const file = slash(trim(e.file ?? e.path));
  const line = Number(e.line ?? e.start_line ?? e.start);
  const end = e.end_line ?? e.end;
  return {
    file, line,
    ...(end !== undefined && end !== null && end !== "" ? { end_line: Number(end) } : {}),
    ...(trim(e.at) ? { at: trim(e.at).toLowerCase() } : {}),
  };
}

const said = (e) => (e.run ? "the observed run" : e.unreadable !== undefined ? JSON.stringify(e.unreadable) : `${e.file}:${e.line}${e.end_line ? `-${e.end_line}` : ""}${e.at ? ` at ${e.at.slice(0, 12)}` : ""}`);

/** Why one evidence entry does not check, or "" when it does. `ctx` holds
 *  {files: Set, lineCount(file), ran, previous: {commit, lineCount(file)}}. */
export function evidenceProblem(e, ctx) {
  if (e.unreadable !== undefined) return `${said(e)} is not a file and line`;
  if (e.run) return ctx.ran ? "" : "it cites an observed run, and the code was not run";
  if (!e.file || e.file.startsWith("/") || /^[a-zA-Z]:/.test(e.file) || e.file.split("/").includes("..")) return `${said(e)} is not a path inside the codebase`;
  if (!Number.isInteger(e.line) || e.line < 1) return `${said(e)} names no line`;
  const atPrevious = e.at && ctx.previous && (ctx.previous.commit.startsWith(e.at) || e.at.startsWith(ctx.previous.commit.slice(0, 7)));
  if (e.at && !atPrevious) return `${said(e)} names a commit that is neither this one nor the last record's`;
  const count = atPrevious ? ctx.previous.lineCount(e.file) : (ctx.files.has(e.file) ? ctx.lineCount(e.file) : null);
  if (count === null || count === undefined) return `${e.file} is not a file of the codebase${atPrevious ? " at the last record's commit" : " at this commit"}`;
  if (e.line > count) return `${said(e)} is past the end of ${e.file}, which has ${count} line${count === 1 ? "" : "s"}`;
  if (e.end_line !== undefined) {
    if (!Number.isInteger(e.end_line) || e.end_line < e.line) return `${said(e)} ends before it starts`;
    if (e.end_line > count) return `${said(e)} runs past the end of ${e.file}, which has ${count} line${count === 1 ? "" : "s"}`;
  }
  return "";
}

/** The evidence of one claim, checked: {kept, failed: [{evidence, why}]}. */
export function checkEvidence(list, ctx) {
  const kept = []; const failed = [];
  for (const raw of Array.isArray(list) ? list : list ? [list] : []) {
    const e = readEvidence(raw);
    const why = evidenceProblem(e, ctx);
    if (why) failed.push({ evidence: said(e), why });
    else kept.push(e.run ? { run: "baseline" } : { file: e.file, line: e.line, ...(e.end_line && e.end_line !== e.line ? { end_line: e.end_line } : {}), ...(e.at ? { at: ctx.previous.commit } : {}) });
  }
  return { kept, failed };
}

const overlaps = (e, ranges) => (ranges ?? []).some(([a, b]) => (e.end_line ?? e.line) >= a && e.line <= b);

/** On drift, whether a claim's kept evidence touches what changed. */
export function touchesChange(kept, change, drift) {
  if (!drift) return true;
  if (change === "removed") {
    return kept.some((e) => e.at && drift.byFile.get(e.file) && (drift.byFile.get(e.file).status === "deleted" || overlaps(e, drift.byFile.get(e.file).old_lines)));
  }
  return kept.some((e) => !e.at && drift.byNewFile.get(e.file) && (["added", "copied"].includes(drift.byNewFile.get(e.file).status) || overlaps(e, drift.byNewFile.get(e.file).new_lines)));
}

/** The words of a claim the judging and inferring checks read. */
const wordsOf = (claim, fields) => fields.map((f) => {
  const v = claim?.[f];
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") : typeof v === "string" ? v : "";
}).join(" ");

/** Check a list of claims: {kept, gaps}. `label(claim)` says the claim in a
 *  few words for a gap; `fields` are the words read for judging. */
export function checkClaims(claims, ctx, { part, label, fields = ["name", "does"], drift = null }) {
  const kept = []; const gaps = [];
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!c || typeof c !== "object") continue;
    const about = trim(label(c)) || "(a claim with no words)";
    const words = unquoted(wordsOf(c, fields));
    const judged = JUDGING.exec(words);
    if (judged) { gaps.push({ kind: "held-back", part, about, why: `it was drafted with a judgment ("${judged[0]}"), and the record describes what the code does without saying whether it is right; the person decides at Requirements` }); continue; }
    const inferred = INFERRING.exec(words);
    if (inferred) { gaps.push({ kind: "held-back", part, about, why: `it was drafted with an inference ("${inferred[0]}"), and the record says nothing beyond what the evidence shows` }); continue; }
    const { kept: ev, failed } = checkEvidence(c.evidence, ctx);
    if (!ev.length) {
      gaps.push({
        kind: "claim-without-evidence", part, about,
        why: failed.length ? `none of its evidence checks: ${failed.map((f) => (f.why.startsWith(f.evidence) || f.why.startsWith(f.evidence.split(":")[0]) ? f.why : `${f.evidence}: ${f.why}`)).join("; ")}` : "it names no evidence",
      });
      continue;
    }
    if (drift && !touchesChange(ev, c.change, drift)) {
      gaps.push({ kind: "outside-the-change", part, about, why: `its evidence (${ev.map(said).join(", ")}) is not among the lines that changed since the last record, which already says what is there` });
      continue;
    }
    kept.push({ ...c, evidence: ev, ...(failed.length ? { evidence_dropped: failed } : {}) });
  }
  return { kept, gaps };
}

/** The context the checks read, from the codebase and the run. */
export function contextFor({ files, read, ran = false, previous = null }) {
  const counts = new Map();
  const lineCount = (f) => {
    if (!counts.has(f)) { const t = read(f); counts.set(f, t === null || t === undefined ? null : linesOf(t).length); }
    return counts.get(f);
  };
  return { files: new Set(files), lineCount, ran, previous };
}
