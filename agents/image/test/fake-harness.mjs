// Stands in for the harness: takes the whole prompt as one argument and prints
// the answer. That is the contract the base image's wrapper has, which spells
// the rest itself (`opencode run --model "$MODEL" -- "$PROMPT"`), so the
// entrypoint passes a prompt and nothing else.
//
// It writes the prompt it was given into the job folder, because the frame is
// the thing under test: a prompt that stopped naming the job folder, or that
// let a sender's text out of the fence, would still produce an answer and the
// test would still pass.
//
//   AGENT_HARNESS_BIN=<this file>  (a .mjs path is run with node)
//   FAKE_HARNESS_SAY=<text>        what to answer; empty means answer nothing
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const jobDir = process.env.MESH_JOB_DIR ?? ".";
mkdirSync(jobDir, { recursive: true });
writeFileSync(join(jobDir, "what-the-harness-got.txt"), process.argv[2] ?? "");
// FAKE_HARNESS_DUMP_ENV=1 prints the whole environment on stderr, the way the
// brief-writer's harness did on 2026-09-29 (technical debt 77).
if (process.env.FAKE_HARNESS_DUMP_ENV === "1") {
  for (const [k, v] of Object.entries(process.env)) process.stderr.write(`${k}=${v}\n`);
}
const say = process.env.FAKE_HARNESS_SAY ?? "the harness answered this turn";
if (say) process.stdout.write(say);
