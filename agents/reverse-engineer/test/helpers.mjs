// What the suites share: a fixture codebase copied to a folder of its own,
// made a git checkout with real commits; a job folder and the argv the run
// command is given; and the model, stood in by an answer file.
//   import { codebase, commitAll, job, standIn, readPiece } from "./helpers.mjs"
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, "fixtures");
export const AGENT = join(HERE, "..");
export const REPOSITORY = "https://git.example.com/acme/greeter.git";

/** git in a test repository, with an identity of its own and no signing, so
 *  the suite runs the same on any machine. */
export function git(dir, args) {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "init.defaultBranch=main", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A copy of a fixture codebase in a fresh folder; with `checkout`, a git
 *  repository with the copy committed. Answers {dir, commit}. */
export function codebase(name, { checkout = true, root = mkdtempSync(join(tmpdir(), "reverse-engineer-")) } = {}) {
  const dir = join(root, "code");
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  if (!checkout) return { root, dir, commit: null };
  git(dir, ["init", "-q"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  return { root, dir, commit: commitAll(dir, `${name}`) };
}

/** Commit every file in the folder, answering the new commit's digest. */
export function commitAll(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

/** A job folder holding message.txt, and the argv the command is given. */
export function job({ root, id = "job-1", message = "", codebase: folder = null, files = [], repository = REPOSITORY, commit = null, mayRun = null }) {
  const jobDir = join(root, "jobs", id);
  mkdirSync(jobDir, { recursive: true });
  const lines = [message];
  if (repository) lines.push(`repository: ${repository}`);
  if (commit) lines.push(`commit: ${commit}`);
  if (mayRun) lines.push(`may run: ${mayRun}`);
  writeFileSync(join(jobDir, "message.txt"), lines.filter(Boolean).join("\n"));
  const argv = ["--job", jobDir, "--records", join(root, "records"), "--work", join(root, "work"), "--text-file", join(jobDir, "message.txt")];
  if (folder) argv.push("--codebase", folder);
  for (const f of files) argv.push("--file", `${f.path}::${f.type ?? ""}`);
  return { jobDir, argv, recordsDir: join(root, "records", id) };
}

/** The model, stood in: each call answers the next file's text (the last one
 *  again when they run out), and every prompt is kept. */
export function standIn(...names) {
  const prompts = [];
  let i = 0;
  const call = async (prompt) => {
    prompts.push(prompt);
    const name = names[Math.min(i, names.length - 1)];
    i += 1;
    return { text: readFileSync(join(FIXTURES, "answers", name), "utf8"), answered_by: "stand-in", tokens_in: 1, tokens_out: 1 };
  };
  return { call, prompts };
}

/** A delivered piece, parsed. */
export const readPiece = (jobDir, file) => JSON.parse(readFileSync(join(jobDir, "out", "as-built", file), "utf8"));
export const pieceBytes = (jobDir, file) => readFileSync(join(jobDir, "out", "as-built", file));
