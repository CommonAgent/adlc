// Check the suite by running it: against nothing, and against something.
//
// Against nothing: every script the spec names is stood in by an empty file
// and the suite is run over them. It must fail. A suite that passes with every
// function absent has asserted nothing, and this is the check that catches a
// suite of comments.
//
// Against a package: the suite is run over the real scripts and must pass.
// Then each script is blanked in turn and the suite run again, and a script
// whose absence the suite never notices is named. That is the whole check on
// a suite, and it is mechanical: nothing here judges whether a test is good,
// only whether the suite notices when the thing it is for is gone.
//
// Nothing here edits a test. A failure against the real scripts belongs to
// whoever owns the scripts, and the verdict says so.
//
//   needs: node >= 22
//   SUITE=<folder holding test/*.test.mjs> SPEC=<spec.json> RECORDS=<records folder>
//   [AGAINST=<package folder with scripts/>] node check-suite.mjs
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const trim = (s) => String(s ?? "").trim();

/** How long one run of a suite may take. A written suite that hangs is a
 *  finding, not a wait. */
export const RUN_SECONDS = 120;

/** Every script the spec names, once, in the order named. */
export function scriptsOf(spec) {
  return [...new Set((spec?.jobs ?? []).flatMap((j) => j?.scripts ?? []).map(trim).filter(Boolean))];
}

/** A path that stays inside the folder it is placed in. A spec that names
 *  "../x.mjs" or "/etc/x" is refused before anything is written, because a
 *  stand-in is an empty file put wherever the spec says. */
export function staysInside(rel) {
  const p = trim(rel).replace(/\\/g, "/");
  if (!p || isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return false;
  const n = normalize(p).replace(/\\/g, "/");
  return !(n === ".." || n.startsWith("../"));
}

/** Put an empty file where every script the spec names would be, and the
 *  spec beside them. Returns what was stood in. */
export function standInPackage(spec, dir) {
  const scripts = scriptsOf(spec);
  for (const s of scripts) {
    if (!staysInside(s)) throw new Error(`the spec names a script outside the package: ${s}`);
  }
  mkdirSync(dir, { recursive: true });
  for (const s of scripts) {
    const at = join(dir, s);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, "");
  }
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
  return scripts;
}

/** Write the suite's files under a package folder. Each is test/<name>. */
export function placeSuite(files, dir) {
  const placed = [];
  for (const f of files) {
    if (!staysInside(f.path) || !/^test\/[^/]+\.test\.mjs$/.test(f.path.replace(/\\/g, "/"))) {
      throw new Error(`a suite file must be test/<name>.test.mjs, not ${f.path}`);
    }
    const at = join(dir, f.path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, f.text);
    placed.push(f.path);
  }
  return placed;
}

/** The suite files under a folder: test/*.test.mjs, as {path, text}. */
export function suiteFiles(dir) {
  const at = join(dir, "test");
  if (!existsSync(at)) return [];
  return readdirSync(at).filter((n) => n.endsWith(".test.mjs")).sort()
    .map((n) => ({ path: `test/${n}`, text: readFileSync(join(at, n), "utf8") }));
}

/** What node's TAP reporter says at the end: tests, pass, fail. Read from
 *  the summary lines so a suite that crashed before printing any test still
 *  counts as a run that failed. */
export function tapSummary(output) {
  const n = (k) => { const m = new RegExp(`^# ${k} (\\d+)`, "m").exec(output); return m ? Number(m[1]) : 0; };
  return { tests: n("tests"), pass: n("pass"), fail: n("fail") + n("cancelled") };
}

/** Run the suite in a folder. `spawn` is handed in by tests. */
export function runSuite(dir, paths, { spawn = spawnSync } = {}) {
  // A child started from inside a node:test process inherits NODE_TEST_CONTEXT
  // and then refuses to run any file, so the suite is run in an environment
  // that carries no trace of the parent's runner.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
  const r = spawn("node", ["--test", "--test-reporter=tap", ...paths], {
    cwd: dir, env, encoding: "utf8", timeout: RUN_SECONDS * 1000,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const sum = tapSummary(out);
  const status = typeof r.status === "number" ? r.status : 1;
  return {
    ...sum, status,
    // A run with nothing counted and a bad status is a suite that did not
    // load, which is a failure of the suite and is said as one.
    fails: status !== 0 || sum.fail > 0 || sum.tests === 0,
    timed_out: !!r.error && /ETIMEDOUT|timed out/i.test(String(r.error?.code ?? r.error?.message ?? "")),
    tail: out.trim().slice(-2000),
  };
}

/** The suite against empty stand-ins. Pure apart from the scratch folder,
 *  which is made and removed here. */
export function standInRun({ spec, files, spawn } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "test-writer-standins-"));
  try {
    const scripts = standInPackage(spec, scratch);
    const paths = placeSuite(files, scratch);
    const run = runSuite(scratch, paths, { spawn });
    return { against: "stand-ins", scripts: scripts.length, files: paths.length, ...run };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A copy of a package for the suite to run in: everything but its own
 *  test folder, which is the suite being replaced. */
export function copyPackage(from, to) {
  const skip = resolve(from, "test");
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const r = resolve(src);
      return r !== skip && !r.startsWith(skip + "\\") && !r.startsWith(skip + "/") && !/node_modules|\.git$/.test(basename(r));
    },
  });
}

/** The suite against a package's own scripts, then against that package with
 *  each script blanked in turn. */
export function provingRuns({ spec, files, realDir, spawn } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "test-writer-prove-"));
  try {
    const whole = join(scratch, "whole");
    copyPackage(realDir, whole);
    const paths = placeSuite(files, whole);
    const real = { against: basename(realDir), ...runSuite(whole, paths, { spawn }) };
    const mutations = [];
    for (const s of scriptsOf(spec)) {
      const dir = join(scratch, `without-${mutations.length}`);
      copyPackage(realDir, dir);
      placeSuite(files, dir);
      if (!staysInside(s)) throw new Error(`the spec names a script outside the package: ${s}`);
      const at = join(dir, s);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, "");
      const run = runSuite(dir, paths, { spawn });
      mutations.push({ script: s, noticed: run.fails, tests: run.tests, pass: run.pass, fail: run.fail });
    }
    return { real, mutations };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The verdict in words. The reply carries it as written. */
export function verdict({ standIns = null, real = null, mutations = [] } = {}) {
  const lines = [];
  if (standIns) {
    const k = standIns.scripts;
    if (standIns.timed_out) {
      lines.push(`Against empty stand-ins for the ${k} script${k === 1 ? "" : "s"} it names, the suite did not finish in ${RUN_SECONDS} seconds, which is a fault in the suite.`);
    } else if (standIns.fails) {
      lines.push(`Against empty stand-ins for the ${k} script${k === 1 ? "" : "s"} it names, the suite fails (${standIns.pass} of ${standIns.tests} pass), which is what a suite written before the scripts must do.`);
    } else {
      lines.push(`Against empty stand-ins for the ${k} script${k === 1 ? "" : "s"} it names, the suite passes (${standIns.pass} of ${standIns.tests}), so it asserts nothing about them. It is not a suite yet.`);
    }
  }
  if (real) {
    if (real.timed_out) lines.push(`Against ${real.against}'s own scripts the suite did not finish in ${RUN_SECONDS} seconds.`);
    else if (!real.fails) lines.push(`Against ${real.against}'s own scripts, all ${real.tests} pass.`);
    else lines.push(`Against ${real.against}'s own scripts, ${real.fail} of ${real.tests} fail. The failures are the script owner's to read; nothing here changed a test to make them pass.`);
  }
  if (mutations.length) {
    const missed = mutations.filter((m) => !m.noticed).map((m) => m.script);
    if (!missed.length) lines.push(`Broken one script at a time, the suite noticed every one of the ${mutations.length}.`);
    else lines.push(`Broken one script at a time, the suite did not notice ${missed.join(", ")} going missing: nothing tests ${missed.length === 1 ? "it" : "them"}.`);
  }
  return lines.join(" ");
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { SUITE, SPEC, RECORDS, AGAINST } = process.env;
  if (!SUITE || !SPEC || !RECORDS) { console.error("SUITE, SPEC and RECORDS are required"); process.exit(2); }
  try {
    const spec = JSON.parse(readFileSync(SPEC, "utf8"));
    const files = suiteFiles(SUITE);
    if (!files.length) {
      console.log(JSON.stringify({ ok: false, code: 3, reply: `There is no suite under ${join(SUITE, "test")} to check: nothing named test/<name>.test.mjs.` }));
      process.exitCode = 3;
    } else {
      const standIns = standInRun({ spec, files });
      let real = null; let mutations = [];
      if (AGAINST) {
        if (!existsSync(join(AGAINST, "scripts"))) throw new Error(`${AGAINST} has no scripts folder to prove the suite against`);
        ({ real, mutations } = provingRuns({ spec, files, realDir: AGAINST }));
      }
      const said = verdict({ standIns, real, mutations });
      const record = { checked: "v1", at: new Date().toISOString(), files: files.map((f) => f.path), stand_ins: standIns, real, mutations, verdict: said };
      mkdirSync(RECORDS, { recursive: true });
      writeFileSync(join(RECORDS, "checked.json"), JSON.stringify(record, null, 2) + "\n");
      console.log(said);
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
