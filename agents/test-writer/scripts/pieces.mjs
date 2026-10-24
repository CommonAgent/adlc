// Fill a job folder from a written suite: every delivered piece under out/,
// and pieces.json, the list the adapter reads when the reply is sent, one
// entry per piece with the step that made it and a sentence saying what it
// is. The adapter signs the job manifest from that list; a reply with no
// pieces.json carries no job.
//
// One piece per test file, because whoever gets them next places each under
// test/ of the package and runs it, and a reader choosing which to open first
// wants the sentence each file wrote about itself. What could not be tested
// goes as a file of its own, because a reply is read once and a file is still
// there when somebody comes back to write the scripts.
//
//   needs: node >= 22
//   [JOB_DIR=<job folder>, else MESH_JOB_DIR] RECORDS=<records folder> node pieces.mjs
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const trim = (s) => String(s ?? "").trim();

/** Copy a file by its BYTES, never with copyFileSync, which carries the
 *  source file's mode and is refused by a job folder reached through a mount
 *  that serves a fixed one. */
const copyBytes = (from, to) => writeFileSync(to, readFileSync(from));

export const STEP_OF = {
  "test file": "write-the-suite",
  "what it could not test": "say-what-was-written",
};

/** The sentence a test file wrote about itself: its opening comment, up to
 *  the first blank comment line, as one line. A file with no such comment
 *  gets a plain sentence rather than nothing. */
export function aboutOf(text, path) {
  const lines = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const l = trim(raw);
    if (!l.startsWith("//")) break;
    const body = trim(l.replace(/^\/\/\s?/, ""));
    if (!body) break;
    if (/^(run:|node --test|needs:)/i.test(body)) continue;
    lines.push(body);
  }
  const said = lines.join(" ").replace(/\s+/g, " ").trim();
  const name = basename(path);
  return said ? `${name}: ${said.slice(0, 280)}` : `${name}, a test file that says nothing about itself`;
}

/** What to list and what to copy. Pure; the caller does the copying. */
export function plan({ workDir = "", files = [], couldNot = [] } = {}) {
  if (!workDir) throw new Error("there is no work folder to deliver from");
  if (!files.length) throw new Error("there is no suite to deliver: nothing was written");
  const entries = [];
  const copies = [];
  for (const f of files) {
    const name = basename(f.path);
    entries.push({
      name, step: STEP_OF["test file"], path: `out/test/${name}`,
      media_type: "text/javascript", about: aboutOf(f.text, f.path), produced_from: ["spec"],
    });
    copies.push({ from: join(workDir, f.path), to: `out/test/${name}`, what: name });
  }
  const open = couldNot.filter((c) => trim(c?.what));
  if (open.length) {
    entries.push({
      name: "what it could not test", step: STEP_OF["what it could not test"], path: "out/could-not-test.txt",
      media_type: "text/plain",
      about: "What no test was written for and why, each one a thing the spec left unsettled or a thing no test can hold. Until these are settled the suite is thin there.",
      produced_from: ["spec"],
    });
    copies.push({
      to: "out/could-not-test.txt", what: "what it could not test",
      text: open.map((c) => `${trim(c.what)}${trim(c.why) ? `: ${trim(c.why)}` : ""}`).join("\n") + "\n",
    });
  }
  return { entries, copies };
}

/** Place the files and write the list. Nothing is written until every copy
 *  that names a source has one, so a refused delivery leaves no half-filled
 *  folder. */
export function fill(jobDir, { entries, copies }) {
  for (const c of copies) {
    if (c.from && !existsSync(c.from)) throw new Error(`${c.what} is not at ${c.from}`);
  }
  for (const c of copies) {
    const dest = join(jobDir, c.to);
    mkdirSync(dirname(dest), { recursive: true });
    if (c.from) copyBytes(c.from, dest);
    else writeFileSync(dest, c.text);
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
    const suitePath = join(RECORDS, "suite.json");
    if (!existsSync(suitePath)) throw new Error(`there is no suite record at ${suitePath}`);
    const suite = JSON.parse(readFileSync(suitePath, "utf8"));
    const files = (suite.files ?? []).map((f) => ({ path: f.path, text: readFileSync(join(suite.work, f.path), "utf8") }));
    const listed = fill(JOB_DIR, plan({ workDir: suite.work, files, couldNot: suite.could_not ?? [] }));
    console.log(`${listed.length} piece${listed.length === 1 ? "" : "s"} listed at ${join(JOB_DIR, "pieces.json")}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
