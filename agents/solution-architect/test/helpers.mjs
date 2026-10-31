// Run the five commands the skill names, as a harness would, with the model's
// answers replayed from files: nothing here reaches a network or a model.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");
export const FIX = join(HERE, "fixtures");
export const fixture = (name) => join(FIX, name);

const node = (script, env) => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", script)], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  const line = (r.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  let out = null;
  try { out = JSON.parse(line); } catch { out = { raw: r.stdout }; }
  return { status: r.status, out, stderr: r.stderr };
};

/** A fresh records root with one job folder. */
export function workspace() {
  const root = mkdtempSync(join(tmpdir(), "architect-"));
  return { root, job: (name) => { const j = join(root, "jobs", name); const rec = join(root, "records", name); mkdirSync(j, { recursive: true }); return { job: j, records: rec }; } };
}

/** One whole job: the five commands and the pieces. Stops where a command
 *  does, and returns every command's answer. */
export function runJob({ ws, name = "j1", text = "", files = [], answers = [], env = {} }) {
  const { job, records } = ws.job(name);
  const textFile = join(ws.root, `${name}.txt`);
  writeFileSync(textFile, text);
  const base = { ...env, JOB_DIR: job, RECORDS: records };
  const steps = {};
  steps.asked = node("asked.mjs", { ...base, TEXT_FILE: textFile, FILES: files.map((f) => (Array.isArray(f) ? `${f[0]}::${f[1]}` : f)).join(",") });
  if (steps.asked.status !== 0) return { job, records, steps, stopped: "asked" };
  steps.name = node("name.mjs", { ...base, ASKED: join(records, "asked.json"), ...(answers.length ? { ANSWERS_FROM: answers.join(",") } : {}) });
  if (steps.name.status !== 0) return { job, records, steps, stopped: "name" };
  steps.bind = node("bind.mjs", { ...base, NAMED: join(records, "named.json"), ASKED: join(records, "asked.json") });
  if (steps.bind.status !== 0) return { job, records, steps, stopped: "bind" };
  steps.check = node("check-record.mjs", { ...base, ASKED: join(records, "asked.json"), NAMED: join(records, "named.json"), BOUND: join(records, "bound.json") });
  if (steps.check.status !== 0) return { job, records, steps, stopped: "check" };
  steps.reply = node("reply.mjs", base);
  steps.pieces = node("pieces.mjs", base);
  const record = existsSync(join(records, "record.md")) ? readFileSync(join(records, "record.md"), "utf8") : null;
  return { job, records, steps, record, reply: steps.reply.out?.reply ?? "" };
}

/** A model answer written to a file, for a replay. */
export function answerFile(ws, name, doc) {
  const p = join(ws.root, `${name}.answer.json`);
  writeFileSync(p, typeof doc === "string" ? doc : JSON.stringify(doc));
  return p;
}

export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const KEY_POINTS = "an agent that reads a web page and writes the key points for a person to review";

/** The message Build an agent sends the architect: the person's words, quoted, and nothing of ours. */
export const BUILD_WORDS = [
  "Write the architecture.",
  "",
  "what it should do: \"Count the words in a piece of text someone sends and say how many there are.\"",
  "",
  "what it must never do: \"Never change the text it is given.\"",
].join("\n");
