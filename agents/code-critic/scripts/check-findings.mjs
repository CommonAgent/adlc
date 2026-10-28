// Check the findings: a finding that names no place is not a finding.
//
// Every finding the model gave is held to the shape a person can answer
// (references/what-a-finding-is.md). It must name a file that was reviewed
// and a line that file has; it must make a claim and say a consequence; it
// must not grade the work, praise it, or tell somebody how to fix it in code;
// and it must not be one the house-rule check already made. A finding that
// fails is dropped, and the record says which and why, so nothing the model
// said disappears without a trace. With a diff, a finding about a line the
// change did not touch is kept apart as outside the change.
//
//   needs: node >= 22
//   RECORDS=<this job's records folder> node check-findings.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RULES, inChange } from "./house-rules.mjs";

const trim = (s) => String(s ?? "").trim();

const GRADING = /\b(overall|in general|generally (good|solid|clean)|well[- ]written|looks good|lgtm|nicely|great job|good job|solid work|high quality|score|grade|rating)\b/i;
const FIX_CODE = /```|\breplace (it|this|line \d+) with\b/i;

/** "scripts/x.mjs:52", "scripts/x.mjs:52-60", "`scripts/x.mjs` line 52". */
export function placeOf(text) {
  const t = trim(text).replace(/`/g, "");
  const m = /^(.+?)(?::|,?\s+lines?\s+)(\d+)(?:\s*[-–]\s*\d+)?\s*$/.exec(t);
  return m ? { file: trim(m[1]), line: Number(m[2]) } : { file: t, line: null };
}

/** Kept and dropped, each with its reason. */
export function checkFindings(answered = [], read, houseFindings = []) {
  const files = new Map(read.files.map((f) => [f.path, f]));
  const kept = [], dropped = [], outside = [];
  const seen = [...houseFindings];
  for (const a of answered) {
    const p = placeOf(a.place_text);
    const drop = (why) => dropped.push({ ...a, why });
    let file = files.has(p.file) ? p.file : [...files.keys()].find((k) => p.file.endsWith(`/${k}`) || k.endsWith(`/${p.file}`)) ?? null;
    if (!trim(a.place_text) || !file) { drop(trim(a.place_text) ? `it names ${p.file}, which is not a file of this package` : "it names no place"); continue; }
    const lines = files.get(file).lines;
    if (!p.line) { drop("it names a file and no line"); continue; }
    if (lines != null && (p.line < 1 || p.line > lines)) { drop(`${file} has ${lines} lines and it names line ${p.line}`); continue; }
    if (!trim(a.claim)) { drop("it makes no claim"); continue; }
    if (!trim(a.consequence)) { drop("it says no consequence"); continue; }
    if (GRADING.test(a.claim) && !/\b(not|no|never|fails?|missing|wrong)\b/i.test(a.claim)) { drop("it grades the work rather than naming something wrong"); continue; }
    if (FIX_CODE.test(`${a.claim} ${a.consequence}`)) { drop("it writes the fix, which is not this role's"); continue; }
    const rule = RULES[a.rule] ? a.rule : "general";
    const f = { source: "review", rule, place: { file, line: p.line }, claim: trim(a.claim), consequence: trim(a.consequence) };
    const twin = seen.find((s) => s.place.file === f.place.file && Math.abs((s.place.line ?? 0) - f.place.line) <= 2 && (s.rule === f.rule || f.rule === "general"));
    if (twin) { drop(twin.source === "house rule" ? "the house-rule check already found it" : "it repeats another finding"); continue; }
    seen.push(f);
    (inChange(f, read) ? kept : outside).push(f);
  }
  return { checked: "v1", kept, outside_the_change: outside, dropped };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  if (!RECORDS) { console.error("RECORDS is required"); process.exit(2); }
  const readJson = (n) => { const p = join(RECORDS, n); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
  const read = readJson("read.json");
  const house = readJson("house-rules.json") ?? { findings: [] };
  const rev = readJson("review.json") ?? { answered: [] };
  const out = checkFindings(rev.answered ?? [], read, [...(house.findings ?? []), ...(house.outside_the_change ?? [])]);
  writeFileSync(join(RECORDS, "checked.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, code: 0, kept: out.kept.length, dropped: out.dropped.length }));
}
