// Put the agent on AgentMesh: the public one by default, or the instance named.
//
// AgentMesh reads an agent from a public GitHub repository, so the agent goes
// there first, laid out as an agent repository: agent-repo.json, the package
// the packer makes under package/, and this build folder under source/. Then
// AgentMesh emails the person a link. The page it opens has one button, and
// pressing it is the person's OK: it opens their AgentMesh account if they
// have none and puts the agent on AgentMesh. Nothing is installed until they
// press it, and the assistant never presses it.
//
// What comes back is a ticket, kept in .agentmesh/deploy.json (which git
// ignores). It reads where the agent stands, sends it one test message, and
// files its next version, which goes straight through when it asks for
// nothing new; the ticket cannot approve anything.
//
// An agent that needs keys of its own (a service or MCP credential, an MCP
// address) is not put on AgentMesh this way yet: there is no safe way here to
// hand AgentMesh a key. A model is not one: AgentMesh supplies it.
//
//   needs: node >= 22, git; gh to create a repository that does not exist yet
//   node .adlc/deploy.mjs put --email <address> --name "<your name>" --repo <owner/name> [--instance <url>]
//   node .adlc/deploy.mjs status
//   node .adlc/deploy.mjs wait [--minutes <n>]
//   node .adlc/deploy.mjs try [--text <words>] [--minutes <n>]
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pack } from "./packer.mjs";
import { lockOf, phaseOf, pinProblems } from "./stages.mjs";

/** The public AgentMesh, where an agent goes when no instance is named. */
export const PUBLIC = "https://api.agentmesh.ai";
/** Where the ticket and the instance are kept, inside the build folder. */
export const SAVED = ".agentmesh/deploy.json";
/** What is never copied into the repository's source/. */
const NOT_SOURCE = new Set([".git", "node_modules", ".agentmesh"]);
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** The instance to use, and the line that says which: a flag, then the saved one, then AGENTMESH_INSTANCE, then the public one. */
export function instanceOf({ flag, saved, env = process.env } = {}) {
  const named = [flag, saved, env.AGENTMESH_INSTANCE].find((v) => typeof v === "string" && v.trim());
  const url = (named ?? PUBLIC).trim().replace(/\/+$/, "");
  const host = url.replace(/^https?:\/\//, "");
  return { url, said: url === PUBLIC ? `Putting it on the public AgentMesh (${host}). Name another with --instance <url>.` : `Putting it on the AgentMesh at ${host}.` };
}

/** What the agent would need from its owner's own keys, by its runtime requirements (the rule AgentMesh applies). */
export function ownKeys(runtime) {
  const out = [];
  for (const s of Array.isArray(runtime?.systems) ? runtime.systems : []) {
    const role = typeof s?.name === "string" ? s.name : typeof s?.role === "string" ? s.role : "";
    if (!role) continue;
    if ((s.kind === "service" || s.kind === "mcp") && typeof s.credential === "string" && s.credential && s.credential !== "none") out.push(`the ${s.credential} credential for ${role}`);
    if (s.kind === "mcp") out.push(`the address of the ${role} MCP server`);
  }
  return out;
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** Why this folder cannot be put on AgentMesh yet, or an empty list. */
export function notReady(dir) {
  const lock = lockOf(dir);
  const phase = phaseOf(lock);
  if (phase) return [`the ${phase === "spec" ? "spec is not approved" : "build has not passed its check"} yet; run node .adlc/check.mjs`];
  const moved = pinProblems(dir, lock);
  if (moved.length) return moved;
  const keys = ownKeys(readJson(join(dir, "agent-runtime-requirements.json")));
  if (keys.length) return [`it needs keys of your own (${keys.join("; ")}), and putting an agent that needs its own keys on AgentMesh from a coding assistant isn't possible yet`];
  return [];
}

/** The agent's name and version, from its plugin.json. */
export function agentOf(dir) {
  const p = readJson(join(dir, "plugin.json")) ?? {};
  return { name: String(p.name ?? ""), version: String(p.version ?? "") };
}

/** Lay out the agent repository in `into`: agent-repo.json, README.md, package/ and source/. */
export function layOutRepo(dir, into, { packer = pack } = {}) {
  const { name, version } = agentOf(dir);
  const packed = packer(dir, { out: join(into, ".pack") });
  if (!packed.ok) return { ok: false, said: `The packer did not make a package: ${packed.refused}` };
  cpSync(packed.package_dir, join(into, "package"), { recursive: true });
  rmSync(join(into, ".pack"), { recursive: true, force: true });
  mkdirSync(join(into, "source"), { recursive: true });
  for (const e of readdirSync(dir)) if (!NOT_SOURCE.has(e)) cpSync(join(dir, e), join(into, "source", e), { recursive: true });
  writeFileSync(join(into, "agent-repo.json"), JSON.stringify({ format: "agent-repository-v1", package: "package", source: "source" }, null, 2) + "\n");
  writeFileSync(join(into, "README.md"), `# ${name}\n\nAn agent built through the Agent Development Lifecycle (https://agenticdevelopment.ai). The package AgentMesh installs is under package/; the build folder it was made from, with its spec, record, tests and code, is under source/.\n\nVersion ${version}.\n`);
  return { ok: true };
}

const git = (run, args, cwd) => run("git", args, { cwd });

/**
 * Put the laid-out repository on GitHub at `repo`: into the repository as it
 * stands, as one new commit, or into a new public one made with gh. Never a
 * force push: what is there already stays in its history.
 */
export function publish(laidOut, repo, message, { run = runCommand } = {}) {
  const url = `https://github.com/${repo}.git`;
  const work = mkdtempSync(join(tmpdir(), "adlc-repo-"));
  try {
    const exists = git(run, ["ls-remote", url], work).status === 0;
    if (exists) {
      const got = git(run, ["clone", "--quiet", "--depth", "1", url, "repo"], work);
      if (got.status !== 0) return { ok: false, said: `git could not read ${repo}: ${tail(got)}` };
    } else {
      const made = run("gh", ["repo", "create", repo, "--public", "--description", "An agent, built through the Agent Development Lifecycle"], { cwd: work });
      if (made.status !== 0) return { ok: false, said: `${repo} does not exist, and gh could not make it (${tail(made)}). Make it as an empty public repository, then run this again.` };
      mkdirSync(join(work, "repo"));
      git(run, ["init", "--quiet", "-b", "main"], join(work, "repo"));
      git(run, ["remote", "add", "origin", url], join(work, "repo"));
    }
    const at = join(work, "repo");
    for (const e of readdirSync(at)) if (e !== ".git") rmSync(join(at, e), { recursive: true, force: true });
    cpSync(laidOut, at, { recursive: true });
    git(run, ["add", "-A"], at);
    if (git(run, ["diff", "--cached", "--quiet"], at).status === 0) return { ok: true, said: `${repo} already holds this version.` };
    const committed = git(run, ["commit", "--quiet", "-m", message], at);
    if (committed.status !== 0) return { ok: false, said: `git could not commit: ${tail(committed)}` };
    const pushed = git(run, ["push", "--quiet", "origin", "HEAD:main"], at);
    if (pushed.status !== 0) return { ok: false, said: `git could not push to ${repo}: ${tail(pushed)}` };
    return { ok: true, said: `Pushed to https://github.com/${repo}.` };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

function runCommand(cmd, args, { cwd } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" && cmd === "gh" });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? r.error?.message ?? "") };
}
const tail = (r) => String(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ");

/** The saved ticket and instance, or null. */
export function savedOf(dir) {
  return readJson(join(dir, SAVED));
}

/** Keep the ticket, and make sure git never takes it. */
export function save(dir, value) {
  mkdirSync(join(dir, ".agentmesh"), { recursive: true });
  writeFileSync(join(dir, SAVED), JSON.stringify(value, null, 2) + "\n");
  const ignore = join(dir, ".gitignore");
  const lines = existsSync(ignore) ? readFileSync(ignore, "utf8").split(/\r?\n/) : [];
  if (!lines.includes(".agentmesh/")) appendFileSync(ignore, `${lines.length && lines[lines.length - 1] !== "" ? "\n" : ""}.agentmesh/\n`);
}

async function call(fetcher, method, url, body) {
  let res;
  try {
    res = await fetcher(url, { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch (err) {
    return { status: 0, body: { error: `AgentMesh could not be reached (${err.message}).` } };
  }
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * Put the agent on AgentMesh: check the folder, push it, and file it. The
 * first time, by email; once AgentMesh has it, as its next version.
 */
export async function put(dir, { email, name: publicName, repo, instance, fetcher = fetch, run = runCommand, packer = pack, env = process.env } = {}) {
  const lines = [];
  const problems = notReady(dir);
  if (problems.length) return { code: 1, said: `It can't be put on AgentMesh yet:\n${problems.map((p) => `  - ${p}`).join("\n")}` };
  const saved = savedOf(dir);
  const where = instanceOf({ flag: instance, saved: saved?.instance, env });
  const to = repo ?? saved?.repo;
  if (!to || !REPO.test(to)) return { code: 2, said: "Give --repo <owner/name>: the public GitHub repository the agent goes in." };
  if (!saved?.ticket && !email) return { code: 2, said: "Give --email <address>: where the approval email goes." };
  if (!saved?.ticket && !publicName?.trim()) return { code: 2, said: "Give --name \"<your name>\": how the agent's public card names who runs it." };
  lines.push(where.said);

  const { name, version } = agentOf(dir);
  const laid = mkdtempSync(join(tmpdir(), "adlc-laid-"));
  try {
    const out = layOutRepo(dir, laid, { packer });
    if (!out.ok) return { code: 1, said: [...lines, out.said].join("\n") };
    const pushed = publish(laid, to, `${name} ${version}`, { run });
    lines.push(pushed.said);
    if (!pushed.ok) return { code: 1, said: lines.join("\n") };
  } finally { rmSync(laid, { recursive: true, force: true }); }

  const r = saved?.ticket && saved.repo === to
    ? await call(fetcher, "POST", `${where.url}/v1/deploy/by-email/${saved.ticket}/update`)
    : await call(fetcher, "POST", `${where.url}/v1/deploy/by-email`, { email, name: publicName.trim(), repo: to });
  if (r.status !== 202) return { code: 1, said: [...lines, `AgentMesh did not take it: ${r.body.error ?? `it answered ${r.status}`}`].join("\n") };
  if (r.body.ticket) save(dir, { instance: where.url, repo: to, agent: name, ticket: r.body.ticket });
  lines.push(String(r.body.says ?? ""));
  return { code: 0, said: lines.join("\n"), state: r.body.state ?? "waiting_for_click" };
}

/** Where it stands, from the saved ticket. */
export async function status(dir, { fetcher = fetch } = {}) {
  const saved = savedOf(dir);
  if (!saved?.ticket) return { code: 2, said: "This agent has not been put on AgentMesh from this folder yet. Run node .adlc/deploy.mjs put first." };
  const r = await call(fetcher, "GET", `${saved.instance}/v1/deploy/by-email/${saved.ticket}`);
  if (r.status !== 200) return { code: 1, said: r.body.error ?? `AgentMesh answered ${r.status}.` };
  return { code: 0, said: String(r.body.says), state: r.body.state, handle: r.body.handle };
}

/** States after which waiting longer changes nothing on its own. */
const SETTLED = new Set(["running", "failed", "refused", "expired", "turned_down", "replaced", "waiting_in_app"]);

/** Follow it until it settles or the minutes run out, saying each change. */
export async function wait(dir, { minutes = 9, fetcher = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, print = console.log } = {}) {
  const until = now() + minutes * 60_000;
  let last = "";
  for (;;) {
    const s = await status(dir, { fetcher });
    if (s.code !== 0) return s;
    if (s.said !== last) { print(s.said); last = s.said; }
    if (SETTLED.has(s.state)) return s;
    if (now() >= until) return { ...s, said: `${s.said} Still waiting after ${minutes} minutes; run wait again.` };
    await sleep(10_000);
  }
}

/** Send one test message and show the reply, waiting for it up to the minutes given. */
export async function tryIt(dir, { text, minutes = 5, fetcher = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const saved = savedOf(dir);
  if (!saved?.ticket) return { code: 2, said: "This agent has not been put on AgentMesh from this folder yet." };
  const base = `${saved.instance}/v1/deploy/by-email/${saved.ticket}`;
  const sent = await call(fetcher, "POST", `${base}/test`, text ? { text } : {});
  if (sent.status !== 200) return { code: 1, said: sent.body.error ?? `AgentMesh answered ${sent.status}.` };
  if (sent.body.state === "answered") return { code: 0, said: `${saved.agent} answered:\n${sent.body.reply?.text ?? ""}`, reply: sent.body.reply?.text ?? "" };
  if (sent.body.state !== "delivered") return { code: 1, said: sent.body.error ?? `The message was ${sent.body.state}.` };
  const until = now() + minutes * 60_000;
  for (;;) {
    const r = await call(fetcher, "GET", `${base}/replies?since=${encodeURIComponent(sent.body.sent_at)}`);
    const answer = (r.body.replies ?? []).find((m) => m.reply_status !== "working");
    if (answer) return { code: 0, said: `${saved.agent} answered:\n${answer.text}`, reply: answer.text };
    if (now() >= until) return { code: 1, said: `${saved.agent} has the message but has not answered in ${minutes} minutes. Its reply will still arrive in your AgentMesh inbox.` };
    await sleep(5_000);
  }
}

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at > 0 ? argv[at + 1] : undefined;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile === "deploy.mjs" && import.meta.url.endsWith("/deploy.mjs")) {
  const argv = process.argv;
  const dir = resolve(join(import.meta.dirname, ".."));
  const what = argv[2];
  const minutes = flag(argv, "--minutes") ? Number(flag(argv, "--minutes")) : undefined;
  const run = what === "put" ? put(dir, { email: flag(argv, "--email"), name: flag(argv, "--name"), repo: flag(argv, "--repo"), instance: flag(argv, "--instance") })
    : what === "status" ? status(dir)
    : what === "wait" ? wait(dir, minutes ? { minutes } : {})
    : what === "try" ? tryIt(dir, { text: flag(argv, "--text"), ...(minutes ? { minutes } : {}) })
    : Promise.resolve({ code: 2, said: "usage: node .adlc/deploy.mjs put --email <address> --name \"<your name>\" --repo <owner/name> [--instance <url>] | status | wait [--minutes <n>] | try [--text <words>] [--minutes <n>]" });
  run.then((r) => { if (what !== "wait" || r.code !== 0) console.log(r.said); process.exitCode = r.code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
