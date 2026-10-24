// The configuration the harness gives opencode for one message: which
// directories outside the agent's home this container may touch.
//
// WHY THIS EXISTS. opencode treats anything outside its project directory as
// an external directory and asks before reading or writing it. Nobody is there
// to answer in a container, so it auto-rejects, and the critic's first real run
// on Cloud Run ended with "Read /mesh/jobs/explainer-critic/critic-run-1/
// script.json failed: the user rejected permission" and no review at all. On a
// host the question never comes up: the fleet's job folders and record
// directories sit under the agent's own home, which is the project directory.
// In a container they are on a mount, because 12.7.1 wants storage that
// outlives a single run and a container's filesystem outlives nothing, so they
// are outside the home by construction.
//
// IT GRANTS THE BOUND DIRECTORIES AND NOT THE MOUNT. One bucket serves the
// whole fleet, so /mesh also holds every other agent's records and every other
// agent's job folders. A blanket allow on external directories would hand all
// of them to whichever agent happened to be reading, which is a worse failure
// than the one it fixes and a silent one. What this grants is the job folder
// for THIS message and the directories this deployment bound for THIS agent,
// by name, out of the same variables the entrypoint reads. Every other
// external directory is denied outright rather than asked about, and
// configFor says why the difference ends or saves a run.
//
// It is a file of its own rather than a line inside the harness script so that
// the base's build can run it and check what it produced, and so a test can
// read the rule without a container.
//
//   node opencode-config.mjs      prints the configuration as JSON
export const SCHEMA = "https://opencode.ai/config.json";

const trimmed = (p) => String(p).replace(/\/+$/, "");

/** Every directory this container was told to use that is not under the
 *  agent's home: the job folder for this message, and one per directory role
 *  the install file declares (12.7.1). Read from the environment and never
 *  guessed: a path guessed from a name is a path the deployment did not bind,
 *  and granting it would be granting somebody else's folder. */
export function boundDirectories(env = process.env) {
  const out = [];
  if (env.MESH_JOB_DIR) out.push(env.MESH_JOB_DIR);
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("AGENT_DIRECTORY_") && value) out.push(value);
  }
  // The agent's own state folder on the mount, which holds its package
  // beside its directories. It is derived and never guessed: only when a
  // bound directory sits under <mount>/state/<this agent's name>/ is that
  // parent granted, and it is this agent's folder by construction. Without
  // it, a model reading its own skill file at /mesh/state/code-writer/... was
  // refused and delivered nothing (code-writer, 2026-09-22).
  const name = String(env.AGENT_NAME ?? "").trim();
  if (name) {
    for (const dir of out.map(trimmed)) {
      const m = /^(.*\/state\/)([^/]+)\/[^/]+$/.exec(dir);
      if (m && m[2] === name) out.push(`${m[1]}${name}`);
    }
  }
  return [...new Set(out.map(trimmed).filter(Boolean))].sort();
}

/** The configuration, as opencode reads it from OPENCODE_CONFIG_CONTENT.
 *
 *  Three spellings per directory, because opencode does not ask about the file
 *  it is opening: it asks about the file's parent with a star after it. So a
 *  grant on the directory alone does not cover a file inside it, and a grant on
 *  its immediate children does not cover the per-job folder the critic makes
 *  under its records directory.
 *
 *  THE CATCH-ALL IS A DENY, AND IT COMES FIRST. A directory nobody bound must
 *  still be refused, and it used to be refused by leaving opencode's own
 *  default in place, which is to ask. That turned out to be the wrong kind of
 *  refusal. `opencode run` has nobody to ask, so it answers every question
 *  itself with a rejection (cli/cmd/run.ts:801-819 in 1.18.30), and a
 *  rejected question stops the whole run (session/processor.ts:200 marks the
 *  turn blocked and :694 stops on it). A denied rule is different: the tool
 *  fails with an ordinary error the model reads, and the model carries on
 *  with the folders it was given. Converted agents on 2026-09-24 globbed
 *  /mesh looking for their files, were auto-rejected, and exited 3 with
 *  nothing delivered. With the deny they would have been told no and gone on.
 *
 *  The order is the rule. opencode takes the LAST rule that matches and keeps
 *  the keys in the order they are written, so "*" goes first and every allow
 *  after it wins over it. Written the other way round, the deny would win over
 *  the allows and the job folder itself would be refused.
 *
 *  What the grant allows is unchanged: /tmp and the bound directories, three
 *  spellings each. What the deny takes away from opencode's own defaults is
 *  nothing it needs in a container. Its rules come before these, so the deny
 *  covers them, but the one for its truncated tool output is added again after
 *  everything configured (agent/agent.ts:297-310), and its data, config and
 *  skill folders are under HOME, which the entrypoint sets to the agent's home,
 *  the project directory, so they are never external in the first place. */
export function configFor(env = process.env) {
  // First, so that every allow below wins over it.
  const external = { "*": "deny" };
  // The container's own scratch space, which is nobody else's: a Cloud Run
  // task's /tmp is in its own memory and gone when the task ends. The
  // code-writer's first run (2026-09-22) staged the suite it was handed under
  // /tmp/SUITE, opencode asked about /tmp/SUITE/* along with the job folder,
  // nobody answered, and the whole request was refused: no scripts, no
  // delivery. Every package's scripts take a WORK or WORKSPACE directory and
  // a model left to choose one chooses /tmp.
  for (const dir of ["/tmp", ...boundDirectories(env)]) {
    external[dir] = "allow";
    external[`${dir}/*`] = "allow";
    external[`${dir}/**`] = "allow";
  }
  return { $schema: SCHEMA, permission: { external_directory: external } };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  process.stdout.write(JSON.stringify(configFor(process.env)));
}
