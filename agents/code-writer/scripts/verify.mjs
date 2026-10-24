// The delivery check the host runs over a finished job, outside the work.
//
// The harness that did the work can write anything into the job folder,
// including a verdict that says it is done. This does not read any of that.
// It takes what came in (the spec and the suite under in/) and what went out
// (the scripts under out/scripts), lays them out as a package in a folder of
// its own, runs the suite, blanks each script in turn, and says whether the
// delivery is what the suite asked for. The supervisor runs it before the
// reply is accepted and refuses the delivery when it fails, whatever the
// work printed. On 2026-09-14 the first code-writer run wrote its own
// verdict, claimed every test passed, and delivered no scripts; this is the
// answer to that.
//
//   needs: node >= 22
//   JOB_DIR=<job folder> node verify.mjs     prints one JSON object; exit 0 accepts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { blankRuns, runSuite, suitePaths } from "./check.mjs";
import { agentAmong, agentFilesByPath, scriptsOf, specOfAgent, staysInside } from "./workspace.mjs";

const trim = (s) => String(s ?? "").trim();

/** Every file under a folder, as posix-relative paths. */
function filesUnder(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const at = join(d, n);
      if (statSync(at).isDirectory()) walk(at);
      else out.push(relative(dir, at).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out;
}

/** The inbound prefixes taken off a file's name: the adapter puts one on
 *  every file it stages (<n>-<8 chars>-), and a file forwarded by the
 *  process runner arrives with one per hop. */
export function bareName(name) {
  let n = String(name ?? "");
  for (;;) { const m = /^\d+-[A-Za-z0-9_-]{8}-(.+)$/.exec(n); if (!m) return n; n = m[1]; }
}

/** Whether a file's text is a test file for node's runner: it imports
 *  node:test, whatever it is called. */
export function looksLikeTest(text) {
  return /from\s+["']node:test["']|require\(["']node:test["']\)/.test(String(text ?? ""));
}

/** What came in: the spec, and the suite's files, told apart BY CONTENT.
 *  The adapter puts inbound files under in/ with a prefix on each name, and
 *  a file that travelled through the process runner arrives under its piece
 *  label rather than its file name: "spec" with no extension,
 *  "suite_test_file" for a test. On 2026-09-15 a delivery was refused as
 *  "nothing under in/ is a spec" for that reason alone. So the spec is
 *  whichever file parses as JSON with a name and jobs, and a test file is
 *  whichever imports node:test; each test is staged as test/<name>.test.mjs
 *  with the prefixes taken off and the extension put on when it is missing. */
export function whatCameIn(jobDir) {
  const inDir = join(jobDir, "in");
  let spec = null; let specPath = null;
  const suite = [];
  const others = [];
  // The agent's own files, found by content and preferred; the spec they
  // state is read from a scratch copy laid out as the folder.
  const texts = [];
  for (const rel of filesUnder(inDir)) {
    try { texts.push({ rel, text: readFileSync(join(inDir, rel), "utf8") }); } catch { /* unreadable is not the spec */ }
  }
  const agentFound = agentAmong(texts);
  let agent = null;
  if (agentFound) {
    const { used, ...files } = agentFound;
    agent = files;
    const scratch = mkdtempSync(join(tmpdir(), "code-writer-agent-"));
    try { spec = specOfAgent(agent, scratch); } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  const taken = new Set((agentFound?.used ?? []).map((f) => f.rel));
  for (const rel of filesUnder(inDir)) {
    if (taken.has(rel)) continue;
    const at = join(inDir, rel);
    let text;
    try { text = readFileSync(at, "utf8"); } catch { continue; }
    const bare = bareName(basename(rel)).replace(/[^A-Za-z0-9._-]+/g, "-");
    if (looksLikeTest(text)) {
      let name = bare;
      if (!name.endsWith(".test.mjs")) name = `${name.replace(/\.(m?js|test)$/g, "")}.test.mjs`;
      suite.push({ path: `test/${name}`, text });
      continue;
    }
    if (/^job-manifest\.json$/.test(bare)) continue;
    if (!spec && !agent) {
      try {
        const doc = JSON.parse(text);
        if (doc && typeof doc.name === "string" && Array.isArray(doc.jobs)) { spec = doc; specPath = at; continue; }
      } catch { /* not the spec */ }
    }
    // Anything else that came with the suite (a helper, a fake, a sample
    // file) is staged beside the tests, where a test that imports it will
    // find it.
    others.push({ path: `test/${bare}`, text });
  }
  return { spec, specPath, agent, suite: [...suite, ...others] };
}

/** What went out: every file under out/scripts, as scripts/<path>. */
export function whatWentOut(jobDir) {
  const root = join(jobDir, "out", "scripts");
  return filesUnder(root).map((rel) => ({ path: `scripts/${rel}`, text: readFileSync(join(root, rel), "utf8") }));
}

/** The verdict. Pure apart from the scratch folder it lays the package out in. */
export function verify(jobDir, { spawn } = {}) {
  const { spec, suite, agent } = whatCameIn(jobDir);
  if (!spec) return { ok: false, said: "nothing under in/ is a spec, so there is nothing the delivery could be checked against" };
  if (!suite.length) return { ok: false, said: "no test file came in with the spec, so there is no suite to hold the delivery to" };
  const named = scriptsOf(spec);
  const out = whatWentOut(jobDir);
  if (!out.length) return { ok: false, said: `no scripts were delivered under out/scripts; the spec names ${named.length}: ${named.join(", ")}` };
  const delivered = new Set(out.map((f) => f.path));
  const missing = named.filter((s) => !delivered.has(s));
  if (missing.length) return { ok: false, said: `the delivery is missing ${missing.length} of the ${named.length} scripts the spec names: ${missing.join(", ")}` };
  for (const f of out) if (!staysInside(f.path)) return { ok: false, said: `a delivered path climbs out of the package: ${f.path}` };

  const scratch = mkdtempSync(join(tmpdir(), "code-writer-verify-"));
  try {
    // The declaration beside the scripts, where a suite reads it: the
    // agent's own files when they came, a spec.json otherwise.
    const declaration = agent
      ? Object.entries(agentFilesByPath(agent)).map(([path, text]) => ({ path, text }))
      : [{ path: "spec.json", text: JSON.stringify(spec, null, 2) + "\n" }];
    for (const f of [...declaration, ...suite, ...out]) {
      const at = join(scratch, f.path);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, f.text);
    }
    // References and assets the spec names: laid out from the file that
    // came in by that name, and stood in as empty only when none came.
    const inDir = join(jobDir, "in");
    const inFiles = filesUnder(inDir);
    for (const j of spec.jobs ?? []) for (const kind of ["references", "assets"]) for (const rel of j?.[kind] ?? []) {
      const p = trim(rel).replace(/\\/g, "/");
      if (!staysInside(p) || p.startsWith("scripts/")) continue;
      const at = join(scratch, p);
      const found = inFiles.find((f) => bareName(basename(f)) === basename(p));
      if (found) {
        mkdirSync(dirname(at), { recursive: true });
        writeFileSync(at, readFileSync(join(inDir, found)));
      } else if (/\.[a-z0-9]+$/i.test(basename(p))) {
        mkdirSync(dirname(at), { recursive: true });
        if (!existsSync(at)) writeFileSync(at, "");
      } else {
        mkdirSync(at, { recursive: true });
      }
    }
    const paths = suitePaths(scratch);
    const run = runSuite(scratch, paths, { spawn });
    if (run.fails) {
      const named = run.failing.slice(0, 8);
      return {
        ok: false,
        said: `the suite fails against the delivered scripts, ${run.fail} of ${run.tests}${run.timed_out ? " (the run did not finish in time)" : ""}`
          + (named.length ? `: ${named.join("; ")}${run.failing.length > 8 ? `; and ${run.failing.length - 8} more` : ""}` : (run.tests === 0 ? `; nothing ran: ${run.tail.slice(-400)}` : "")),
        tests: run.tests, pass: run.pass, fail: run.fail,
      };
    }
    const blanks = blankRuns({ dir: scratch, scripts: named, paths, spawn });
    const unnoticed = blanks.filter((b) => !b.noticed).map((b) => b.script);
    return {
      ok: true,
      said: `the suite passes against the delivered scripts, ${run.pass} of ${run.tests}`
        + (unnoticed.length ? `; blanked one at a time, the suite did not notice ${unnoticed.join(", ")} going missing, which is the test-writer's to fix` : `; blanked one at a time, the suite noticed every one of the ${blanks.length}`),
      tests: run.tests, pass: run.pass, unnoticed,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { JOB_DIR } = process.env;
  if (!JOB_DIR) { console.error("JOB_DIR is required"); process.exit(2); }
  try {
    const v = verify(JOB_DIR);
    console.log(JSON.stringify(v));
    process.exit(v.ok ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({ ok: false, said: `the check itself failed: ${e.message}` }));
    process.exit(1);
  }
}
