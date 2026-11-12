// The reference builder: the ADLC plugin, run headless.
//
// It writes none of a build's files. Each message moves one build: a request
// starts a folder through the coding harness with /adlc:start; a message that
// names a build ("b-abc123: ...") resumes the harness's session with the
// person's words; "b-abc123: approve" is the person's approval, which this
// agent passes through by running the folder's own approval, then the harness
// carries on with the build until its check says it has passed. A person's
// answer is added to the folder's said.md before the harness gets it, and
// every harness run has ADLC_NOT_THE_PERSON=1, since the prompts are the
// agent's. After each run the folder's own check says where the build is, in
// its two phases (the spec, the build), and the reply says it in those words.
//
// The harness is the installed coding-harness command (declared in the
// runtime requirements as a binary): it takes --prompt-file <file> and, to
// resume, --session <id>, and answers with JSON carrying `result` and
// `session_id`. The model is the harness's; the four model settings reach it
// in the environment it inherits.
//
//   needs: node >= 22
//   node build-an-agent.mjs --job <dir> --records <dir> --work <dir> --text-file <file>
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const trim = (s) => String(s ?? "").trim();
const HARNESS = "coding-harness";
const FOLDER = "agent";
const SAID = "said.md";
const RUN_SECONDS = 3600;
const CARRY_ON = "The person approved the spec (node .adlc/approve.mjs). Carry on with the build, writing what it needs in any order and running node .adlc/check.mjs as often as you like, until the check says the build has passed. Stop only for something the check names that is the person's to decide.";

/** What a message asks: a new build, an answer to one, its approval, or nothing. */
export function parseMessage(text) {
  const t = trim(text);
  if (!t) return { kind: "empty" };
  const m = /^(b-[a-z0-9]{4,})\s*:\s*([\s\S]*)$/i.exec(t);
  if (!m) return { kind: "new", request: t };
  const build = m[1].toLowerCase();
  const words = trim(m[2]);
  return /^approve[.!]?$/i.test(words) ? { kind: "approve", build } : { kind: "answer", build, words };
}

function argsOf(argv) {
  const at = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ""; };
  // Each folder is made absolute where the job starts: the harness runs inside
  // the build's folder, so a relative path to its prompt would not be found.
  const folder = (k) => { const p = at(k); return p ? resolve(p) : ""; };
  return { job: folder("--job"), records: folder("--records"), work: folder("--work"), textFile: at("--text-file") };
}

const buildsIn = (work) => join(work, "builds");
const keptBuilds = (work) => (existsSync(buildsIn(work)) ? readdirSync(buildsIn(work)).filter((d) => existsSync(join(buildsIn(work), d, "build.json"))) : []);

/** Run the harness once in a build's folder, with a prompt and, to resume, a session. */
function harness(spawn, cwd, prompt, session) {
  // Each prompt is kept beside the build folder, never in it: what was asked
  // of the build, in order.
  const prompts = join(cwd, "prompts");
  mkdirSync(prompts, { recursive: true });
  const promptFile = join(prompts, `${String(readdirSync(prompts).length + 1).padStart(3, "0")}.txt`);
  writeFileSync(promptFile, prompt);
  // Its prompts are not the person's: the plugin keeps none of them in said.md.
  const r = spawn(HARNESS, ["--prompt-file", promptFile, ...(session ? ["--session", session] : [])], { cwd, env: { ...process.env, ADLC_NOT_THE_PERSON: "1" }, encoding: "utf8", timeout: RUN_SECONDS * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { ok: false, why: trim(r.error?.message) || trim(r.stderr).split("\n").slice(-2).join(" ") || `it exited ${r.status}` };
  try {
    const doc = JSON.parse(trim(r.stdout));
    if (typeof doc.result !== "string") return { ok: false, why: "its answer carried no result" };
    return { ok: true, result: doc.result, session: trim(doc.session_id) || session || "" };
  } catch { return { ok: false, why: "its answer was not JSON" }; }
}

const COULD_NOT_TELL = "The check could not tell where the build is.";

/** Where a build is, in the words of its own check's JSON answer: its phase
 *  (spec or build), the sentence, whether the spec waits for the person, and
 *  whether the build has passed. Passed only when the check says so. */
export function whereOf(doc) {
  if (!doc || typeof doc !== "object") return { phase: "none", where: COULD_NOT_TELL, waiting: false, passed: false };
  const problems = Array.isArray(doc.problems) ? doc.problems : [];
  const n = problems.length;
  if (doc.code === 3) return { phase: doc.phase ?? "none", where: "A file that can no longer change was changed, so the build has not passed.", waiting: false, passed: false };
  if (doc.phase === "spec") {
    if (doc.code === 4 && doc.waiting === true && !n) return { phase: "spec", where: "The spec waits for the person's approval.", waiting: true, passed: false };
    if (n) return { phase: "spec", where: "The spec still has things missing.", waiting: false, passed: false };
    return { phase: "spec", where: COULD_NOT_TELL, waiting: false, passed: false };
  }
  if (doc.phase === "build" || doc.phase === null) {
    if (doc.passed === true && doc.code === 0 && !n) return { phase: "build", where: "The build has passed.", waiting: false, passed: true };
    if (n) return { phase: "build", where: `The build has ${n} thing${n === 1 ? "" : "s"} missing.`, waiting: false, passed: false };
  }
  return { phase: doc.phase ?? "none", where: COULD_NOT_TELL, waiting: false, passed: false };
}

/** Where the build folder's own check says the build is. */
function checkOf(spawn, folder) {
  if (!existsSync(join(folder, ".adlc", "check.mjs")) && !existsSync(join(folder, ".adlc"))) return whereOf(null);
  const r = spawn("node", [join(".adlc", "check.mjs"), "--json"], { cwd: folder, encoding: "utf8", timeout: 600000 });
  try { return whereOf(JSON.parse(trim(r.stdout))); } catch { return whereOf(null); }
}

/** Add the person's words to the build folder's said.md under a heading with
 *  the time, and return how to put it back as it was. */
function keepSaid(folder, words, now) {
  if (!existsSync(folder)) return () => {};
  const file = join(folder, SAID);
  const before = existsSync(file) ? readFileSync(file, "utf8") : null;
  const head = before === null ? "# What the person said\n\nKept as the person said it, after request.md.\n\n" : "";
  appendFileSync(file, `${head}## ${now()}\n\n${words}\n\n`);
  return () => { if (before === null) rmSync(file, { force: true }); else writeFileSync(file, before); };
}

/** File the reply as the job's one piece, and answer with it. */
function deliver(jobDir, code, text) {
  if (jobDir) {
    mkdirSync(join(jobDir, "out"), { recursive: true });
    writeFileSync(join(jobDir, "out", "reply.md"), text);
    writeFileSync(join(jobDir, "pieces.json"), JSON.stringify([{ name: "reply", path: "out/reply.md", media_type: "text/markdown" }], null, 2) + "\n");
  }
  return { code, reply: text };
}

const replyText = (id, at, said) => [
  `build: ${id}`,
  `phase: ${at.phase}`,
  `where: ${at.where}`,
  "",
  "## What the build did",
  "",
  trim(said),
  "",
  at.passed ? "Nothing more is needed from you."
    : at.waiting ? `Reply with \`${id}: approve\` when you approve the spec, or \`${id}: <your answer>\` to change it.`
    : `Reply with \`${id}: <your answer>\`.`,
  "",
].join("\n");

/** One job: one message, one move of one build. */
export async function runJob({ argv = [], spawn = spawnSync, newId = () => `b-${randomBytes(4).toString("hex")}`, now = () => new Date().toISOString() } = {}) {
  const a = argsOf(argv);
  const said = a.textFile && existsSync(a.textFile) ? readFileSync(a.textFile, "utf8") : "";
  const msg = parseMessage(said);
  const work = a.work || resolve(".");
  const none = (id, where, words) => `build: ${id}\nphase: none\nwhere: ${where}\n\n## What the build did\n\n${words}\n`;
  if (msg.kind === "empty") {
    return deliver(a.job, 3, none("none", "No build was started.", "Nothing yet. Tell me what the agent should do, in your own words, and I will start a build from it."));
  }
  if (msg.kind === "new") {
    const id = newId();
    const home = join(buildsIn(work), id);
    mkdirSync(home, { recursive: true });
    const run = harness(spawn, home, `/adlc:start ${FOLDER} ${msg.request}`, "");
    if (!run.ok) {
      rmSync(home, { recursive: true, force: true });
      return deliver(a.job, 1, none("none", "No build was started.", `The coding harness could not be run (${run.why}), so no build was started and nothing was written.`));
    }
    writeFileSync(join(home, "build.json"), JSON.stringify({ build: id, session: run.session, folder: FOLDER }, null, 2) + "\n");
    return deliver(a.job, 0, replyText(id, checkOf(spawn, join(home, FOLDER)), run.result));
  }
  const home = join(buildsIn(work), msg.build);
  if (!existsSync(join(home, "build.json"))) {
    const kept = keptBuilds(work);
    return deliver(a.job, 3, none(msg.build, "This agent keeps no such build.", `Nothing: this agent keeps no build ${msg.build}${kept.length ? `. The builds it keeps are ${kept.join(", ")}` : ", and it keeps none yet"}. Send a request to start one.`));
  }
  const kept = JSON.parse(readFileSync(join(home, "build.json"), "utf8"));
  const folder = join(home, kept.folder);
  let prompt = msg.words;
  // The person's own words go to said.md first; the agent's prompts never do.
  let putBack = () => {};
  if (msg.kind === "approve") {
    const ok = spawn("node", [join(".adlc", "approve.mjs")], { cwd: folder, encoding: "utf8", timeout: 600000 });
    if (ok.status !== 0) return deliver(a.job, 3, replyText(msg.build, checkOf(spawn, folder), `The spec was not approved: ${trim(ok.stdout) || trim(ok.stderr)}`));
    prompt = CARRY_ON;
  } else {
    putBack = keepSaid(folder, msg.words, now);
  }
  const run = harness(spawn, home, prompt, kept.session);
  if (!run.ok) {
    putBack();
    return deliver(a.job, 1, none(msg.build, COULD_NOT_TELL, `The coding harness could not be run (${run.why}); the build is as it was.`));
  }
  writeFileSync(join(home, "build.json"), JSON.stringify({ ...kept, session: run.session }, null, 2) + "\n");
  return deliver(a.job, 0, replyText(msg.build, checkOf(spawn, folder), run.result));
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile === "build-an-agent.mjs") {
  runJob({ argv: process.argv.slice(2) }).then((r) => { console.log(JSON.stringify({ reply: r.reply })); process.exitCode = r.code; },
    (e) => { console.log(JSON.stringify({ reply: `The build could not be moved: ${e.message}` })); process.exitCode = 1; });
}
