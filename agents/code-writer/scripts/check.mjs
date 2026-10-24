// The check: whether the harness is done, and what it may not have touched.
//
// The harness runs this as often as it likes. Each run is one round, and
// each round is appended to the record so a reader afterwards sees how many
// it took and what failed on each. Done is four things, all mechanical: the
// suite passes; each script blanked in turn is noticed; the builder takes the
// package, when the builder is on this host; and the fence held, meaning no
// test, no spec line and no prototype file changed, and nothing was written
// outside scripts/ and the two record files. A blanked script the suite does
// not notice is recorded and said, not held against the harness, because
// fixing it means writing a test and that is not the harness's to do.
//
// Exit codes are the harness's instructions: 0 done, 1 not yet with each
// failing test named, 3 the fence was broken with what was touched named,
// 4 the rounds are used up.
//
//   needs: node >= 22; python3 and the builder, or it says the package-maker will build it
//   WORKSPACE=<folder> RECORDS=<records folder> [BUILDER=<path to the builder>] node check.mjs
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { listing, scriptsOf } from "./workspace.mjs";

const trim = (s) => String(s ?? "").trim();

/** How long one run of the suite may take. */
export const RUN_SECONDS = 120;

/** The builder, where the fleet keeps it. Not a declared setting: it belongs
 *  to no system, and the check says plainly when it is not there. */
export const BUILDER_DEFAULT = "/opt/fleet/agentbuilder-build.py";
export const builderAt = (env = {}) => trim(env.BUILDER) || BUILDER_DEFAULT;

/** The suite's files under a workspace, as paths the runner takes. */
export function suitePaths(dir) {
  const at = join(dir, "test");
  if (!existsSync(at)) return [];
  return readdirSync(at).filter((n) => n.endsWith(".test.mjs")).sort().map((n) => `test/${n}`);
}

/** What node's TAP reporter says at the end. */
export function tapSummary(output) {
  const n = (k) => { const m = new RegExp(`^# ${k} (\\d+)`, "m").exec(output); return m ? Number(m[1]) : 0; };
  return { tests: n("tests"), pass: n("pass"), fail: n("fail") + n("cancelled") };
}

/** Each failing test by name, as the harness needs it to know what to fix.
 *  Nested subtests are indented and their parent is listed too; the parent
 *  is dropped when a child already names the failure. */
export function tapFailures(output, max = 40) {
  const lines = String(output ?? "").split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const m = /^(\s*)not ok \d+ - (.+?)\s*(?:#.*)?$/.exec(raw);
    if (!m) continue;
    const name = trim(m[2]);
    if (!name || out.includes(name)) continue;
    out.push(name);
  }
  return out.slice(0, max);
}

/** Run the suite in a folder. `spawn` is handed in by tests. */
export function runSuite(dir, paths, { spawn = spawnSync } = {}) {
  // A child started from inside a node:test process inherits NODE_TEST_CONTEXT
  // and then refuses to run any file, so the suite runs in a clean environment.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
  const started = Date.now();
  const r = spawn("node", ["--test", "--test-reporter=tap", ...paths], { cwd: dir, env, encoding: "utf8", timeout: RUN_SECONDS * 1000 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const sum = tapSummary(out);
  const status = typeof r.status === "number" ? r.status : 1;
  const timedOut = !!r.error && /ETIMEDOUT|timed out/i.test(String(r.error?.code ?? r.error?.message ?? ""));
  return {
    ...sum, status,
    fails: status !== 0 || sum.fail > 0 || sum.tests === 0,
    timed_out: timedOut,
    failing: tapFailures(out),
    seconds: Math.round((Date.now() - started) / 100) / 10,
    tail: out.trim().slice(-2400),
  };
}

/** The fence: what changed that may not have. Compared against the record
 *  the workspace step wrote, by digest. */
export function fenceOf(record, dir) {
  const now = listing(dir, { skip: ["records"] });
  const was = record?.listing ?? {};
  const pinned = record?.digests ?? {};
  const broken = [];
  const free = (p) => p.startsWith("scripts/");
  for (const [p, d] of Object.entries(pinned)) {
    if (!(p in now)) broken.push({ path: p, what: "removed" });
    else if (now[p] !== d) broken.push({ path: p, what: "changed" });
  }
  for (const p of Object.keys(now)) {
    if (p in pinned || free(p)) continue;
    if (!(p in was)) broken.push({ path: p, what: "added" });
    else if (was[p] !== now[p]) broken.push({ path: p, what: "changed" });
  }
  for (const p of Object.keys(was)) {
    if (p in pinned || free(p) || p in now) continue;
    broken.push({ path: p, what: "removed" });
  }
  return { ok: !broken.length, broken };
}

/** A copy of the workspace to run in, without its records. */
function copyWorkspace(from, to) {
  const skip = resolve(from, "records");
  cpSync(from, to, { recursive: true, filter: (src) => { const r = resolve(src); return r !== skip && !r.startsWith(skip + "\\") && !r.startsWith(skip + "/"); } });
}

/** Each script blanked in turn: does the suite notice? */
export function blankRuns({ dir, scripts, paths, spawn } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "code-writer-blank-"));
  try {
    const out = [];
    for (const s of scripts) {
      const at = join(scratch, `without-${out.length}`);
      copyWorkspace(dir, at);
      const target = join(at, s);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "");
      const run = runSuite(at, paths, { spawn });
      out.push({ script: s, noticed: run.fails, tests: run.tests, pass: run.pass, fail: run.fail });
    }
    return out;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The builder over the workspace, into a scratch folder. `run` is handed in
 *  by tests. */
export function buildRun({ dir, builder, run = null, stoodIn = [] } = {}) {
  if (!builder || !existsSync(builder)) {
    return { checked: false, ok: null, said: "The builder is not on this host, so whether the package builds was not checked here; the package-maker builds it and refuses what does not." };
  }
  const scratch = mkdtempSync(join(tmpdir(), "code-writer-build-"));
  try {
    const go = run ?? ((args, opts) => spawnSync("python3", args, { encoding: "utf8", ...opts }));
    const r = go([builder, join(dir, "spec.json"), scratch], { timeout: RUN_SECONDS * 1000 });
    let doc = null;
    try { doc = JSON.parse(String(r.stdout ?? "")); } catch { doc = null; }
    if (doc && doc.ok === true) {
      // Never "builds" when something was stood in: what was checked is the
      // declaration and the scripts, and the reply says which files were empty.
      const said = stoodIn.length
        ? `The builder takes the declaration and the scripts, with ${stoodIn.length} file${stoodIn.length === 1 ? "" : "s"} the spec names stood in as empty (${stoodIn.join(", ")}); those are not this job's to write.`
        : "The builder takes the package.";
      return { checked: true, ok: true, said };
    }
    const why = trim(doc?.error ?? doc?.reason ?? r.stderr ?? r.stdout ?? "").split("\n").slice(-3).join(" ").slice(0, 400);
    return { checked: true, ok: false, said: `The builder refuses the package: ${why || "it gave no reason"}.` };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The words the record and the reply carry. */
export function verdict({ run = null, blanks = [], build = null, round = 0, roundsMax = 0, fence = null, stop = null } = {}) {
  if (stop === "ceiling") return `The rounds are used up: ${roundsMax} of ${roundsMax}, and the suite still fails${run ? ` (${run.fail} of ${run.tests})` : ""}. Nothing is delivered.`;
  if (stop === "fence") return `The fence was broken: ${(fence?.broken ?? []).map((b) => `${b.path} ${b.what}`).join(", ")}. Put it back; nothing is delivered until the check passes with the fence whole.`;
  const lines = [];
  if (run && run.fails) {
    lines.push(`Round ${round}${roundsMax ? ` of ${roundsMax}` : ""}: ${run.timed_out ? `the suite did not finish in ${RUN_SECONDS} seconds` : `${run.fail} of ${run.tests} fail`}.`);
    return lines.join(" ");
  }
  lines.push(`Round ${round}: the suite passes, ${run?.pass ?? 0} of ${run?.tests ?? 0}.`);
  const missed = blanks.filter((b) => !b.noticed).map((b) => b.script);
  if (blanks.length) {
    lines.push(missed.length
      ? `Blanked one at a time, the suite did not notice ${missed.join(", ")} going missing: nothing tests ${missed.length === 1 ? "it" : "them"}, which is the test-writer's to fix, not this job's.`
      : `Blanked one at a time, the suite noticed every one of the ${blanks.length}.`);
  }
  if (build) lines.push(build.said);
  return lines.join(" ");
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const env = process.env;
  const { WORKSPACE, RECORDS } = env;
  if (!WORKSPACE || !RECORDS) { console.error("WORKSPACE and RECORDS are required"); process.exit(2); }
  const recordPath = join(RECORDS, "workspace.json");
  if (!existsSync(recordPath)) { console.error(`no workspace record at ${recordPath}: run workspace.mjs first`); process.exit(2); }
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const runsPath = join(RECORDS, "runs.json");
    const runs = existsSync(runsPath) ? (JSON.parse(readFileSync(runsPath, "utf8")).runs ?? []) : [];
    const roundsMax = Number(record.rounds_max) || 30;
    const round = runs.length + 1;
    const writeVerdict = (v) => writeFileSync(join(RECORDS, "verdict.json"), JSON.stringify({ verdict: "v1", at: new Date().toISOString(), ...v }, null, 2) + "\n");
    if (round > roundsMax) {
      const said = verdict({ stop: "ceiling", roundsMax, run: runs[runs.length - 1] ?? null });
      writeVerdict({ done: false, stop: "ceiling", round: runs.length, said });
      console.log(said);
      process.exit(4);
    }
    const fence = fenceOf(record, WORKSPACE);
    if (!fence.ok) {
      const said = verdict({ stop: "fence", fence });
      writeVerdict({ done: false, stop: "fence", round: runs.length, broken: fence.broken, said });
      console.log(said);
      process.exit(3);
    }
    const spec = JSON.parse(readFileSync(join(WORKSPACE, "spec.json"), "utf8"));
    const paths = suitePaths(WORKSPACE);
    const run = runSuite(WORKSPACE, paths);
    runs.push({ round, at: new Date().toISOString(), tests: run.tests, pass: run.pass, fail: run.fail, failing: run.failing, seconds: run.seconds, timed_out: run.timed_out });
    writeFileSync(runsPath, JSON.stringify({ runs: "v1", rounds_max: roundsMax, runs }, null, 2) + "\n");
    if (run.fails) {
      const said = verdict({ run, round, roundsMax });
      writeVerdict({ done: false, stop: null, round, said, failing: run.failing });
      console.log(said);
      if (run.failing.length) console.log(run.failing.map((n) => `  not ok: ${n}`).join("\n"));
      // The runner's own output only when no test could be named: that is a
      // suite that did not load, and the error is the thing to read.
      else console.log(run.tail);
      process.exit(1);
    }
    const blanks = blankRuns({ dir: WORKSPACE, scripts: scriptsOf(spec), paths });
    const build = buildRun({ dir: WORKSPACE, builder: builderAt(env), stoodIn: record.stood_in ?? [] });
    if (build.checked && !build.ok) {
      const said = `${verdict({ run, round, blanks })} ${build.said}`;
      writeVerdict({ done: false, stop: null, round, said, blanks, build });
      console.log(said);
      process.exit(1);
    }
    const said = verdict({ run, round, blanks, build });
    writeVerdict({ done: true, round, tests: run.tests, blanks, unnoticed: blanks.filter((b) => !b.noticed).map((b) => b.script), build, said });
    console.log(`Done. ${said}`);
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
