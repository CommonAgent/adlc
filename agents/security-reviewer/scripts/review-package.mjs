// Review a package: one command, four steps, one judgment that never decides.
//   needs: node >= 22
//   node review-package.mjs --job <job folder> --records <records folder>
//        --work <work folder> --text-file <message> [--file <path>[::<media type>]]...
//        [--package <folder or .tar.gz>] [--architecture <record.md>]
//
// This is the command the runtime requirements start (run.review-a-package).
// The package is attached: one .tar.gz the package maker built, or the
// package's own files one by one. The architecture record, when there is one,
// is attached beside it (a Markdown file whose name or first heading says it
// is the architecture record). The owner's spending limit is a line of the
// message of its own:
//
//   spending limit: 5 USD per day
//
// or the architecture record's limits say it. --package and --architecture
// name them on disk instead, for running it by hand.
//
// The steps, in order: read the package (read-package.mjs), trace the
// programs (trace-programs.mjs), weigh the reasons (weigh.mjs, the one that
// may wake a model, and which changes no verdict), and write the review
// (assess.mjs and write-review.mjs). It grants nothing, binds no credential,
// installs nothing and changes nothing in the package.
//
// It prints one JSON object with a `reply` field. Exit codes: 0 reviewed (a
// refusal is a review too, and is delivered); 2 usage; 3 there was nothing to
// review and the reply says what is needed; 1 failed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromFiles, gather, readFolder } from "./read-package.mjs";
import { isGzip } from "./tar.mjs";
import { matchReaches, tracePrograms } from "./trace-programs.mjs";
import { readArchitecture, spendingLimit } from "./architecture.mjs";
import { assess } from "./assess.mjs";
import { credentialsIn, deepScrub, scrub } from "./secrets.mjs";
import { weigh } from "./weigh.mjs";
import { reviewMarkdown } from "./write-review.mjs";
import { note, read as wentWithout, sentence } from "./went-without.mjs";
import { fill, plan as piecesPlan } from "./pieces.mjs";

const trim = (s) => String(s ?? "").trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");

export function fromArgv(args = []) {
  const parsed = { files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--job") parsed.job = args[++i];
    else if (a === "--records") parsed.records = args[++i];
    else if (a === "--work") parsed.work = args[++i];
    else if (a === "--text-file") parsed.textFile = args[++i];
    else if (a === "--package") parsed.package = args[++i];
    else if (a === "--architecture") parsed.architecture = args[++i];
    else if (a === "--file") {
      const v = String(args[++i] ?? "");
      const at = v.lastIndexOf("::");
      parsed.files.push(at === -1 ? { path: v, declared: "" } : { path: v.slice(0, at), declared: v.slice(at + 2) });
    }
  }
  return parsed;
}

/** An architecture record among the attached files: Markdown whose name says
 *  it is the architecture record, or whose first heading does. A package's
 *  own ARCHITECTURE.md is not one: the record is the solution architect's,
 *  handed over beside the package, and a package must not bring its own
 *  egress or spending limit to its own review. So a file inside an archive is
 *  never taken for it, and a loose file only when it says it is the record. */
export function isArchitectureRecord(name, text) {
  if (!/\.(?:md|markdown)$/i.test(name)) return false;
  if (/^architecture[-_ ]record/i.test(name)) return true;
  const first = /^#\s+(.+)$/m.exec(String(text ?? ""))?.[1] ?? "";
  return /\barchitecture record\b/i.test(first);
}

/** Asked to grant, bind, place or install: this agent does none of them. */
export const ASKED_TO_ACT = /\b(?:bind|place|install|deploy|grant|give|attach|set up|provision)\b[^.\n]{0,60}\b(?:credential|key|secret|token|access|permission|package|agent)s?\b/i;
export const DECLINE = "You asked me to bind, place, grant or install something. I do not: a security review is made before any credential is bound and before the agent is installed, and it grants nothing. Binding the credentials is the deployment manager's act, on the owner's instruction, after this review.";

export { scrub };

/** Sort the attached files: the architecture record, and the package's files. */
export function sortGiven(files = []) {
  const package_ = [];
  let architecture = null;
  const read = files.map((f) => { try { return readFileSync(f.path); } catch { return null; } });
  // The record is taken only beside a package that came as an archive: when
  // the package's own files are handed over one by one, none of them can be
  // told from a record the architect wrote, and a package must not bring its
  // own egress or spending limit. The record then goes by --architecture.
  const archived = read.some((b) => b && (isGzip(b) || (b.length >= 512 && b.subarray(257, 262).toString() === "ustar")));
  files.forEach((f, i) => {
    const bytes = read[i];
    const name = basename(f.path);
    if (archived && bytes && !architecture && isArchitectureRecord(name, bytes.toString("utf8"))) { architecture = { path: f.path, name, text: bytes.toString("utf8") }; return; }
    package_.push(f);
  });
  return { package: package_, architecture };
}

const many = (n, word) => `${n} ${n === 1 ? word : /(?:ch|sh|s|x)$/.test(word) ? `${word}es` : `${word}s`}`;

/** The reply, in words. */
export function replyText({ pkg, a, asked, went, weighed }) {
  const L = [];
  if (asked) L.push(DECLINE);
  const who = `${pkg.name || "The package"}${pkg.version ? ` ${pkg.version}` : ""}`;
  if (a.verdict === "passed") L.push(`I reviewed ${who} and it passes: ${many(a.reaches.length, "reach")}, ${many(a.spends.length, "spend ceiling")} and ${many(a.neverDos.length, "never-do")}, each with its reason.`);
  else L.push(`I reviewed ${who} and it does not pass. What stopped it: ${a.refusals.join("; ")}.`);
  if (a.unreasoned.length) L.push(`${many(a.unreasoned.length, "permission")} ${a.unreasoned.length === 1 ? "has" : "have"} no recorded reason and ${a.unreasoned.length === 1 ? "is" : "are"} flagged in the review.`);
  if (a.accepted.length) L.push(`${many(a.accepted.length, "thing")} it lets through ${a.accepted.length === 1 ? "is" : "are"} listed as accepted knowingly.`);
  if (went) L.push(went);
  if (!weighed) L.push("No model weighed the reasons; the review lists them as the package states them.");
  L.push("The review is filed with the job. It grants nothing and changed nothing in the package.");
  return L.join(" ");
}

/** The job, as the runtime requirements start it. */
export async function runJob(argv = [], env = process.env, { ask } = {}) {
  const args = fromArgv(argv);
  if (!args.job || !args.records) return { ok: false, code: 2, reply: "This job needs --job <job folder> and --records <records folder>." };
  const message = args.textFile && existsSync(args.textFile) ? readFileSync(args.textFile, "utf8") : "";
  const id = basename(args.job);
  const RECORDS = join(args.records, id);
  mkdirSync(RECORDS, { recursive: true });
  rmSync(join(RECORDS, "went-without.json"), { force: true });

  // ── read the package ──
  const sorted = sortGiven(args.files);
  let got;
  if (args.package) {
    const st = existsSync(args.package) ? statSync(args.package) : null;
    got = st?.isDirectory() ? { ...readFolder(args.package), digest: "", source: basename(args.package), outside: [], problems: [], others: [] } : gather([{ path: args.package }]);
  } else got = gather(sorted.package);
  const archText = args.architecture && existsSync(args.architecture) ? readFileSync(args.architecture, "utf8") : sorted.architecture?.text ?? "";
  // Everything read from the package is scrubbed before it is written down,
  // assessed or put to the model: a credential it carries is found in the
  // files themselves (credentialsIn) and never repeated.
  const declared = deepScrub(fromFiles(got.files));
  const asked = ASKED_TO_ACT.test(message);
  writeFileSync(join(RECORDS, "asked.json"), JSON.stringify({
    message: scrub(message), message_sha256: sha(message),
    given: args.files.map((f) => ({ name: basename(f.path), declared: f.declared })),
    package: { source: got.source, digest: got.digest, files: got.files.size },
    architecture_record: archText ? { name: sorted.architecture?.name ?? basename(args.architecture ?? ""), sha256: sha(archText) } : null,
    asked_to_act: asked,
  }, null, 2) + "\n");

  if (!got.files.size || (!declared.found.descriptor && !declared.found.requirements)) {
    const problems = [...got.problems, ...declared.problems];
    const why = problems.length ? ` ${problems.join("; ")}.` : "";
    return { ok: false, code: 3, reply: `${asked ? `${DECLINE} ` : ""}There is no package here to review: I need the Agent Package, as the .tar.gz the package maker built or as its own files (agent-descriptor.json and agent-runtime-requirements.json, with plugin.json and the scripts), attached to the message.${why} Attach the architecture record beside it if there is one, and say the owner's spending limit as a line \`spending limit: <amount> per <day|month|job>\`.` };
  }
  writeFileSync(join(RECORDS, "declared.json"), JSON.stringify(declared, null, 2) + "\n");
  for (const p of got.problems) note(RECORDS, { wanted: "part of what was handed over", did: "reviewed the package from the rest", why: p });

  // ── trace the programs ──
  const arch = readArchitecture(archText);
  const { traced, tests } = deepScrub(tracePrograms(got.files, declared.programs));
  const matched = matchReaches({ traced, systems: declared.systems, binaries: declared.binaries, egressHosts: arch.egress.hosts });
  writeFileSync(join(RECORDS, "traced.json"), JSON.stringify({ traced, tests, ...matched }, null, 2) + "\n");
  if (!arch.given) note(RECORDS, { wanted: "the architecture record", did: "reviewed the package against its own declaration alone, so nothing checks its systems against what the agent was designed to reach" });

  // ── assess ──
  const limit = spendingLimit(message, arch);
  const credentials = credentialsIn(got.files);
  const a = assess({ declared, traced: matched, arch, limit, found: { credentials, links: got.links, climbing: got.climbing, outside: got.outside ?? [], bundled: declared.bundled } });

  // ── weigh the reasons (never changes the verdict) ──
  const pkg = { name: declared.name, version: declared.version, digest: got.digest };
  const w = await weigh({ a, pkg, does: declared.does, env, ...(ask ? { ask } : {}) });
  if (w.skipped) note(RECORDS, { wanted: "a model to weigh the reasons", did: "listed every reason as the package states it, with no judgment of whether it accounts for its access", why: w.skipped });

  // ── write the review ──
  const reviewedAt = new Date().toISOString();
  const md = reviewMarkdown({ pkg, a, traced: { traced, tests, ...matched }, weighed: w.weighed ?? null, reviewedAt });
  const reviewPath = join(RECORDS, "security-review.md");
  writeFileSync(reviewPath, md);
  writeFileSync(join(RECORDS, "assessment.json"), JSON.stringify({ verdict: a.verdict, refusals: a.refusals, unreasoned: a.unreasoned, reaches: a.reaches, spends: a.spends, never_does: a.neverDos, accepted: a.accepted, notes: a.notes, weighed: w.weighed ?? null, skipped: w.skipped ?? null, reviewed_at: reviewedAt }, null, 2) + "\n");
  appendIndex(args.records, { job: id, package: pkg.name, version: pkg.version, digest: pkg.digest, verdict: a.verdict, reviewed_at: reviewedAt });
  const listed = fill(args.job, piecesPlan({ reviewPath })).map((e) => e.name);

  const went = sentence(wentWithout(RECORDS));
  return {
    ok: true, code: 0,
    reply: replyText({ pkg, a, asked, went, weighed: w.weighed }),
    verdict: a.verdict, package: pkg, refused_for: a.refusals,
    reaches: a.reaches.length, spends: a.spends.length, never_does: a.neverDos.length, unreasoned: a.unreasoned.length,
    went_without: wentWithout(RECORDS), listed,
  };
}

/** The standing index of every review this agent has made. A failure here is
 *  said on stderr, never thrown: the job's own record is already written. */
function appendIndex(records, row) {
  const p = join(records, "reviews.json");
  try {
    const rows = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
    rows.push(row);
    writeFileSync(p, JSON.stringify(rows, null, 2) + "\n");
  } catch (e) { process.stderr.write(`the review could not be added to ${p}: ${e?.message ?? e}\n`); }
}

const startedAsCommand = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (startedAsCommand()) {
  const out = await runJob(process.argv.slice(2)).catch((e) => ({
    ok: false, code: 1, reply: `No review was made, and this is what stopped it: ${trim(e?.message ?? e)}`,
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.code ?? 0;
}
