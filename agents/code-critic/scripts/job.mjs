// The whole job as one command: what was given read and laid out, the five
// steps run in order, the findings filed, and one reply printed.
//
// A job whose every step is a script is a job that runs as one script, so
// the package names this file as the job's command (12.3 `run`) and nothing
// is left to a harness to improvise. The one model call is the one review.mjs
// makes, through caller.mjs, with the model the install configured.
//
//   read the change        read-change.mjs      no model
//   check the house rules  house-rules.mjs      no model
//   review the code        review.mjs           the text-reasoning system, once or twice
//   check the findings     check-findings.mjs   no model
//   write the findings     write-findings.mjs   no model, then pieces.mjs
//
// When nothing reviewable came (no script and no declaration), the job stops
// with exit 3 and says what a review is given, and no model is called. When
// the model cannot be had, the house-rule findings still go, and the reply
// says the review went without the model.
//
//   needs: node >= 22; the text-reasoning system for the review step
//   node job.mjs --job <job folder> --records <records dir> --work <work dir>
//        --text-file <path> [--file <path>[::<media type>]]...
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readChange, writeRead } from "./read-change.mjs";
import { checkHouseRules } from "./house-rules.mjs";
import { chooseFiles, review } from "./review.mjs";
import { checkFindings } from "./check-findings.mjs";
import { answerAgainst, earlierFindings, findingsDocument, replyText } from "./write-findings.mjs";
import { fill } from "./pieces.mjs";
import { note, paragraph } from "./went-without.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();
const readIf = (p) => (p && existsSync(p) ? readFileSync(p, "utf8") : "");

/** This agent's version, from the manifest the package carries. */
function ownVersion() {
  for (const p of [join(HERE, "..", "plugin.json"), join(HERE, "..", "..", "..", "plugin.json")]) {
    try { const v = JSON.parse(readFileSync(p, "utf8")).version; if (v) return v; } catch { /* next */ }
  }
  return "";
}

/** A reference, from this skill's folder or the package's. */
function reference(name) {
  for (const p of [join(HERE, "..", "references", name), join(HERE, "..", "..", "..", "references", name)]) if (existsSync(p)) return readFileSync(p, "utf8");
  return "";
}

export function parseArgs(argv) {
  const o = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--job") o.job = next();
    else if (a === "--records") o.records = next();
    else if (a === "--work") o.work = next();
    else if (a === "--text-file") o.textFile = next();
    else if (a === "--file") { const [path, media] = String(next() ?? "").split("::"); o.files.push({ path, media_type: media || "" }); }
  }
  return o;
}

export const EMPTY = "Nothing attached is a package to review. A review is given the programs (the package's scripts, or the whole package folder as a tar.gz), its declarations (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and the SKILL.md files), its tests, and the Code stage's account; a diff makes the change that diff. Attach them and ask again.";

/** The job. Returns {ok, code, reply, pieces}. */
export async function runJob({ job, records, work, files = [], textFile = "", env = process.env, fetchImpl = fetch, call, now = () => new Date().toISOString() } = {}) {
  if (!job || !records || !work) return { ok: false, code: 2, reply: "The job command needs --job, --records and --work." };
  const id = basename(job);
  const RECORDS = join(records, id);
  mkdirSync(RECORDS, { recursive: true });
  mkdirSync(join(work, id), { recursive: true });

  // 1. Read the change.
  const asked = readIf(textFile);
  const r = readChange(files, { asked });
  writeRead(RECORDS, r);
  const read = JSON.parse(readFileSync(join(RECORDS, "read.json"), "utf8"));
  if (!read.files.some((f) => f.role === "script" || f.role === "declaration")) {
    return { ok: false, code: 3, reply: EMPTY + (read.notes.length ? ` (${read.notes.join("; ")}.)` : "") };
  }
  if (!read.files.some((f) => f.path === "agent-descriptor.json")) {
    note(RECORDS, { wanted: "the package's declarations", did: "reviewed the scripts alone, so nothing was checked against what the package declares" });
  }
  if (!read.files.some((f) => f.role === "test")) note(RECORDS, { wanted: "the tests", did: "reviewed the programs without them" });
  if (!read.account) note(RECORDS, { wanted: "the Code stage's account", did: "reviewed the code without holding it to its writer's account" });
  const texts = r.texts;

  // 2. Check the house rules.
  const house = checkHouseRules(read, texts);
  writeFileSync(join(RECORDS, "house-rules.json"), JSON.stringify(house, null, 2) + "\n");

  // 3. Review the code.
  const { sent, left } = chooseFiles(read, texts);
  const rev = await review({
    read, texts, sent, houseFindings: [...house.findings, ...house.outside_the_change],
    rulesRef: reference("the-house-rules.md"), findingRef: reference("what-a-finding-is.md"),
    account: r.account_text, diff: r.diff_text, earlier: r.earlier_text,
  }, { env, fetchImpl, ...(call ? { call } : {}) });
  if (left.length) note(RECORDS, { wanted: `room for ${left.length} of the files in one review`, did: `reviewed the rest and named those it left out: ${left.join(", ")}` });
  if (rev.error) note(RECORDS, { wanted: "the model's review", did: "delivered the house-rule findings only", why: rev.error });
  writeFileSync(join(RECORDS, "review.json"), JSON.stringify({ review: "v1", sent, left, none: rev.none, error: rev.error, answered: rev.findings }, null, 2) + "\n");
  writeFileSync(join(RECORDS, "calls.json"), JSON.stringify({ calls: rev.calls }, null, 2) + "\n");

  // 4. Check the findings.
  const checked = checkFindings(rev.findings, read, [...house.findings, ...house.outside_the_change]);
  writeFileSync(join(RECORDS, "checked.json"), JSON.stringify(checked, null, 2) + "\n");

  // 5. Write the findings.
  const { findings, earlier } = answerAgainst([...house.findings, ...checked.kept], earlierFindings(r.earlier_text));
  const wentWithout = paragraph(RECORDS);
  const doc = findingsDocument({
    read, findings, outside: [...house.outside_the_change, ...checked.outside_the_change], dropped: checked.dropped,
    earlier, leftOut: left, wentWithout, modelError: rev.error, version: ownVersion(), now: now(),
  });
  writeFileSync(join(RECORDS, "findings.md"), doc);
  const reply = replyText({ read, findings, wentWithout, modelError: rev.error });
  let pieces = null, filedNote = null;
  try { fill(job, doc); pieces = "pieces.json"; } catch (e) { filedNote = `the findings were not filed: ${e.message}`; }
  return { ok: true, code: 0, reply, pieces, findings: findings.length, open: findings.filter((f) => !trim(f.answer)).length, ...(filedNote ? { note: filedNote } : {}) };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const o = parseArgs(process.argv.slice(2));
  try {
    const out = await runJob(o);
    console.log(JSON.stringify(out));
    process.exitCode = out.reply ? 0 : 1;
  } catch (e) {
    console.log(JSON.stringify({ ok: false, code: 1, reply: `I could not finish this review: ${e.message}` }));
    process.exitCode = 1;
  }
}
