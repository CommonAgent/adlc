// Stands in for the process runner inside a single-container edition. It keeps
// the shape that matters: one turn per message, the run kept under the records
// directory the host bound, and every message it wants sent left in the job
// folder's out/outbox.jsonl for somebody else to deliver.
//
// The run it walks: START sends the writer its work and tells the owner the run
// began; the writer's reply is put to the owner as a yes-or-no question (a
// person's approval step); the owner's "yes" sends the publisher its work; the
// publisher's reply ends the run.
//
//   node fake-runner.mjs --job <dir> --from <handle> --text-file <path> --runs <dir> [--file <path>::<type>]...
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const job = value("--job");
const from = String(value("--from") ?? "");
const text = readFileSync(value("--text-file"), "utf8").trim();
const files = argv.filter((a, i) => argv[i - 1] === "--file").map((f) => f.split("::")[0]);
const runs = value("--runs");
mkdirSync(runs, { recursive: true });
const statePath = join(runs, "state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { turns: [] };
const WRITER = process.env.FAKE_WRITER ?? "writer.owner@example.test";
const PUBLISHER = process.env.FAKE_PUBLISHER ?? "publisher.owner@example.test";
const OWNER = process.env.FAKE_OWNER ?? "owner@example.test";
const send = (to, words, attach = []) => {
  mkdirSync(join(job, "out"), { recursive: true });
  appendFileSync(join(job, "out", "outbox.jsonl"), `${JSON.stringify({ to: `id-${to}`, handle: to, text: words, files: attach })}\n`);
};
state.turns.push({ from, text: text.slice(0, 80), files: files.length });
let reply = "nothing to do";
if (text.startsWith("START")) {
  state.stage = "writing";
  send(WRITER, "run r-1 phase write: write the draft");
  send(OWNER, "run r-1 started");
  reply = "started run r-1";
} else if (from === WRITER) {
  state.stage = "waiting for the owner";
  state.draft = files.map((f) => readFileSync(f, "utf8").trim());
  send(OWNER, "run r-1 phase approve: may the draft go out? yes or no", files);
  reply = "noted the draft";
} else if (from === OWNER && /^yes/i.test(text)) {
  state.stage = "publishing";
  send(PUBLISHER, "run r-1 phase publish: publish the draft");
  reply = "publishing";
} else if (from === PUBLISHER) {
  state.stage = "done";
  reply = "run r-1 is done";
}
writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
process.stdout.write(JSON.stringify({ reply }));
