// Fill a job folder from a finished workspace: every script under out/, the
// writer's account, the run record, and pieces.json, the list the adapter
// signs when the reply is sent. That signed list is the provenance the
// package-maker's door checks: a script is packed only when a manifest under
// the code-writer's key lists a piece with exactly its bytes.
//
// Nothing is filed unless the verdict says done. A job that stopped at the
// ceiling, at the fence or on a conflict delivers nothing, and the reply says
// which; the pieces list does not exist, so nothing downstream can mistake a
// half-written folder for a delivery.
//
//   needs: node >= 22
//   [JOB_DIR=<job folder>, else MESH_JOB_DIR] RECORDS=<records folder> node pieces.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

const trim = (s) => String(s ?? "").trim();
const copyBytes = (from, to) => writeFileSync(to, readFileSync(from));

export const STEP_OF = { script: "write-the-scripts", account: "write-the-scripts", runs: "check-the-work" };

/** The sentence a script wrote about itself: its opening comment up to the
 *  first blank comment line, without the needs and command lines. */
export function aboutOf(text, path) {
  const lines = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const l = trim(raw);
    if (!l.startsWith("//")) break;
    const body = trim(l.replace(/^\/\/\s?/, ""));
    if (!body) break;
    if (/^(needs:|[A-Z_]+=.*node |node )/.test(body)) continue;
    lines.push(body);
  }
  const said = lines.join(" ").replace(/\s+/g, " ").trim();
  return said ? `${basename(path)}: ${said.slice(0, 280)}` : `${basename(path)}, a script that says nothing about itself`;
}

/** Every file under scripts/ in the workspace, as {path, text}. */
export function scriptsIn(workspace) {
  const root = join(workspace, "scripts");
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const at = join(d, n);
      if (statSync(at).isDirectory()) walk(at);
      else out.push({ path: relative(workspace, at).replace(/\\/g, "/"), text: readFileSync(at, "utf8") });
    }
  };
  walk(root);
  return out;
}

/** What to list and what to copy. Pure; the caller copies. */
export function plan({ workspace = "", verdict = null, scripts = [], accountPath = "", runsPath = "" } = {}) {
  if (!workspace) throw new Error("there is no workspace to deliver from");
  if (!verdict?.done) throw new Error(`nothing is delivered: ${trim(verdict?.said) || "the check never said done"}`);
  if (!scripts.length) throw new Error("there is no script to deliver");
  const entries = [];
  const copies = [];
  for (const s of scripts) {
    entries.push({
      name: basename(s.path), step: STEP_OF.script, path: `out/${s.path}`, media_type: "text/javascript",
      about: aboutOf(s.text, s.path), produced_from: ["the spec", "the suite"],
    });
    copies.push({ from: join(workspace, s.path), to: `out/${s.path}`, what: basename(s.path) });
  }
  if (accountPath) {
    entries.push({
      name: "account", step: STEP_OF.account, path: "out/account.md", media_type: "text/markdown",
      about: "The writer's own account: what was written, in a few sentences, and any decision the spec did not settle. For the code critic and the person at the review gate.",
      produced_from: ["the spec", "the suite"],
    });
    copies.push({ from: accountPath, to: "out/account.md", what: "the account" });
  }
  if (runsPath) {
    entries.push({
      name: "the run record", step: STEP_OF.runs, path: "out/runs.json", media_type: "application/json",
      about: "Every round of the check: how many tests passed and failed and which failed by name, so a reader sees how many rounds the scripts took and where they were hard.",
      produced_from: ["the suite"],
    });
    copies.push({ from: runsPath, to: "out/runs.json", what: "the run record" });
  }
  return { entries, copies };
}

/** Place the files and write the list. Nothing is written until every copy
 *  has a source. */
export function fill(jobDir, { entries, copies }) {
  for (const c of copies) if (!existsSync(c.from)) throw new Error(`${c.what} is not at ${c.from}`);
  for (const c of copies) {
    const dest = join(jobDir, c.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyBytes(c.from, dest);
  }
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify(entries, null, 2) + "\n");
  return entries;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  const JOB_DIR = process.env.JOB_DIR || process.env.MESH_JOB_DIR;
  if (!JOB_DIR || !RECORDS) { console.error("JOB_DIR and RECORDS are required"); process.exit(2); }
  if (!existsSync(JOB_DIR) || !statSync(JOB_DIR).isDirectory()) { console.error(`the job folder does not exist: ${JOB_DIR}`); process.exit(2); }
  try {
    const readJson = (name) => { const p = join(RECORDS, name); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; };
    const record = readJson("workspace.json");
    const verdict = readJson("verdict.json");
    if (!record?.folder) throw new Error("there is no workspace record: run workspace.mjs first");
    if (!verdict?.done) {
      console.log(JSON.stringify({ ok: false, code: 3, reply: `Nothing is delivered: ${trim(verdict?.said) || "the check never said done"}` }));
      process.exit(3);
    }
    const accountPath = join(RECORDS, "account.md");
    const runsPath = join(RECORDS, "runs.json");
    const listed = fill(JOB_DIR, plan({
      workspace: record.folder, verdict, scripts: scriptsIn(record.folder),
      accountPath: existsSync(accountPath) ? accountPath : "", runsPath: existsSync(runsPath) ? runsPath : "",
    }));
    console.log(`${listed.length} piece${listed.length === 1 ? "" : "s"} listed at ${join(JOB_DIR, "pieces.json")}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
