// Describe a codebase: one command, six steps, a model in one of them.
//   needs: node >= 22; git for a checkout and for drift; MODEL_NAME,
//   MODEL_ENDPOINT, MODEL_PROTOCOL (and MODEL_KEY where the endpoint asks for
//   one) for the drafted parts
//   node describe.mjs --job <job folder> --records <records folder> --work <work folder>
//        [--text-file <message>] [--codebase <folder>] [--repository <address>]
//        [--commit <digest>] [--may-run yes|no] [--repository-root <folder>]
//        [--file <path>[::<media type>]]...
//
// This is the command the runtime requirements start (run.reverse-engineer).
// The steps, in order:
//   read-the-codebase      read-request.mjs, codebase.mjs, facts.mjs: the
//                          request, the files at the commit, and what is read
//                          off them by rule
//   list-the-dependencies  sbom.mjs: the CycloneDX bill of materials
//   run-the-baseline       baseline.mjs: one run of the project's own tests,
//                          only when the job may run things
//   draft-from-the-code    draft.mjs: the model drafts the behaviors, the
//                          architecture as built, the interfaces and what
//                          each test covers, in bounded passes on adoption
//                          and in one pass on drift
//   check-the-evidence     evidence.mjs, behaviors.mjs, interfaces.mjs: every
//                          claim's file and line checked against the code,
//                          each behavior's kind, anchor, quotes and rules,
//                          each drafted schema; what fails goes to the gaps
//   write-the-record       record.mjs, pieces.mjs: the five parts, the
//                          record that ties them to the commit, and the reply
//
// It describes and does not judge, writes no tests and changes nothing in the
// codebase. It prints one JSON object with a `reply` field. Exit codes: 0 the
// record was written; 2 usage; 3 the job stops and the reply says what is
// needed; 1 failed.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fromArgv, readRequest } from "./read-request.mjs";
import { changedSince, diffText, filesAt, linesOf, openCodebase, readAt, readInside, resolveCommit } from "./codebase.mjs";
import { readFacts } from "./facts.mjs";
import { componentChanges, isManifest, makeSbom } from "./sbom.mjs";
import { runBaseline, tailOf } from "./baseline.mjs";
import { callFor, chooseFiles, declaredProtocols, draftInPasses, draftRecord, promptOf, whyNoCall } from "./draft.mjs";
import { contextFor, touchesChange } from "./evidence.mjs";
import { buildRecord } from "./record.mjs";
import { carryTests } from "./carried.mjs";
import { fill, plan } from "./pieces.mjs";
import { unpack } from "./archive.mjs";
import { declineText, declinesFor } from "./declines.mjs";
import { modelSettings } from "./model-caller.mjs";
import { note, read as wentWithout, sentence } from "./went-without.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** The agent's name and version, from its declaration beside the scripts. */
export function toolOf(here = HERE) {
  for (const at of [join(here, "..", "plugin.json"), join(here, "..", "..", "..", "plugin.json")]) {
    try { const p = JSON.parse(readFileSync(at, "utf8")); if (p?.name === "reverse-engineer") return { name: p.name, version: trim(p.version) }; } catch { /* look on */ }
  }
  return { name: "reverse-engineer", version: "" };
}

export const HOW_TO_ASK = "Send the repository's address and the commit as words, on lines of their own: `repository: <its address>` and `commit: <the full commit digest>`. Attach the codebase as a gzip tar archive of its folder (with its .git folder, so the commit can be checked), or name the folder with --codebase when running the command yourself. For drift, attach the last as-built record (its record.json). To have its tests run once, say `may run: yes`.";

const many = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
const short = (c) => trim(c).slice(0, 12);
const sameRepo = (a, b) => trim(a).toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "") === trim(b).toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");

/** The reply, in words. */
export function replyText({ declined, source, record, drift, baseline, went, draftProblem }) {
  const L = [];
  const d = declineText(declined);
  if (d) L.push(d);
  const c = record.counts;
  const how = baseline?.ran ? "read it and ran its tests once" : "read it without running anything";
  if (drift) {
    L.push(`I described what changed in ${source.repository} from ${short(drift.since)} to ${short(source.commit)} (${many(drift.changed.length, "file")} changed), and ${how}: ${many(c.behaviors, "behavior")} new, changed or removed, ${many(c.interfaces, "interface")}, ${many(c.settings, "setting")} read on changed lines.`);
    L.push(record.dependencies_changed ? `The dependencies changed: ${record.dependencies_changed.added.length} added, ${record.dependencies_changed.removed.length} removed, ${record.dependencies_changed.changed.length} at another version; the new bill of materials is in sbom.cdx.json.` : "No manifest or lockfile changed, so the dependencies are as the last record left them.");
  } else {
    L.push(`I described ${source.repository} at ${short(source.commit)} and ${how}: ${many(c.behaviors, "behavior")}, ${many(c.interfaces, "interface")}, ${many(c.settings, "setting")} read by name, ${many(c.components, "component")} in the bill of materials, and ${many(c.tests, "test file")}.`);
  }
  if (baseline?.ran) {
    const counts = baseline.passed !== undefined ? `${baseline.passed} passed, ${baseline.failed} failed${baseline.skipped ? `, ${baseline.skipped} skipped` : ""}` : "no summary this agent reads";
    L.push(`The baseline run of \`${baseline.command}\` ${baseline.timed_out ? `was stopped at its ${baseline.time_limit_seconds} second limit` : `ended with exit code ${baseline.exit_code}`}: ${counts}. The network was ${baseline.network.startsWith("cut off") ? "cut off" : "not cut off on this host"}.`);
  }
  if (!record.drafted) L.push(`No model drafted from the code (${draftProblem}), so the behaviors, the architecture's drafted parts and the interfaces are empty, and each is listed as a gap.`);
  if (c.completeness) L.push(`The completeness check ${c.completeness.missing ? `found ${many(c.completeness.missing, "thing")} the record does not hold, each listed as a gap` : "found nothing a rebuild needs missing"}; ${many(c.strings ?? 0, "string and pattern", "strings and patterns")} are in strings.json${c.carried ? `, and ${many(c.carried, "file")} of the original tests are carried under tests/ and support/` : ""}.`);
  L.push(`${many(c.gaps, "gap is", "gaps are")} marked in tests-and-gaps.json${c.held_back ? `, ${c.held_back} of them claims held back because their evidence did not check, they judged or inferred, or they were outside the change` : ""}.`);
  if (went) L.push(went);
  L.push(source.commit_checked ? `Every claim names a file and line at ${short(source.commit)}, checked against the code.` : `The folder was not a git checkout, so the commit ${short(source.commit)} was taken as given; every claim names a file and line checked against the folder as read.`);
  L.push("The record describes and does not judge; at Requirements each behavior is approved, flagged as a bug for the backlog, or dropped.");
  return L.join(" ");
}

/** The job, as the runtime requirements start it. `call` stands in for the
 *  model (a test hands one in); otherwise the shared caller is used. */
export async function runJob(argv = [], env = process.env, { call = null, cutNetwork } = {}) {
  const args = fromArgv(argv);
  if (!args.job || !args.records) return { ok: false, code: 2, reply: "This job needs --job <job folder> and --records <records folder>." };
  const text = args.textFile && existsSync(args.textFile) ? readFileSync(args.textFile, "utf8") : "";
  const declined = declinesFor(text);
  const id = basename(resolve(args.job));
  const RECORDS = join(args.records, id);
  const WORK = args.work ? join(args.work, id) : join(args.records, id, "work");
  mkdirSync(RECORDS, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  rmSync(join(RECORDS, "went-without.json"), { force: true });
  const stop = (why) => ({ ok: false, code: 3, reply: [declineText(declined), why].filter(Boolean).join(" "), declined: declined.map((x) => x.id) });

  // read-the-codebase
  const req = readRequest(args, text);
  if (req.refused) return stop(`The run config was refused: ${req.refused}.`);
  const missing = [];
  if (!req.repository) missing.push("the repository's address");
  if (!req.commit) missing.push("the commit digest");
  if (!req.codebase && !req.archives.length) missing.push("the codebase");
  if (missing.length) return stop(`I cannot describe this codebase yet: I need ${missing.join(", ")}. ${HOW_TO_ASK}`);
  if (req.archives.length > 1) return stop(`${req.archives.length} archives came (${req.archives.map((a) => a.name).join(", ")}), and I describe one codebase. ${HOW_TO_ASK}`);
  if (req.previousCount > 1) return stop("More than one as-built record came, and drift is read against one: the last record made.");
  let folder = req.codebase;
  if (!folder) {
    folder = mkdtempSync(join(WORK, "codebase-"));
    try { unpack(req.archives[0].path, folder); } catch (e) { return stop(`The codebase archive could not be unpacked: ${trim(e.message)}.`); }
  }
  for (const u of req.unread) note(RECORDS, { wanted: u.name, did: "described the codebase without it", why: u.why });
  const cb = openCodebase(folder, { commit: req.commit });
  if (cb.problem) return stop(`I cannot describe this codebase at the named commit: ${cb.problem}.`);
  const source = { repository: req.repository, commit: cb.commit, commit_checked: cb.commit_checked, ...(cb.prefix ? { folder: cb.prefix } : {}) };
  const cache = new Map();
  const read = (f) => { if (!cache.has(f)) cache.set(f, readInside(cb.dir, f)); return cache.get(f); };

  // Drift: the last record, the commits, and what changed between them.
  let drift = null; let previous = null;
  if (req.previous) {
    const prev = req.previous.doc;
    if (!sameRepo(prev.repository, req.repository)) return stop(`The last as-built record is of ${trim(prev.repository) || "no named repository"}, not of ${req.repository}, so drift cannot be read against it.`);
    if (!cb.checkout) return stop("Drift is read from the codebase's git history, and the codebase came with none. Attach the archive with its .git folder, or name a checkout with --codebase.");
    const since = resolveCommit(cb.dir, prev.commit);
    if (!since) return stop(`The last record was made at ${trim(prev.commit)}, which is not in the codebase's history, so what changed since it cannot be read.`);
    const changed = since === cb.commit ? [] : changedSince(cb.dir, since, cb.commit);
    const prevFiles = filesAt(cb.dir, since);
    const prevLines = new Map();
    previous = {
      commit: since,
      digest: createHash("sha256").update(req.previous.bytes).digest("hex"),
      behaviors: Array.isArray(req.previousBehaviors?.behaviors) ? req.previousBehaviors.behaviors.map((b) => ({ id: b.id, name: b.name, files: [...new Set((b.evidence ?? []).map((e) => e.file).filter(Boolean))] }))
        : Array.isArray(prev.behaviors_index) ? prev.behaviors_index : [],
      lineCount: (f) => {
        if (!prevFiles.includes(f)) return null;
        if (!prevLines.has(f)) { const t = readAt(cb.dir, since, f); prevLines.set(f, t === null ? null : linesOf(t).length); }
        return prevLines.get(f);
      },
    };
    drift = {
      since, changed,
      byNewFile: new Map(changed.filter((c) => c.status !== "deleted").map((c) => [c.file, c])),
      byFile: new Map(changed.map((c) => [c.was ?? c.file, c])),
      previousBehaviors: previous.behaviors,
      diff: changed.length ? diffText(cb.dir, since, cb.commit) : "",
    };
  }

  const keep = drift ? (f, line) => {
    const c = drift.byNewFile.get(f);
    return Boolean(c) && (["added", "copied"].includes(c.status) || c.new_lines.some(([a, b]) => line >= a && line <= b));
  } : undefined;
  const facts = readFacts(cb.files, read, { keep });
  if (drift) {
    const touched = (evidence) => touchesChange(evidence, "new", drift);
    facts.entry_points = facts.entry_points.filter((e) => touched(e.evidence));
    facts.starts_and_runs = facts.starts_and_runs.filter((e) => touched(e.evidence));
    facts.schemas = facts.schemas.filter((s) => drift.byNewFile.has(s.file));
    facts.declared_settings = facts.declared_settings.filter((s) => touched(s.evidence));
    const s = facts.surface;
    s.writes = s.writes.filter((w) => touched(w.evidence));
    s.exports = s.exports.filter((e) => touched([{ file: e.module, line: e.line }]));
    s.entries = s.entries.filter((e) => drift.byNewFile.has(e.file));
    s.anchors = s.anchors.filter((a) => drift.byNewFile.has(a.module));
    s.flags = s.flags.filter((f) => touched(f.evidence));
    facts.declarations = facts.declarations.filter((x) => touched(x.evidence));
  }
  const tool = toolOf();

  // list-the-dependencies
  let sbom = null;
  if (!drift) sbom = makeSbom({ files: cb.files, read, repository: source.repository, commit: source.commit, tool });
  else if (drift.changed.some((c) => isManifest(c.file) || (c.was && isManifest(c.was)))) {
    sbom = makeSbom({ files: cb.files, read, repository: source.repository, commit: source.commit, tool });
    const before = makeSbom({ files: filesAt(cb.dir, drift.since), read: (f) => readAt(cb.dir, drift.since, f), repository: source.repository, commit: drift.since, tool });
    sbom.changes = componentChanges(before.bom, sbom.bom);
  }

  // run-the-baseline
  let baseline;
  if (!req.mayRun) baseline = { ran: false, why: "running was not allowed for this job, so the code was only read" };
  else if (!facts.test_command.command) baseline = { ran: false, why: `no test command was run: ${facts.test_command.none}` };
  else {
    const scratch = mkdtempSync(join(WORK, "run-"));
    const r = await runBaseline({ command: facts.test_command.command, cwd: cb.dir, scratch, seconds: req.seconds, env, ...(cutNetwork !== undefined ? { cutNetwork } : {}) });
    writeFileSync(join(RECORDS, "baseline.log"), r.output);
    const { output, ...rest } = r;
    baseline = { ran: true, ...rest, evidence: facts.test_command.evidence, output_tail: tailOf(output, { cwd: cb.dir, scratch }) };
    if (!r.network.startsWith("cut off")) note(RECORDS, { wanted: "a way to run the tests with no network", did: "ran them with npm set offline and said in the record that the network was not cut off" });
  }

  // draft-from-the-code
  let draft = null; let draftProblem = ""; let notSent = []; let seen = new Set(); let calls = { calls: "v1", made: 0, each: [] };
  const nothingToDraft = drift && !drift.changed.length;
  const protocols = declaredProtocols();
  const why = call ? "" : whyNoCall(env, { protocols });
  if (nothingToDraft) draftProblem = "nothing changed since the last record";
  else if (why) {
    draftProblem = why;
    note(RECORDS, { wanted: "a model to draft from the code", did: "wrote the parts read by rule (the settings, entry points, bill of materials, test files and the run) and marked the drafted parts as gaps", why });
  } else {
    const who = { model: call ? "stand-in" : modelSettings(env).name, service: call ? "stand-in" : modelSettings(env).protocol };
    const ask = call ?? callFor(env, { protocols });
    if (drift) {
      // Drift: one pass over the changed files and the diff.
      const only = new Set([...drift.byNewFile.keys()]);
      const chosen = chooseFiles(cb.files, read, { only, first: facts.entry_points.map((e) => e.name.replace(/^\.\//, "")) });
      notSent = chosen.notSent;
      const prompt = promptOf({ repository: source.repository, commit: source.commit, files: cb.files, sent: chosen.sent, notSent, facts, drift });
      const out = await draftRecord({ call: ask, prompt });
      draft = out.draft; draftProblem = out.problem;
      seen = new Set(chosen.sent.map((s) => s.file));
      calls = { calls: "v1", ...who, made: out.calls, each: out.used.map((u) => ({ pass: "drift", ...u })), passes: [{ pass: "drift", files: [...seen], ok: Boolean(draft), calls: out.calls, ...(out.problem ? { problem: out.problem } : {}) }], files_sent: [...seen] };
    } else {
      // Adoption: bounded passes, each recorded.
      const out = await draftInPasses({ call: ask, files: cb.files, read, facts, repository: source.repository, commit: source.commit });
      draft = out.draft; draftProblem = out.problem; notSent = out.notSent;
      seen = new Set(out.filesSent);
      calls = { calls: "v1", ...who, made: out.calls, each: out.used, passes: out.passes, files_sent: out.filesSent };
      for (const m of draft?.missing ?? []) note(RECORDS, { wanted: `a usable answer for ${m.about}`, did: "wrote the rest of the record and marked that part as a gap", why: m.why });
    }
    if (!draft) note(RECORDS, { wanted: "a usable draft from the model", did: "wrote the parts read by rule and marked the drafted parts as gaps", why: draftProblem });
    else writeFileSync(join(RECORDS, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  }
  writeFileSync(join(RECORDS, "calls.json"), `${JSON.stringify(calls, null, 2)}\n`);

  // The original tests, carried byte for byte, and what they import from outside the codebase.
  const top = resolve(cb.dir);
  const bytesOf = (f) => {
    const full = resolve(top, f);
    if (!full.startsWith(top + sep)) return null;
    try { return lstatSync(full).isFile() ? readFileSync(full) : null; } catch { return null; }
  };
  const carried = carryTests({ files: cb.files, bytesOf, dir: cb.dir, prefix: cb.prefix ?? "", checkout: Boolean(cb.checkout), commit: cb.commit, repositoryRoot: args.repositoryRoot ?? "", inScope: drift ? (f) => drift.byNewFile.has(f) : () => true });

  // check-the-evidence and write-the-record
  const ctx = contextFor({ files: cb.files, read, ran: Boolean(baseline?.ran), previous });
  const built = buildRecord({ source, facts, draft, draftProblem: draftProblem || "no model was reached", sbom, baseline, notSent, seen, ctx, read, drift, previous, tool, carried });
  if (nothingToDraft) built.record.nothing_changed = true;
  const listed = fill(args.job, plan(built)).map((e) => e.name);
  const went = sentence(wentWithout(RECORDS));
  return {
    ok: true, code: 0,
    reply: replyText({ declined, source, record: built.record, drift, baseline, went, draftProblem }),
    declined: declined.map((x) => x.id),
    repository: source.repository,
    commit: source.commit,
    read_mode: built.record.read_mode,
    trigger: built.record.trigger,
    counts: built.record.counts,
    went_without: wentWithout(RECORDS),
    listed,
  };
}

const startedAsCommand = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (startedAsCommand()) {
  const out = await runJob(process.argv.slice(2)).catch((e) => ({
    ok: false, code: 1, reply: `No as-built record was written, and this is what stopped it: ${trim(e?.message ?? e)}`,
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.code ?? 0;
}
