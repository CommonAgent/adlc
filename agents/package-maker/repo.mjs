#!/usr/bin/env node
/**
 * The agent repository, from inside a lifecycle run (plan items 17 and 21).
 *
 * Every agent the lifecycle builds gets a repository, and the run is what puts
 * things in it. This is the piece that does the git: `agent-repo.mjs` lays out
 * the files chapter 13.2 asks for and does no git at all, so committing and
 * pushing live here.
 *
 * A run makes two commits, in this order, and the order is the whole point:
 *
 *   1. `commit-source` writes what the run is about to build from into the
 *      repository and commits it. The builder then reads a clean checkout, so
 *      `git_source` in pack.py finds a repository and a commit and the build
 *      record carries `source`. Without this commit there is nothing for a
 *      deployment record to be checked against, which is item 21.
 *
 *   2. `commit-package` lays the built package out beside it and commits that.
 *      What a person clones is then the agent: the package, its AgentDoc, the
 *      suite, and the input it was built from.
 *
 * Usage:
 *   repo.mjs prepare        --work &lt;dir&gt; --remote &lt;url&gt; [--branch main]
 *   repo.mjs commit-source  --work &lt;dir&gt; --from &lt;dir&gt; [--into source] [--message m]
 *   repo.mjs commit-package --work &lt;dir&gt; --package &lt;dir&gt; [--tests &lt;dir&gt;]
 *                           [--source source] [--listing url] [--depot url]
 *                           [--message m] [--push]
 *
 * Each prints one JSON object and exits 0, or prints {"ok":false,...} and
 * exits 1.
 *
 * THE CREDENTIAL. A push needs one, and its value appears in no argument, no
 * record and no file. `MESH_GIT_TOKEN` is read from the environment by a
 * credential helper that git runs; the argument list carries the name of the
 * variable and never what is in it.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where `agent-repo.mjs` is. Flat beside this file on the fleet host, in the
 *  repository's tools directory in a checkout, or wherever an operator says. */
function layOutTool() {
  const candidates = [
    process.env.AGENT_REPO_TOOL,
    join(HERE, "agentbuilder-agent-repo.mjs"),
    join(HERE, "..", "..", "tools", "agent-repo.mjs"),
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    fail("agent-repo.mjs is not beside this builder, so no repository can be laid out", {
      wanted: candidates,
    });
  }
  // The layout tool assembles the package AgentDoc by running the assembler
  // from its own directory, so an install that brought one file and not the
  // other fails deep inside a child process with somebody else's stack trace.
  // Say it here instead, where the message can name the file.
  const assembler = join(dirname(found), "assemble-agentdoc.mjs");
  if (!existsSync(assembler)) {
    fail("assemble-agentdoc.mjs is not beside agent-repo.mjs, so the package AgentDoc cannot be assembled", {
      wanted: [assembler],
    });
  }
  return found;
}

function fail(why, extra = {}) {
  console.log(JSON.stringify({ ok: false, why, ...extra }));
  process.exit(1);
}

/** The environment every git here runs in: no ambient config, no prompt, and
 *  a credential helper that reads the token out of the environment. */
function gitEnv() {
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  return env;
}

const CREDENTIAL_HELPER =
  '!f() { test "$1" = get && echo username=agentmesh && echo "password=$MESH_GIT_TOKEN"; }; f';

function gitArgs(extra) {
  const base = ["-c", "credential.helper="];
  if (process.env.MESH_GIT_TOKEN) {
    base.push("-c", `credential.helper=${CREDENTIAL_HELPER}`);
  }
  return [...base, ...extra];
}

function git(args, cwd, { allowFail = false } = {}) {
  const r = spawnSync("git", gitArgs(args), {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
    timeout: 300_000,
    windowsHide: true,
  });
  if (r.status !== 0 && !allowFail) {
    fail(`git ${args[0]} failed`, { detail: (r.stderr || r.stdout || "").trim().slice(0, 2000) });
  }
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function head(work) {
  const r = git(["rev-parse", "--verify", "HEAD"], work, { allowFail: true });
  return r.ok && /^[0-9a-f]{40}$/.test(r.out) ? r.out : null;
}

function currentBranch(work) {
  const r = git(["symbolic-ref", "--short", "HEAD"], work, { allowFail: true });
  return r.ok && r.out ? r.out : "main";
}

/** Identity for a commit. The platform writes as itself and names the person
 *  in the message, because the person did not type this commit. */
function identity(opts) {
  return [
    "-c",
    `user.name=${opts["author-name"] || "AgentMesh"}`,
    "-c",
    `user.email=${opts["author-email"] || "builder@agentmesh.ai"}`,
  ];
}

/** Commit whatever is staged, or say nothing changed. */
function commitAll(work, message, opts) {
  pinBytes(work);
  git(["add", "-A"], work);
  const status = git(["status", "--porcelain"], work);
  if (!status.out) {
    return { commit: head(work), changed: false };
  }
  const r = spawnSync("git", gitArgs([...identity(opts), "commit", "-m", message]), {
    cwd: work,
    encoding: "utf8",
    env: gitEnv(),
    timeout: 120_000,
    windowsHide: true,
  });
  if (r.status !== 0) {
    fail("the commit failed", { detail: (r.stderr || r.stdout || "").trim().slice(0, 2000) });
  }
  return { commit: head(work), changed: true };
}

/**
 * Pin the bytes.
 *
 * A package points at `agent-descriptor.json` and `agent-runtime-requirements.json` by sha256, and the
 * builder writes every file with LF endings so that a package built on Windows
 * hashes the same as one built on Linux. Git undoes that: a clone on a machine
 * with `core.autocrlf` on rewrites the endings, the digests stop matching, and
 * `agent-repo.mjs check` fails for somebody whose only mistake was cloning on
 * Windows. `* -text` tells git to do no conversion at all, which is the only
 * setting under which a repository full of digests survives a round trip.
 */
const GITATTRIBUTES =
  "# A package points at its files by sha256, so git must not rewrite a single\n" +
  "# byte of them. Without this a clone on Windows changes the line endings and\n" +
  "# the digests in package/plugin.json stop matching the files they name.\n" +
  "* -text\n";

function pinBytes(work) {
  const path = join(work, ".gitattributes");
  if (!existsSync(path)) writeFileSync(path, GITATTRIBUTES);
}

/** Replace a directory inside the repository with the contents of another,
 *  so that a file the run removed does not survive in the repository. */
function replaceDir(from, to) {
  if (!existsSync(from) || !statSync(from).isDirectory()) {
    fail(`${from} is not a directory`);
  }
  rmSync(to, { recursive: true, force: true });
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

// ── prepare ────────────────────────────────────────────────────────────────

/**
 * The work tree the run builds in: a clone of the agent's repository, or a
 * fresh one when the agent has never been built.
 */
function prepare(opts) {
  const work = resolve(need(opts, "work"));
  const remote = need(opts, "remote");
  const branch = opts.branch || "main";

  if (existsSync(join(work, ".git"))) {
    git(["remote", "set-url", "origin", remote], work, { allowFail: true });
    const fetched = git(["fetch", "origin", branch], work, { allowFail: true });
    if (fetched.ok) git(["checkout", "-B", branch, `origin/${branch}`], work);
    return { ok: true, work, branch, head: head(work), fresh: false };
  }

  mkdirSync(work, { recursive: true });
  const cloned = git(["clone", "--branch", branch, remote, work], undefined, { allowFail: true });
  if (cloned.ok) {
    return { ok: true, work, branch, head: head(work), fresh: false };
  }

  // An empty repository has no branch to clone, which is the ordinary state of
  // an agent nobody has built yet.
  git(["init", `--initial-branch=${branch}`, work]);
  git(["remote", "add", "origin", remote], work, { allowFail: true });
  const fetched = git(["fetch", "origin", branch], work, { allowFail: true });
  if (fetched.ok) git(["checkout", "-B", branch, `origin/${branch}`], work, { allowFail: true });
  return { ok: true, work, branch, head: head(work), fresh: true };
}

// ── commit-source ──────────────────────────────────────────────────────────

/**
 * Put the run's input in the repository and commit it, so the build can read a
 * commit. This is the commit the build record's `source` will name.
 */
function commitSource(opts) {
  const work = resolve(need(opts, "work"));
  const from = resolve(need(opts, "from"));
  const into = opts.into || "source";
  if (!existsSync(join(work, ".git"))) fail(`${work} is not a git work tree; run prepare first`);

  replaceDir(from, join(work, into));
  const message = opts.message || "The input this build read";
  const { commit, changed } = commitAll(work, message, opts);
  if (!commit) fail("there is nothing in this repository to build from");
  return { ok: true, work, commit, changed, source: into, branch: currentBranch(work) };
}

// ── commit-package ─────────────────────────────────────────────────────────

/**
 * Lay the built package out as chapter 13.2 says, check it, commit it, and
 * push when asked.
 *
 * The package directory and the suite are REPLACED rather than merged, because
 * a file the new version dropped must not survive in the repository. The
 * README is left alone once it exists, which is `agent-repo.mjs`'s own rule.
 */
function commitPackage(opts) {
  const work = resolve(need(opts, "work"));
  const pkg = resolve(need(opts, "package"));
  if (!existsSync(join(work, ".git"))) fail(`${work} is not a git work tree; run prepare first`);

  rmSync(join(work, "package"), { recursive: true, force: true });
  if (opts.tests) rmSync(join(work, basename(opts.tests)), { recursive: true, force: true });

  const args = ["lay-out", pkg, work];
  if (opts.tests) args.push("--tests", resolve(opts.tests));
  if (opts.source) args.push("--source", opts.source);
  if (opts.listing) args.push("--listing", opts.listing);
  if (opts.depot) args.push("--depot", opts.depot);

  const laid = spawnSync(process.execPath, [layOutTool(), ...args], {
    encoding: "utf8",
    cwd: work,
    timeout: 120_000,
    windowsHide: true,
  });
  if (laid.status !== 0) {
    fail("the package could not be laid out as a repository", {
      detail: (laid.stderr || laid.stdout || "").trim().slice(0, 2000),
    });
  }
  // The text of the license the package names. The layout tool writes none on
  // purpose, because a license is the publisher's statement and not a file a
  // tool should invent. Copying the text of the license the owner already
  // chose is a different act, and without it the repository names a license
  // nobody can read, which grants nothing.
  if (opts["license-file"]) {
    const from = resolve(opts["license-file"]);
    if (!existsSync(from)) fail(`the license text is not at ${opts["license-file"]}`);
    cpSync(from, join(work, "LICENSE"));
  }

  const notes = (laid.stdout || "")
    .split("\n")
    .filter((l) => l.trim().startsWith("note:"))
    .map((l) => l.trim().slice("note:".length).trim());

  // The suite belongs at `test/`, once. When it was handed over inside the
  // builder's input it has just been copied up to its own directory, and the
  // copy underneath would put the same bytes in the repository twice. The
  // builder never reads the suite anyway, so it is not part of what the
  // package was built from.
  if (opts.tests) {
    const promoted = resolve(opts.tests);
    const insideSource = resolve(join(work, opts.source || "source"));
    if (promoted.startsWith(insideSource + sep)) rmSync(promoted, { recursive: true, force: true });
  }

  // The check is not advice. A repository that fails it is one nobody should
  // be handed, and §13.8 is mostly about things that must never be committed.
  const checked = spawnSync(process.execPath, [layOutTool(), "check", work], {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (checked.status !== 0) {
    fail("this is not an agent repository", {
      detail: (checked.stderr || checked.stdout || "").trim().slice(0, 4000),
    });
  }

  const message = opts.message || "The package this run built";
  const { commit, changed } = commitAll(work, message, opts);

  let pushed = false;
  if (opts.push !== undefined) {
    const branch = currentBranch(work);
    const r = git(["push", "origin", `HEAD:${branch}`], work, { allowFail: true });
    if (!r.ok) {
      fail("the commit was made and the push failed", {
        commit,
        detail: (r.err || r.out).slice(0, 2000),
      });
    }
    pushed = true;
  }

  return { ok: true, work, commit, changed, pushed, notes, branch: currentBranch(work) };
}

// ── the door ───────────────────────────────────────────────────────────────

function need(opts, name) {
  const v = opts[name];
  if (!v) fail(`--${name} is required`);
  return v;
}

const argv = process.argv.slice(2);
const command = argv[0];
const opts = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  opts[key] = next && !next.startsWith("--") ? next : "";
}

try {
  if (command === "prepare") console.log(JSON.stringify(prepare(opts)));
  else if (command === "commit-source") console.log(JSON.stringify(commitSource(opts)));
  else if (command === "commit-package") console.log(JSON.stringify(commitPackage(opts)));
  else {
    fail("usage: repo.mjs prepare|commit-source|commit-package --work <dir> ...");
  }
} catch (err) {
  fail(String(err && err.message ? err.message : err));
}
