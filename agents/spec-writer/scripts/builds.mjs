// Does the draft build? The builder answers, and its refusal is the check.
// And when it does, the builder's own output is what this agent hands on: the
// agent's own files, the layout Common Agent 13.2 says a package is authored
// in (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and
// skills/<slug>/SKILL.md), taken from what it built, so the files say exactly
// what the builder would have written and building them makes the same
// package. Nothing here writes a spec.json: the draft is this agent's own
// working record, and the files are what anybody downstream reads.
//
// This is the only check here this agent does not control. check-spec.mjs is
// this agent's own opinion about its own draft, which is worth something and
// is not evidence. The builder is a program written by somebody else that
// refuses a spec for reasons of its own, and a draft it will not take is not
// a spec whatever anybody thinks of the prose.
//
// One honesty problem shapes the whole file. A drafted spec names scripts that
// nobody has written yet, and the builder copies every named member into the
// package before it validates a single declaration, so a spec with no files
// beside it fails at the copy and never reaches the checks that matter. So
// this stands in an empty file for each named member and says, every time,
// exactly which ones it stood in for. What comes back then proves the
// declaration and not the package, and the report says so in those words. A
// step that quietly created placeholders and reported "it builds" would be
// claiming something nobody checked. The stand-ins are never handed on: the
// files list the scripts by path, and whoever writes them delivers them.
//
// The name is the one other thing stood in. A draft whose name is still open
// is the usual first round, and the builder will not build an agent with no
// name, so it is built under a name that says what it is, and the files that
// come back carry no name at all: plugin.json has none, and each SKILL.md
// says it is part of an agent not named yet. The builder then refuses those
// files until the name is settled, which is the truth about them.
//
//   needs: node >= 22; python3 and the builder, or it says it could not check
//   DRAFT=<draft.json> RECORDS=<records folder> [BUILD_PY=<path>] node builds.mjs
//   (the files go under <records folder>/agent/, and builds.json lists them
//   with their digests)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";

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


/** What the draft is called in the builder's folder. The builder reads any
 *  file it is handed as a spec; this one is the draft, and nothing here
 *  writes a file called spec.json. */
export const DRAFT_FILE = "draft.json";

/** The name a draft whose name is still open is built under. It is never
 *  handed on: the files come back with no name in them. */
export const STAND_IN_NAME = "agent-not-named-yet";
export const NAME_RE = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
export const NOT_NAMED = "an agent not named yet";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const EXT = "net.agentdoc.package";
/** The files an agent is authored in, as the builder names them. */
export const AUTHORED = ["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json"];

/** The agent's own files, from a package the builder made of the draft: the
 *  two authored files as built, plugin.json less what the build writes into
 *  it and with the builder's own entry (the files each skill carries, by the
 *  path the draft names them), and each skill's SKILL.md. The same files
 *  adlc's convert.py writes from a spec. `named` is false when the draft was
 *  built under STAND_IN_NAME, and then no name is carried. Returns
 *  {rel: text}, in the order they are listed. */
export function agentFiles(spec, pkg, { named = true, read = (p) => readFileSync(p, "utf8") } = {}) {
  const files = {};
  for (const n of AUTHORED.slice(0, 2)) files[n] = read(join(pkg, n));
  const manifest = JSON.parse(read(join(pkg, "plugin.json")));
  const own = { ...(manifest.extensions?.[EXT] ?? {}) };
  for (const k of ["descriptor", "runtime_requirements", "install", "built", "draft"]) delete own[k];
  const jobs = (spec?.jobs ?? []).filter((j) => j && typeof j === "object");
  const build = {};
  for (const k of ["kind", "container", "claims"]) if (k in (spec ?? {})) build[k] = spec[k];
  build.skills = Object.fromEntries(jobs.map((j) => [j.slug, Object.fromEntries(
    ["scripts", "references", "assets"].filter((k) => Array.isArray(j[k]) && j[k].length).map((k) => [k, [...j[k]]]))]));
  manifest.extensions = { ...(manifest.extensions ?? {}), [EXT]: { ...own, build } };
  if (!named) delete manifest.name;
  files["plugin.json"] = JSON.stringify(manifest, null, 2) + "\n";
  for (const j of jobs) {
    let md = read(join(pkg, "skills", j.slug, "SKILL.md"));
    if (!named) md = md.replace(`Part of ${STAND_IN_NAME}.`, `Part of ${NOT_NAMED}.`);
    files[`skills/${j.slug}/SKILL.md`] = md;
  }
  return files;
}

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

/** Write the draft and an empty stand-in for every member it names. Returns
 *  what was stood in for, which is the caveat on everything that follows. */
export function standIn(dir, spec, io = {}) {
  const write = io.write ?? ((p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); });
  const named = namedFiles(spec);
  const climbing = named.filter(climbsOut);
  const placed = [];
  write(join(dir, DRAFT_FILE), JSON.stringify(spec, null, 2) + "\n");
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

/** Run the builder over the draft in a folder of its own, and keep the
 *  agent's files from what it built under `keep` when it builds.
 *
 *  Returns `checked: false` when there is nothing to run it with, rather than
 *  a pass or a fail. A missing builder is not a spec that builds and it is not
 *  a spec that does not; it is a check that did not happen, and the reply says
 *  so in those words. */
export function checkBuilds({ spec, env = {}, io = {}, keep = null } = {}) {
  const buildPy = buildPyAt(env);
  const exists = io.exists ?? existsSync;
  const run = io.run ?? ((args, opts) => spawnSync("python3", args, { encoding: "utf8", ...opts }));
  const mk = io.mkdtemp ?? (() => mkdtempSync(join(tmpdir(), "spec-writer-build-")));
  const drop = io.rm ?? ((d) => rmSync(d, { recursive: true, force: true }));

  if (!exists(buildPy)) {
    return {
      checked: false, ok: null, problems: [],
      why: `the builder is not at ${buildPy}, so nothing checked whether this draft builds, and no files were made from it. Everything else about the draft still stands, and this one thing is unknown rather than passed.`,
      stood_in_for: [],
    };
  }
  const named = NAME_RE.test(trim(spec?.name));
  const built = named ? spec : { ...spec, name: STAND_IN_NAME };
  const dir = mk();
  try {
    const { placed, climbing } = standIn(dir, built, io);
    if (climbing.length) {
      return {
        checked: true, ok: false, stood_in_for: [],
        problems: climbing.map((rel) => `the spec names ${rel}, which climbs out of the package folder; a member is a path inside the spec's own folder`),
      };
    }
    const r = run([buildPy, join(dir, DRAFT_FILE), join(dir, "out")], {});
    const said = builderSaid(r.stdout, r.stderr, r.status);
    const result = { checked: true, ...said, stood_in_for: placed, ...(named ? {} : { name_stood_in: true }) };
    // The files are taken only from a package the builder made. A container
    // agent's draft is checked and makes none (its code is in its own
    // repository), so there is nothing to take, and the reply says so.
    if (said.ok && keep && said.said?.path) {
      result.files = { list: keepFiles(keep, agentFiles(built, said.said.path, { named, ...(io.read ? { read: io.read } : {}) }), io) };
    }
    return result;
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
    ? " The name is still open, so it was built under a stand-in name, and the files carry no name until it is settled."
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
    const result = checkBuilds({ spec, env: process.env, keep: join(RECORDS, "agent") });
    // Files from an earlier round of this job never stand for this draft.
    if (!result.files) rmSync(join(RECORDS, "agent"), { recursive: true, force: true });
    writeFileSync(join(RECORDS, "builds.json"), JSON.stringify({ builds: "v1", ...result }, null, 2) + "\n");
    console.log(JSON.stringify({ ok: result.ok !== false, code: result.ok === false ? 1 : 0, verdict: verdict(result), problems: result.problems,
      files: (result.files?.list ?? []).map((f) => f.path) }));
    process.exitCode = result.ok === false ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}
