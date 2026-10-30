// The whole job as one command: the spec found among the attached files, the
// four steps run in order, the pieces filed, and one reply printed.
//
// WHY THIS EXISTS. The instructions used to hand the harness five commands to
// run in order and one to file the pieces. On 2026-09-15 the harness ran the
// four and then wrote a pieces.json of its own, with names it invented
// ("suite_test_file", "suite_details") and absolute paths, instead of running
// pieces.mjs; the next holder received files with no extension and could not
// tell the spec from the suite. A job whose every step is a script is a job
// that should run as one script, so the package names this file as the job's
// command (12.3 `run`) and nothing is left to improvise: no harness is woken,
// the one model call is the one write-suite.mjs makes, and the pieces are
// always the ones pieces.mjs lists.
//
// The spec is found BY CONTENT, never by name: a file that came through the
// process runner arrives under its piece label with a prefix per hop, and
// spec.json can be called "0-abcdefgh-spec" by the time it lands here. So is
// the suite a released package already has: any attached file that imports
// node:test. When one came, the writer adds to it and never rewrites it.
//
//   needs: node >= 22; the model settings the writing step reads (MODEL_NAME,
//   MODEL_ENDPOINT, MODEL_PROTOCOL, and MODEL_KEY where the endpoint asks for
//   one), placed in the environment by the install
//   node job.mjs --job <job folder> --records <records dir> --work <work dir>
//        --text-file <path> [--file <path>[::<media type>]]...
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { agentFilesAmong, layOutAgentFiles } from "./agent-folder.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

export function parseArgs(argv) {
  const o = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--job") o.job = next();
    else if (a === "--records") o.records = next();
    else if (a === "--work") o.work = next();
    else if (a === "--text-file") o.textFile = next();
    else if (a === "--file") { const v = next(); const [path, media] = String(v ?? "").split("::"); o.files.push({ path, media_type: media || "" }); }
  }
  return o;
}

/** Does this text parse as a package spec: a name, a version, and jobs with
 *  slugs. The same floor declared.mjs keeps. */
export function looksLikeSpecText(text) {
  try {
    const doc = JSON.parse(text);
    return Boolean(doc && typeof doc === "object" && !Array.isArray(doc) && typeof doc.name === "string" && doc.name
      && Array.isArray(doc.jobs) && doc.jobs.length && doc.jobs.every((j) => j && typeof j.slug === "string" && j.slug));
  } catch { return false; }
}

/** The spec among the files, by content. A job manifest is JSON too and is
 *  never a spec; it is skipped by name so a manifest that happened to carry a
 *  name and jobs could not be mistaken for one. */
export function findSpec(files, read = (p) => readFileSync(p, "utf8")) {
  for (const f of files) {
    if (!f?.path || /job-manifest\.json$/.test(f.path)) continue;
    let text;
    try { text = read(f.path); } catch { continue; }
    if (looksLikeSpecText(text)) return f.path;
  }
  return null;
}

/** A test file among the attachments: its content imports node:test. Found
 *  by content for the same reason the spec is. */
export const looksLikeTestText = (text) => /from\s+["']node:test["']/.test(String(text ?? ""));

/** The name a test file goes under in test/: the process runner's prefixes
 *  ("0-abcdefgh-") taken off, and .test.mjs put on when it is missing. */
export function testNameOf(path) {
  let n = basename(String(path ?? ""));
  while (/^\d+-[A-Za-z0-9_-]{8}-/.test(n)) n = n.replace(/^\d+-[A-Za-z0-9_-]{8}-/, "");
  if (n.endsWith(".test.mjs")) return n;
  if (n.endsWith(".mjs")) return `${n.slice(0, -4)}.test.mjs`;
  return `${n}.test.mjs`;
}

/** The suite the package already has, when the message carried one: every
 *  attached file that imports node:test and is not the spec, as test files. */
export function findSuite(files, spec, read = (p) => readFileSync(p, "utf8")) {
  const out = [];
  for (const f of files) {
    if (!f?.path || f.path === spec || /job-manifest\.json$/.test(f.path)) continue;
    let text;
    try { text = read(f.path); } catch { continue; }
    if (looksLikeTestText(text)) out.push({ path: `test/${testNameOf(f.path)}`, text });
  }
  return out;
}

/** One step: a script beside this one, run with its variables, its last JSON
 *  line read back. A step that prints no JSON is a failure with its words. */
function step(script, env, { spawn = spawnSync } = {}) {
  const r = spawn(process.execPath, [join(HERE, script)], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 20 * 60 * 1000 });
  const lines = String(r.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  let doc = null;
  for (let i = lines.length - 1; i >= 0 && !doc; i--) { try { doc = JSON.parse(lines[i]); } catch { /* not this line */ } }
  if (r.signal) return { ok: false, code: 124, reply: `${script} did not finish in time and was stopped.` };
  // pieces.mjs prints a sentence, not JSON; a step that exits 0 with words is
  // a step that did its work.
  if (!doc) return r.status === 0 ? { ok: true, code: 0, said: lines.join(" ") } : { ok: false, code: r.status ?? 1, reply: `${script} printed no result${r.stderr ? `: ${trim(r.stderr).slice(-300)}` : ""}.` };
  return { ...doc, code: doc.code ?? r.status ?? 0 };
}

/** The job. Returns {reply, ...}; the reply is the whole answer. */
export function runJob({ job, records, work, files = [], textFile = "", spawn = spawnSync, read } = {}) {
  if (!job || !records || !work) return { ok: false, reply: "The job command needs --job, --records and --work." };
  const id = basename(job);
  const RECORDS = join(records, id);
  const WORK = join(work, id);
  mkdirSync(RECORDS, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  // The agent's own files are what the spec writer delivers, and they are
  // preferred: found by content, laid out as the agent's folder under this
  // job's records, and the folder is the spec every step reads. A spec.json
  // is still read where they did not come, for one transition.
  const agent = agentFilesAmong(files, read);
  const SPEC = agent
    ? layOutAgentFiles(agent, join(RECORDS, "agent"), read ? (p) => read(p) : undefined)
    : findSpec(files, read);
  if (!SPEC) {
    return { ok: false, code: 3, reply: "Nothing attached is the agent's files or a spec: a suite is written from the files the package is built from (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and the SKILL.md files), and none of the files that came with this message is one. Attach them and ask again." };
  }
  const declared = step("declared.mjs", { SPEC, RECORDS }, { spawn });
  if (declared.code === 3 || !declared.ok) return { ok: false, code: declared.code, reply: declared.reply ?? "The spec could not be read." };
  // An existing suite is laid out by its bytes, beside the work folder and
  // never on the job folder's mount, and handed to the writer to add to.
  const used = new Set(agent?.used ?? []);
  const suite = findSuite(files.filter((f) => !used.has(f?.path)), SPEC, read);
  const extra = {};
  if (suite.length) {
    const EXISTING = `${WORK}.existing`;
    for (const f of suite) {
      const at = join(EXISTING, f.path);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, f.text);
    }
    extra.EXISTING = EXISTING;
  }
  if (textFile && existsSync(textFile)) extra.ASKED_TEXT = textFile;
  const written = step("write-suite.mjs", { DECLARED: join(RECORDS, "declared.json"), SPEC, RECORDS, WORK, ...extra }, { spawn });
  if (!written.ok && written.reply) return { ok: false, code: written.code, reply: written.reply };
  if (!written.ok) return { ok: false, code: written.code, reply: `The suite could not be written: ${written.error ?? "the writing step failed"}.` };
  const checked = step("check-suite.mjs", { SUITE: WORK, SPEC, RECORDS }, { spawn });
  if (checked.code === 3) return { ok: false, code: 3, reply: checked.reply };
  const reply = step("reply.mjs", { RECORDS }, { spawn });
  if (!reply.ok) return { ok: false, code: reply.code, reply: reply.reply ?? "The reply could not be written." };
  const pieces = step("pieces.mjs", { JOB_DIR: job, RECORDS }, { spawn });
  const filed = pieces.ok !== false;
  return { ok: true, code: 0, reply: reply.reply, pieces: filed ? "pieces.json" : null,
    ...(filed ? {} : { note: `the pieces were not filed: ${pieces.reply ?? "pieces.mjs failed"}` }) };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const o = parseArgs(process.argv.slice(2));
  try {
    const out = runJob(o);
    console.log(JSON.stringify(out));
    process.exitCode = out.reply ? 0 : 1;
  } catch (e) {
    console.log(JSON.stringify({ ok: false, code: 1, reply: `I could not finish this job: ${e.message}` }));
    process.exitCode = 1;
  }
}
