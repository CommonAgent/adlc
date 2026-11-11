// The reference builder: the ADLC plugin, run headless.
//
// It writes none of a build's files. Each message moves one build: a request
// starts a folder through the coding harness with /adlc:start; a message that
// names a build ("b-abc123: ...") resumes the harness's session with the
// person's words; "b-abc123: approve" is the person's approval, which this
// agent passes through by running the folder's own approval, then the build
// carries on. After each run the folder's own check says the stage, and the
// reply is what the harness said.
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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const trim = (s) => String(s ?? "").trim();
const HARNESS = "coding-harness";
const FOLDER = "agent";
const RUN_SECONDS = 3600;
const TITLES = { requirements: "Requirements", architecture: "Architecture", files: "The agent's files", test: "Test", code: "Code" };

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
  return { job: at("--job"), records: at("--records"), work: at("--work"), textFile: at("--text-file") };
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
  const r = spawn(HARNESS, ["--prompt-file", promptFile, ...(session ? ["--session", session] : [])], { cwd, encoding: "utf8", timeout: RUN_SECONDS * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { ok: false, why: trim(r.error?.message) || trim(r.stderr).split("\n").slice(-2).join(" ") || `it exited ${r.status}` };
  try {
    const doc = JSON.parse(trim(r.stdout));
    if (typeof doc.result !== "string") return { ok: false, why: "its answer carried no result" };
    return { ok: true, result: doc.result, session: trim(doc.session_id) || session || "" };
  } catch { return { ok: false, why: "its answer was not JSON" }; }
}

/** The stage the build folder's own check says it is at. */
function stageOf(spawn, folder) {
  if (!existsSync(join(folder, ".adlc", "check.mjs")) && !existsSync(join(folder, ".adlc"))) return { title: "not started", done: false };
  const r = spawn("node", [join(".adlc", "check.mjs"), "--json"], { cwd: folder, encoding: "utf8", timeout: 600000 });
  try {
    const doc = JSON.parse(trim(r.stdout));
    return { title: doc.stage ? TITLES[doc.stage] ?? doc.stage : "every stage passed", done: !doc.stage && doc.code === 0 };
  } catch { return { title: "unknown (the folder's check did not answer)", done: false }; }
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

const replyText = (id, stage, said, done) => [
  `build: ${id}`,
  `stage: ${stage}`,
  "",
  "## What the build did",
  "",
  trim(said),
  "",
  done ? "Every stage has passed." : `Reply with \`${id}: <your answer>\`, or \`${id}: approve\` when you approve the spec.`,
  "",
].join("\n");

/** One job: one message, one move of one build. */
export async function runJob({ argv = [], spawn = spawnSync, newId = () => `b-${randomBytes(4).toString("hex")}` } = {}) {
  const a = argsOf(argv);
  const said = a.textFile && existsSync(a.textFile) ? readFileSync(a.textFile, "utf8") : "";
  const msg = parseMessage(said);
  const work = a.work || ".";
  if (msg.kind === "empty") {
    return deliver(a.job, 3, "build: none\nstage: not started\n\n## What the build did\n\nNothing yet. Tell me what the agent should do, in your own words, and I will start a build from it.\n");
  }
  if (msg.kind === "new") {
    const id = newId();
    const home = join(buildsIn(work), id);
    mkdirSync(home, { recursive: true });
    const run = harness(spawn, home, `/adlc:start ${FOLDER} ${msg.request}`, "");
    if (!run.ok) {
      rmSync(home, { recursive: true, force: true });
      return deliver(a.job, 1, `build: none\nstage: not started\n\n## What the build did\n\nThe coding harness could not be run (${run.why}), so no build was started and nothing was written.\n`);
    }
    writeFileSync(join(home, "build.json"), JSON.stringify({ build: id, session: run.session, folder: FOLDER }, null, 2) + "\n");
    const stage = stageOf(spawn, join(home, FOLDER));
    return deliver(a.job, 0, replyText(id, stage.title, run.result, stage.done));
  }
  const home = join(buildsIn(work), msg.build);
  if (!existsSync(join(home, "build.json"))) {
    const kept = keptBuilds(work);
    return deliver(a.job, 3, `build: ${msg.build}\nstage: unknown\n\n## What the build did\n\nNothing: this agent keeps no build ${msg.build}${kept.length ? `. The builds it keeps are ${kept.join(", ")}` : ", and it keeps none yet"}. Send a request to start one.\n`);
  }
  const kept = JSON.parse(readFileSync(join(home, "build.json"), "utf8"));
  const folder = join(home, kept.folder);
  let prompt = msg.words;
  if (msg.kind === "approve") {
    const ok = spawn("node", [join(".adlc", "approve.mjs")], { cwd: folder, encoding: "utf8", timeout: 600000 });
    if (ok.status !== 0) {
      const stage = stageOf(spawn, folder);
      return deliver(a.job, 3, replyText(msg.build, stage.title, `The spec was not approved: ${trim(ok.stdout) || trim(ok.stderr)}`, false));
    }
    prompt = "The person approved the spec (node .adlc/approve.mjs). Carry on through every stage, running the check after each change, and stop only for something that is the person's to decide.";
  }
  const run = harness(spawn, home, prompt, kept.session);
  if (!run.ok) return deliver(a.job, 1, `build: ${msg.build}\nstage: unknown\n\n## What the build did\n\nThe coding harness could not be run (${run.why}); the build is as it was.\n`);
  writeFileSync(join(home, "build.json"), JSON.stringify({ ...kept, session: run.session }, null, 2) + "\n");
  const stage = stageOf(spawn, folder);
  return deliver(a.job, 0, replyText(msg.build, stage.title, run.result, stage.done));
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile === "build-an-agent.mjs") {
  runJob({ argv: process.argv.slice(2) }).then((r) => { console.log(JSON.stringify({ reply: r.reply })); process.exitCode = r.code; },
    (e) => { console.log(JSON.stringify({ reply: `The build could not be moved: ${e.message}` })); process.exitCode = 1; });
}
