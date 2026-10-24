// Stands in for the program a package names in its `run` declaration. It does
// what turn.mjs does in the shape that matters here: reads the message text
// from the file the host wrote, takes one --file argument per attachment, and
// prints one JSON object whose `reply` is the words for the sender and whose
// `block` says this turn needs judgment.
//
// It also records its own argv and environment, because half of what these
// tests assert is what the entrypoint handed the command, not what the command
// printed: an argument list that silently changes shape when a message has no
// attachments is the failure that reaches a package as a wrong-looking file.
//
// --runs is the other half of what turn.mjs does, and the half a container
// used to lose: it keeps a file under the directory the host substituted for
// {records} and answers this message out of what earlier messages left there.
// A command given a path inside the image answers every message as its first.
//
//   node fake-command.mjs --job <dir> --message <id> --from <who>
//        --in-reply-to <id|none> --text-file <path> [--file <path>::<type>]...
//        [--runs <dir>] [--block] [--say <text>] [--silent]
//        [--file-piece <name>] [--hang]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const value = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const jobDir = value("--job") ?? process.env.MESH_JOB_DIR ?? ".";
mkdirSync(jobDir, { recursive: true });
writeFileSync(join(jobDir, "what-the-command-got.json"), JSON.stringify({
  argv,
  text: (() => { try { return readFileSync(value("--text-file"), "utf8"); } catch { return null; } })(),
  files: argv.filter((a, i) => argv[i - 1] === "--file"),
  env: {
    MESH_JOB_DIR: process.env.MESH_JOB_DIR ?? null,
    MESH_JOB_OUT: process.env.MESH_JOB_OUT ?? null,
    HOME: process.env.HOME ?? null,
  },
  cwd: process.cwd(),
}, null, 2) + "\n");

if (argv.includes("--file-piece")) {
  // A package that works in steps files each finished piece as it goes, so a
  // job cut short at the cap can still hand something over.
  mkdirSync(join(jobDir, "out"), { recursive: true });
  writeFileSync(join(jobDir, "out", "part.txt"), "the part that was finished\n");
  writeFileSync(join(jobDir, "pieces.json"), JSON.stringify([
    { name: "the first part", step: "do-the-work", path: "out/part.txt" },
  ], null, 2) + "\n");
}
// The run, kept where the host said and rebuilt from there every turn. The
// runs directory is made rather than assumed: the entrypoint has already made
// it, and a command that assumed it would pass here and fail on a mount.
let carried = null;
const runs = value("--runs");
if (runs) {
  mkdirSync(runs, { recursive: true });
  const file = join(runs, "state.json");
  const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { messages: [] };
  before.messages.push(value("--message") ?? "");
  writeFileSync(file, JSON.stringify(before, null, 2) + "\n");
  carried = `this run has had ${before.messages.length} message${before.messages.length === 1 ? "" : "s"}: `
    + before.messages.join(", ");
}

if (value("--write")) {
  // A record written into the job folder, the way pitch-writer writes
  // records/<job>/pitches.json: a write that throws ends the command with no
  // answer, as an uncaught write error does in a real package.
  writeFileSync(join(jobDir, value("--write")), JSON.stringify({ written: true }) + "\n");
}

if (value("--refuse")) {
  // A job that cannot be done, labelled (the runner retry policy): kind and
  // check as "model-output:scene-layouts", or a kind alone. --refusal-file
  // writes the label to refusal.json only, as an agent whose printed JSON
  // lost it would.
  const [kind, check] = value("--refuse").split(":");
  const label = { retryable: kind !== "input", kind, ...(check ? { check } : {}) };
  const reply = "I cannot write the pack: scene 4 broke its layout.";
  if (argv.includes("--refusal-file")) {
    writeFileSync(join(jobDir, "refusal.json"), JSON.stringify({ format: "refusal-v1", ...label, reply }) + "\n");
    process.stdout.write(JSON.stringify({ reply }));
  } else {
    process.stdout.write(JSON.stringify({ reply, refusal: label }));
  }
} else if (argv.includes("--hang")) {
  setTimeout(() => {}, 60_000);
} else if (argv.includes("--silent")) {
  process.stdout.write(JSON.stringify({ reply: "" }));
} else {
  process.stdout.write(JSON.stringify({
    reply: carried ?? value("--say") ?? "the command answered this turn",
    block: argv.includes("--block") ? "the process document does not settle this" : false,
  }));
}
