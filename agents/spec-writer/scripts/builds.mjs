// Does the draft build? The builder answers, and its refusal is the check.
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
// claiming something nobody checked.
//
//   needs: node >= 22; python3 and the builder, or it says it could not check
//   DRAFT=<draft.json> RECORDS=<records folder> [BUILD_PY=<path>] node builds.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** Write the draft and an empty stand-in for every member it names. Returns
 *  what was stood in for, which is the caveat on everything that follows. */
export function standIn(dir, spec, io = {}) {
  const write = io.write ?? ((p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); });
  const named = namedFiles(spec);
  const climbing = named.filter(climbsOut);
  const placed = [];
  write(join(dir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
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

/** Run the builder over the draft in a folder of its own.
 *
 *  Returns `checked: false` when there is nothing to run it with, rather than
 *  a pass or a fail. A missing builder is not a spec that builds and it is not
 *  a spec that does not; it is a check that did not happen, and the reply says
 *  so in those words. */
export function checkBuilds({ spec, env = {}, io = {} } = {}) {
  const buildPy = buildPyAt(env);
  const exists = io.exists ?? existsSync;
  const run = io.run ?? ((args, opts) => spawnSync("python3", args, { encoding: "utf8", ...opts }));
  const mk = io.mkdtemp ?? (() => mkdtempSync(join(tmpdir(), "spec-writer-build-")));
  const drop = io.rm ?? ((d) => rmSync(d, { recursive: true, force: true }));

  if (!exists(buildPy)) {
    return {
      checked: false, ok: null, problems: [],
      why: `the builder is not at ${buildPy}, so nothing checked whether this spec builds. Everything else about the draft still stands, and this one thing is unknown rather than passed.`,
      stood_in_for: [],
    };
  }
  const dir = mk();
  try {
    const { placed, climbing } = standIn(dir, spec, io);
    if (climbing.length) {
      return {
        checked: true, ok: false, stood_in_for: [],
        problems: climbing.map((rel) => `the spec names ${rel}, which climbs out of the package folder; a member is a path inside the spec's own folder`),
      };
    }
    const r = run([buildPy, join(dir, "spec.json"), join(dir, "out")], {});
    const said = builderSaid(r.stdout, r.stderr, r.status);
    return { checked: true, ...said, stood_in_for: placed };
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
  if (result.ok) return `The builder takes this spec.${caveat}`;
  // The builder writes whole sentences and most of them end in a full stop.
  // Adding another produces "...and not the method).." which reads as a typo
  // in somebody else's words.
  const why = result.problems.join("; ");
  return `The builder refuses this spec: ${why}${/[.!?]$/.test(why) ? "" : "."}${caveat}`;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { DRAFT, RECORDS } = process.env;
  if (!DRAFT || !RECORDS) { console.error("DRAFT and RECORDS are required"); process.exit(2); }
  try {
    const spec = JSON.parse(readFileSync(DRAFT, "utf8"));
    const result = checkBuilds({ spec, env: process.env });
    mkdirSync(RECORDS, { recursive: true });
    writeFileSync(join(RECORDS, "builds.json"), JSON.stringify({ builds: "v1", ...result }, null, 2) + "\n");
    console.log(JSON.stringify({ ok: result.ok !== false, code: result.ok === false ? 1 : 0, verdict: verdict(result), problems: result.problems }));
    process.exitCode = result.ok === false ? 1 : 0;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}
