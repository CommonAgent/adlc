// The agent's own files, and whether they build. files.mjs writes them from
// the draft (agent-descriptor.json, agent-runtime-requirements.json,
// plugin.json and skills/<slug>/SKILL.md, the layout Common Agent 13.2 says a
// package is authored in), the same bytes the builder writes for the same
// draft, and they are what this agent hands on. Where the builder is on the
// host, it builds the folder they make, and its refusal is the check. Nothing
// here writes a spec.json: the draft is this agent's own working record, and
// the files are what anybody downstream reads.
//
// This is the only check here this agent does not control. check-spec.mjs is
// this agent's own opinion about its own draft, which is worth something and
// is not evidence. The builder is a program written by somebody else that
// refuses a spec for reasons of its own, and a draft it will not take is not
// a spec whatever anybody thinks of the prose. Where it is not on the host
// (this agent's own container carries node and nothing else), the files go
// unchecked and the reply says so, and the package maker builds them later
// and refuses what does not build.
//
// One honesty problem shapes the whole file. A drafted spec names scripts that
// nobody has written yet, and the builder copies every named member into the
// package before it validates a single declaration, so a folder with no files
// beside it fails at the copy and never reaches the checks that matter. So
// this stands in an empty file for each named member and says, every time,
// exactly which ones it stood in for. What comes back then proves the
// declaration and not the package, and the report says so in those words. A
// step that quietly created placeholders and reported "it builds" would be
// claiming something nobody checked. The stand-ins are never handed on: the
// files list the scripts by path, and whoever writes them delivers them.
//
// The name is the one other thing stood in, for the check alone. A draft
// whose name is still open is the usual first round, and the builder will
// not build an agent with no name, so it is checked under a name that says
// what it is, and the files kept carry no name at all: plugin.json has none,
// and each SKILL.md says it is part of an agent not named yet. The builder
// then refuses those files until the name is settled, which is the truth
// about them.
//
//   needs: node >= 22; python3 and the builder to check, or it says it could not
//   DRAFT=<draft.json> RECORDS=<records folder> [BUILD_PY=<path>] node builds.mjs
//   (the files go under <records folder>/agent/, and builds.json lists them
//   with their digests)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { NOT_NAMED, agentFilesOf } from "./files.mjs";
import { jobSecondsProblem } from "./job-seconds.mjs";
import { runReplyProblems } from "./run-reply.mjs";

const trim = (s) => String(s ?? "").trim();

/** Where the builder is, when nothing names it.
 *
 *  Its name on the host is agentbuilder-build.py, not build.py, which is what
 *  it is called in the repository. This defaulted to the repository's name
 *  until the package was put on the host and the file was not there, and the
 *  step would have reported "nothing checked whether this spec builds" on
 *  every job while looking like it was working.
 *
 *  BUILD_PY still moves it, and is deliberately NOT declared as a setting of
 *  any system. A setting has to hang off a system, the only system here is
 *  the reasoning service, and where a program sits on this host has nothing
 *  to do with that service. Declaring it put an irrelevant question on the
 *  owner's approval page, and on the page of every other agent sharing that
 *  credential. The host path is stable and the failure is loud, so nothing is
 *  lost by leaving it undeclared. */
export const BUILD_PY_DEFAULT = "/opt/fleet/agentbuilder-build.py";
export const buildPyAt = (env = {}) => trim(env.BUILD_PY) || BUILD_PY_DEFAULT;

/** Every file the spec names, across every job and every kind of member.
 *  Paths are as the spec wrote them, relative to where the spec sits. */
export function namedFiles(spec) {
  const out = [];
  for (const job of spec?.jobs ?? []) {
    for (const kind of ["scripts", "references", "assets"]) {
      for (const rel of job?.[kind] ?? []) if (typeof rel === "string" && rel) out.push(rel);
    }
    const ins = job?.instructions;
    if (ins && typeof ins === "object" && typeof ins.file === "string" && ins.file) out.push(ins.file);
  }
  return [...new Set(out)];
}

/** A path that would climb out of the folder the spec sits in. The builder
 *  normalises and copies by basename, so a member written as ../../etc/passwd
 *  would have this step create a file there. Refused before anything is
 *  written, and reported as a problem with the draft, which it is. */
export function climbsOut(rel) {
  const n = normalize(String(rel ?? "")).replace(/\\/g, "/");
  return n.startsWith("../") || n.startsWith("/") || /^[a-zA-Z]:/.test(n);
}


/** What the draft is called in the builder's folder when it is built as a
 *  draft (a container agent's, which makes no folder). The builder reads any
 *  file it is handed as a spec; nothing here writes a file called spec.json. */
export const DRAFT_FILE = "draft.json";

/** The name a draft whose name is still open is checked under. It is never
 *  handed on: the files carry no name, and each SKILL.md says it is part of
 *  an agent not named yet. */
export const STAND_IN_NAME = "agent-not-named-yet";
export const NAME_RE = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
export { NOT_NAMED };

/** The two kinds whose code is in its own repository: the builder checks
 *  their draft and makes no package of them. */
export const CONTAINER_KINDS = ["mesh-coded", "third-party-framework"];

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** Write the files under a folder, emptied first so a file from an earlier
 *  draft cannot ride along, and say what was written with each digest. */
export function keepFiles(dir, files, io = {}) {
  const write = io.write ?? ((p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); });
  const drop = io.rm ?? ((d) => rmSync(d, { recursive: true, force: true }));
  drop(dir);
  const list = [];
  for (const [rel, text] of Object.entries(files)) {
    write(join(dir, rel), text);
    list.push({ path: rel, sha256: sha256(Buffer.from(text)) });
  }
  return list;
}

/** Write an empty stand-in for every member the draft names, and what the
 *  builder reads beside them: the agent's own files, or (for a container
 *  agent's draft, which has none) the draft. Returns what was stood in for,
 *  which is the caveat on everything that follows. */
export function standIn(dir, spec, io = {}, files = null) {
  const write = io.write ?? ((p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); });
  const named = namedFiles(spec);
  const climbing = named.filter(climbsOut);
  const placed = [];
  if (files) for (const [rel, text] of Object.entries(files)) write(join(dir, rel), text);
  else write(join(dir, DRAFT_FILE), JSON.stringify(spec, null, 2) + "\n");
  for (const rel of named) {
    if (climbsOut(rel)) continue;
    // Empty, and empty on purpose. A stand-in with plausible content in it
    // would make a package that looks built and runs nothing.
    write(join(dir, rel), "");
    placed.push(rel);
  }
  return { placed, climbing };
}

/** What the builder said, as one sentence or a list of them. It answers with
 *  one JSON object either way, so a run that answers with something else is
 *  itself the finding. */
export function builderSaid(stdout, stderr, status) {
  const raw = trim(stdout);
  let doc = null;
  try { doc = JSON.parse(raw); } catch { doc = null; }
  if (doc && typeof doc === "object") {
    if (doc.ok === true) return { ok: true, said: doc, problems: [] };
    if (doc.ok === false) return { ok: false, said: doc, problems: [trim(doc.error) || "the builder refused and gave no reason"] };
  }
  const why = trim(stderr) || raw || `the builder exited ${status} and said nothing`;
  return { ok: false, said: null, problems: [`the builder did not answer with a result: ${why.slice(0, 400)}`] };
}

/** Write the agent's own files for the draft (files.mjs), keep them under
 *  `keep`, and run the builder over them in a folder of its own.
 *
 *  The files are what is delivered. Where the builder is on the host it is
 *  the check: it builds the folder those files make, with empty stand-ins for
 *  every script the draft names, and a draft it refuses keeps no files,
 *  because a declaration nothing can build is not handed on as though it
 *  were one. Where it is not, the files are kept unchecked, and the reply
 *  says nothing checked them rather than that they passed: the package maker
 *  builds them and refuses what does not build.
 *
 *  A container agent's draft has no files (its code is in its own
 *  repository, and the builder makes no package of it): it is checked as a
 *  draft, and marked `container`. */
export function checkBuilds({ spec, env = {}, io = {}, keep = null } = {}) {
  const buildPy = buildPyAt(env);
  const exists = io.exists ?? existsSync;
  const run = io.run ?? ((args, opts) => spawnSync("python3", args, { encoding: "utf8", ...opts }));
  const mk = io.mkdtemp ?? (() => mkdtempSync(join(tmpdir(), "spec-writer-build-")));
  const drop = io.rm ?? ((d) => rmSync(d, { recursive: true, force: true }));
  const container = CONTAINER_KINDS.includes(spec?.kind);
  const named = NAME_RE.test(trim(spec?.name));
  // A draft so malformed it cannot be written as files at all is refused,
  // in the builder's own words where the builder is here to say them.
  let files = null;
  let unwritable = null;
  if (!container) {
    try { files = agentFilesOf(spec ?? {}); } catch (e) { unwritable = `the draft could not be written as the agent's files: ${trim(e?.message) || "it is not the shape a draft has"}`; }
  }
  const kept = () => (keep && files ? { files: { list: keepFiles(keep, files, io) } } : {});
  if (unwritable && !exists(buildPy)) return { checked: true, ok: false, problems: [unwritable], stood_in_for: [] };

  if (!exists(buildPy)) {
    // The one refusal of the package maker's this agent knows for certain
    // without it: a job_seconds outside its range (build.py's JOB_SECONDS_MIN
    // and JOB_SECONDS_MAX). Said here, in its words, and no files kept, so a
    // spec that would stop at Package stops before the person approves it
    // (technical debt 648).
    // And a job's run.reply outside the package maker's rule (build.py's
    // RUN_REPLY_STDOUT and RUN_REPLY_MEMBER, technical debt 652).
    const known = [jobSecondsProblem(spec), ...runReplyProblems(spec)].filter(Boolean);
    if (known.length) return { checked: false, ok: false, problems: known, stood_in_for: [], ...(container ? { container: true } : {}) };
    return {
      checked: false, ok: null, problems: [],
      why: `the builder is not at ${buildPy}, so nothing checked whether this draft builds. Everything else about the draft still stands, and this one thing is unknown rather than passed.`,
      stood_in_for: [],
      ...(container ? { container: true } : {}),
      ...(named || container ? {} : { name_open: true }),
      ...kept(),
    };
  }
  // The check builds under a stand-in name when the name is open; the files
  // kept carry none.
  const checked = named || container ? spec : { ...spec, name: STAND_IN_NAME };
  const asDraft = container || unwritable;
  const checkFiles = asDraft ? null : (named ? files : agentFilesOf(checked));
  const dir = mk();
  try {
    const { placed, climbing } = standIn(dir, checked, io, checkFiles);
    if (climbing.length) {
      return {
        checked: true, ok: false, stood_in_for: [],
        problems: climbing.map((rel) => `the spec names ${rel}, which climbs out of the package folder; a member is a path inside the spec's own folder`),
      };
    }
    const r = run([buildPy, asDraft ? join(dir, DRAFT_FILE) : dir, join(dir, "out")], {});
    const said = builderSaid(r.stdout, r.stderr, r.status);
    if (unwritable) {
      return { checked: true, ok: false, stood_in_for: placed,
        problems: said.ok ? [unwritable] : said.problems };
    }
    return {
      checked: true, ...said, stood_in_for: placed,
      ...(container ? { container: true } : {}),
      ...(named || container ? {} : { name_stood_in: true }),
      ...(said.ok ? kept() : {}),
    };
  } finally {
    try { drop(dir); } catch { /* a temp folder that will not go is not the caller's problem */ }
  }
}

/** The sentence that goes in the reply. It never says "it builds" without the
 *  caveat, because with stand-ins in place that is not what was checked. */
export function verdict(result) {
  if (!result.checked) return result.why;
  const n = result.stood_in_for.length;
  const caveat = n
    ? ` This checked the declaration and not the package: ${n} file${n === 1 ? " it names does" : "s it names do"} not exist yet, and ${n === 1 ? "an empty one was" : "empty ones were"} stood in so the builder could read the rest.`
    : "";
  const name = result.name_stood_in
    ? " The name is still open, so it was checked under a stand-in name, and the files carry no name until it is settled."
    : "";
  if (result.ok) return `The builder takes this draft.${caveat}${name}`;
  // The builder writes whole sentences and most of them end in a full stop.
  // Adding another produces "...and not the method).." which reads as a typo
  // in somebody else's words.
  const why = result.problems.join("; ");
  return `The builder refuses this draft: ${why}${/[.!?]$/.test(why) ? "" : "."}${caveat}`;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { DRAFT, RECORDS } = process.env;
  if (!DRAFT || !RECORDS) { console.error("DRAFT and RECORDS are required"); process.exit(2); }
  try {
    const spec = JSON.parse(readFileSync(DRAFT, "utf8"));
    mkdirSync(RECORDS, { recursive: true });
    // Files from an earlier round of this job never stand for this draft.
    rmSync(join(RECORDS, "agent"), { recursive: true, force: true });
    const result = checkBuilds({ spec, env: process.env, keep: join(RECORDS, "agent") });
    writeFileSync(join(RECORDS, "builds.json"), JSON.stringify({ builds: "v1", ...result }, null, 2) + "\n");
    console.log(JSON.stringify({ ok: result.ok !== false, code: result.ok === false ? 1 : 0, verdict: verdict(result), problems: result.problems,
      files: (result.files?.list ?? []).map((f) => f.path) }));
    process.exitCode = result.ok === false ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}
