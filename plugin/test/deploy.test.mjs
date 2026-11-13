// Putting the agent on AgentMesh (kit/deploy.mjs): the folder is checked, laid
// out as an agent repository, pushed to GitHub without a force push, and filed
// by email the first time and as its next version after that. The ticket is
// kept where git never takes it. GitHub, git and AgentMesh are all stand-ins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLIC, SAVED, instanceOf, layOutRepo, notReady, ownKeys, publish, put, savedOf, tryIt, wait } from "../kit/deploy.mjs";

const RUNTIME = { format: "agent-runtime-requirements-v1", systems: [{ name: "text-reasoning", kind: "model", protocols: ["anthropic-messages"] }] };

/** A build folder whose spec and build have passed, with nothing changed since. */
function built({ runtime = RUNTIME, gates = { spec: { passed: true }, build: { passed: true } } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "adlc-deploy-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "time-zone-converter", version: "0.1.2" }));
  writeFileSync(join(dir, "agent-runtime-requirements.json"), JSON.stringify(runtime));
  writeFileSync(join(dir, "scripts", "convert.mjs"), "export {};\n");
  writeFileSync(join(dir, "build.lock.json"), JSON.stringify({ build_lock: "v1", digests: {}, gates }));
  return dir;
}

/** The packer, standing in: a package folder with the agent's files in it. */
const packer = (_dir, { out }) => {
  const pkg = join(out, "time-zone-converter");
  mkdirSync(join(pkg, "skills", "convert", "scripts"), { recursive: true });
  writeFileSync(join(pkg, "plugin.json"), "{}");
  writeFileSync(join(pkg, "skills", "convert", "scripts", "convert.mjs"), "export {};\n");
  return { ok: true, package_dir: pkg };
};

/** git and gh, standing in: every call kept; `exists` says whether the repository is there. */
function shell({ exists = true, pushFails = false } = {}) {
  const calls = [];
  const run = (cmd, args, { cwd } = {}) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd === "git" && args[0] === "ls-remote") return { status: exists ? 0 : 2, stdout: "", stderr: "" };
    if (cmd === "git" && args[0] === "clone") { mkdirSync(join(cwd, "repo", ".git"), { recursive: true }); writeFileSync(join(cwd, "repo", "old.txt"), "old"); return { status: 0, stdout: "", stderr: "" }; }
    if (cmd === "git" && args[0] === "diff") return { status: 1, stdout: "", stderr: "" };
    if (cmd === "git" && args[0] === "push") return pushFails ? { status: 1, stdout: "", stderr: "rejected" } : { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

/** AgentMesh, standing in: answers by path, keeps every request. */
function mesh(answers) {
  const asked = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    asked.push({ method: init.method, path: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : undefined, origin: u.origin });
    const a = typeof answers === "function" ? answers(u.pathname, asked.length) : answers[u.pathname];
    return new Response(JSON.stringify(a?.body ?? {}), { status: a?.status ?? 404 });
  };
  return { fetcher, asked };
}

const TICKET = `${"a".repeat(12)}.${"b".repeat(32)}`;

test("the public AgentMesh unless one is named, and a line that says which", () => {
  assert.equal(instanceOf({ env: {} }).url, PUBLIC);
  assert.match(instanceOf({ env: {} }).said, /public AgentMesh \(api\.agentmesh\.ai\)/);
  assert.equal(instanceOf({ flag: "https://mesh.example.com/", env: {} }).url, "https://mesh.example.com");
  assert.equal(instanceOf({ saved: "https://saved.example.com", env: { AGENTMESH_INSTANCE: "https://env.example.com" } }).url, "https://saved.example.com");
  assert.equal(instanceOf({ env: { AGENTMESH_INSTANCE: "https://env.example.com" } }).url, "https://env.example.com");
});

test("keys of the owner's own are a service or MCP credential and an MCP address, never a model", () => {
  assert.deepEqual(ownKeys({ systems: [
    { name: "code-host", kind: "service", credential: "github-token" },
    { name: "weather", kind: "service", credential: "none" },
    { name: "docs", kind: "mcp" },
    { name: "text-reasoning", kind: "model" },
  ] }), ["the github-token credential for code-host", "the address of the docs MCP server"]);
  assert.deepEqual(ownKeys(RUNTIME), []);
});

test("an unfinished build, or one needing its own keys, is not put on AgentMesh, and nothing is pushed or filed", async () => {
  const unfinished = built({ gates: { spec: { passed: true } } });
  assert.match(notReady(unfinished)[0], /build has not passed its check/);
  const keyed = built({ runtime: { systems: [{ name: "code-host", kind: "service", credential: "github-token" }] } });
  assert.match(notReady(keyed)[0], /needs keys of your own \(the github-token credential for code-host\)/);
  for (const dir of [unfinished, keyed]) {
    const s = shell();
    const m = mesh({});
    const r = await put(dir, { email: "dev@example.com", name: "Dana Developer", repo: "dev/tz", run: s.run, fetcher: m.fetcher, packer, env: {} });
    assert.equal(r.code, 1);
    assert.equal(s.calls.length, 0);
    assert.equal(m.asked.length, 0);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the repository holds agent-repo.json, the package and the build folder, without .git, node_modules or the ticket", () => {
  const dir = built();
  mkdirSync(join(dir, ".agentmesh"));
  writeFileSync(join(dir, SAVED), "{}");
  const into = mkdtempSync(join(tmpdir(), "adlc-laid-"));
  assert.equal(layOutRepo(dir, into, { packer }).ok, true);
  assert.deepEqual(JSON.parse(readFileSync(join(into, "agent-repo.json"), "utf8")), { format: "agent-repository-v1", package: "package", source: "source" });
  assert.ok(existsSync(join(into, "package", "skills", "convert", "scripts", "convert.mjs")));
  assert.ok(existsSync(join(into, "source", "scripts", "convert.mjs")));
  for (const gone of [".git", "node_modules", ".agentmesh", ".pack"]) assert.ok(!existsSync(join(into, "source", gone)) && !existsSync(join(into, gone)), gone);
  assert.match(readFileSync(join(into, "README.md"), "utf8"), /# time-zone-converter/);
  rmSync(dir, { recursive: true, force: true });
  rmSync(into, { recursive: true, force: true });
});

test("an existing repository gets one new commit, never a force push; a new one is made public with gh", () => {
  const laid = mkdtempSync(join(tmpdir(), "adlc-laid-"));
  writeFileSync(join(laid, "agent-repo.json"), "{}");
  const there = shell({ exists: true });
  assert.equal(publish(laid, "dev/tz", "time-zone-converter 0.1.2", { run: there.run }).ok, true);
  assert.ok(there.calls.some((c) => c.startsWith("git clone")));
  assert.ok(there.calls.includes("git push --quiet origin HEAD:main"));
  assert.ok(!there.calls.some((c) => /--force|-f\b/.test(c)));
  assert.ok(!there.calls.some((c) => c.startsWith("gh ")));

  const fresh = shell({ exists: false });
  assert.equal(publish(laid, "dev/tz", "m", { run: fresh.run }).ok, true);
  assert.ok(fresh.calls.some((c) => c.startsWith("gh repo create dev/tz --public")));

  const refused = shell({ pushFails: true });
  const r = publish(laid, "dev/tz", "m", { run: refused.run });
  assert.equal(r.ok, false);
  assert.match(r.said, /could not push to dev\/tz: rejected/);
  rmSync(laid, { recursive: true, force: true });
});

test("the first put files by email and keeps the ticket out of git; the next files the new version with it", async () => {
  const dir = built();
  const s = shell();
  const m = mesh({
    "/v1/deploy/by-email": { status: 202, body: { ticket: TICKET, says: "We emailed dev@example.com." } },
    [`/v1/deploy/by-email/${TICKET}/update`]: { status: 202, body: { state: "installing", says: "It asks for nothing new." } },
  });
  const nameless = await put(dir, { email: "dev@example.com", repo: "dev/tz", run: s.run, fetcher: m.fetcher, packer, env: {} });
  assert.equal(nameless.code, 2);
  assert.match(nameless.said, /--name/);
  assert.equal(m.asked.length, 0);
  const first = await put(dir, { email: "dev@example.com", name: "Dana Developer", repo: "dev/tz", run: s.run, fetcher: m.fetcher, packer, env: {} });
  assert.equal(first.code, 0, first.said);
  assert.match(first.said, /public AgentMesh[\s\S]*Pushed to https:\/\/github\.com\/dev\/tz[\s\S]*We emailed dev@example\.com/);
  assert.deepEqual(m.asked[0], { method: "POST", path: "/v1/deploy/by-email", body: { email: "dev@example.com", name: "Dana Developer", repo: "dev/tz" }, origin: PUBLIC });
  assert.deepEqual(savedOf(dir), { instance: PUBLIC, repo: "dev/tz", agent: "time-zone-converter", ticket: TICKET });
  assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /^\.agentmesh\/$/m);

  // The name proposed for the person's own agent goes with the filing.
  const other = built();
  const s2 = shell();
  const m2 = mesh({ "/v1/deploy/by-email": { status: 202, body: { ticket: TICKET, says: "We emailed dev@example.com." } } });
  const proposed = await put(other, { email: "dev@example.com", name: "Dana Developer", ownAgent: "claude-code", repo: "dev/tz", run: s2.run, fetcher: m2.fetcher, packer, env: {} });
  assert.equal(proposed.code, 0, proposed.said);
  assert.deepEqual(m2.asked[0].body, { email: "dev@example.com", name: "Dana Developer", repo: "dev/tz", own_agent: "claude-code" });
  rmSync(other, { recursive: true, force: true });

  const next = await put(dir, { run: s.run, fetcher: m.fetcher, packer, env: {} });
  assert.equal(next.code, 0, next.said);
  assert.equal(next.state, "installing");
  assert.deepEqual(m.asked[1], { method: "POST", path: `/v1/deploy/by-email/${TICKET}/update`, body: undefined, origin: PUBLIC });
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8").match(/\.agentmesh\//g).length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("AgentMesh's refusal is passed on in its words", async () => {
  const dir = built();
  const m = mesh({ "/v1/deploy/by-email": { status: 403, body: { error: "AgentMesh opens to organizations first." } } });
  const r = await put(dir, { email: "dev@example.com", name: "Dana Developer", repo: "dev/tz", run: shell().run, fetcher: m.fetcher, packer, env: {} });
  assert.equal(r.code, 1);
  assert.match(r.said, /AgentMesh did not take it: AgentMesh opens to organizations first\./);
  assert.equal(savedOf(dir), null);
  rmSync(dir, { recursive: true, force: true });
});

test("wait says each change once and stops when it is running", async () => {
  const dir = built();
  mkdirSync(join(dir, ".agentmesh"));
  writeFileSync(join(dir, SAVED), JSON.stringify({ instance: "https://mesh.example.com", repo: "dev/tz", agent: "time-zone-converter", ticket: TICKET }));
  const states = [
    { state: "waiting_for_click", says: "Waiting for the button." },
    { state: "waiting_for_click", says: "Waiting for the button." },
    { state: "installing", says: "Approved." },
    { state: "running", says: "time-zone-converter is running on AgentMesh as time-zone-converter.dev@example.com.", handle: "time-zone-converter.dev@example.com" },
  ];
  const m = mesh((_p, n) => ({ status: 200, body: states[Math.min(n - 1, states.length - 1)] }));
  const printed = [];
  const r = await wait(dir, { fetcher: m.fetcher, sleep: async () => {}, print: (s) => printed.push(s) });
  assert.equal(r.state, "running");
  assert.equal(r.handle, "time-zone-converter.dev@example.com");
  assert.deepEqual(printed, ["Waiting for the button.", "Approved.", states[3].says]);
  assert.equal(m.asked[0].origin, "https://mesh.example.com");
  rmSync(dir, { recursive: true, force: true });
});

test("try sends one message and shows the reply, waiting past a progress note", async () => {
  const dir = built();
  mkdirSync(join(dir, ".agentmesh"));
  writeFileSync(join(dir, SAVED), JSON.stringify({ instance: "https://mesh.example.com", repo: "dev/tz", agent: "time-zone-converter", ticket: TICKET }));
  let reads = 0;
  const m = mesh((p) => {
    if (p.endsWith("/test")) return { status: 200, body: { ok: false, state: "delivered", reply_in: "inbox", sent_at: "2026-11-13T17:00:00.000Z" } };
    reads++;
    return { status: 200, body: { replies: reads < 2 ? [] : [{ text: "Working", reply_status: "working" }, { text: "09:30 in Denver is 17:30 in Paris." }] } };
  });
  const r = await tryIt(dir, { text: "09:30 Denver to Paris", fetcher: m.fetcher, sleep: async () => {} });
  assert.equal(r.code, 0, r.said);
  assert.equal(r.reply, "09:30 in Denver is 17:30 in Paris.");
  assert.deepEqual(m.asked[0].body, { text: "09:30 Denver to Paris" });
  assert.match(m.asked[1].path, /\/replies\?since=2026-11-13T17%3A00%3A00\.000Z$/);
  rmSync(dir, { recursive: true, force: true });
});
