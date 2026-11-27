// http-agent.mjs: the one-message entrypoint for an outside agent that
// answers over HTTP (docs/try-mode-plan.md, "The adapter on it"). What is
// pinned: it keeps one-message.mjs's contract (reply file, pieces under out/
// listed in pieces.json, outcome.json, the exit codes); it starts the agent's
// own server once, detached, with the image's own environment, the try's
// settings and the model door and nothing else of its own; the token is made
// once per container, sent on every call and never written anywhere it
// should not be; a turn that is still working is polled and each update is a
// status line the adapter streams; files go in under the named field and are
// said in the words, and are refused plainly when the agent takes none; and a
// server that will not start ends the job with its log's tail in words.
// Run: node --test agents/image/test/http-agent.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  answerOne, commandArgv, exitCodeOf, fill, fillBody, fillPath, homeOf, mediaTypeOf, messageFiles, readAnswers, redact, serverEnv, threadOf, updateText,
} from "../http-agent.mjs";
import { tmp } from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTTP_AGENT = join(HERE, "..", "http-agent.mjs");
const FAKE = join(HERE, "fake-http-server.mjs");
const WINDOWS = process.platform === "win32";
const started = [];

after(() => {
  for (const pid of started) { try { process.kill(pid); } catch { /* gone */ } }
});

const freePort = () => new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** One job's folders, the image's two files and a message, as the tenant
 *  host and the supervisor lay them out. */
async function job({ answers = {}, message = {}, state = null } = {}) {
  const root = tmp("http-agent-");
  const agentDir = join(root, "agent");
  const jobDir = join(root, "job");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(jobDir, { recursive: true });
  const port = answers.port ?? await freePort();
  const record = join(root, "record.jsonl");
  const a = {
    over: "http", port, health: "/health", start: [process.execPath, FAKE],
    env: { DESIGN_AGENT_API_PORT: String(port), DESIGN_AGENT_API_HOST: "127.0.0.1", FAKE_RECORD: record, FAKE_SETTING: "from the try" },
    token: { env: "DESIGN_AGENT_API_TOKENS", value: "{token}:agentmesh", header: "authorization", prefix: "Bearer " },
    ask: { method: "POST", path: "/threads/{thread}/messages", body: { text: "{text}" } },
    reply: "reply",
    files: { list: "files", get: "/threads/{thread}/files/{name}" },
    working: { field: "working", poll: "/threads/{thread}/updates?after={after}", items: "updates", next: "cursor" },
    attach: { path: "/threads/{thread}/attachments", field: "files" },
    job_seconds: 120,
    ...answers,
  };
  if (answers.env) a.env = { ...a.env, ...answers.env, FAKE_RECORD: record, DESIGN_AGENT_API_PORT: String(port), DESIGN_AGENT_API_HOST: "127.0.0.1" };
  for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
  writeFileSync(join(agentDir, "answers.json"), JSON.stringify(a));
  // Node on Windows cannot open a socket without SystemRoot; an image's own
  // environment on Linux needs nothing of the kind.
  writeFileSync(join(agentDir, "command.json"), JSON.stringify({ entrypoint: null, cmd: ["design-agent", "serve"], workdir: root, user: "agent",
    env: ["PATH=/opt/venv/bin:/usr/local/bin:/usr/bin:/bin", "IMAGE_OWN=yes", ...(WINDOWS ? [`SystemRoot=${process.env.SystemRoot}`] : [])] }));
  const messageFile = join(jobDir, "message.json");
  writeFileSync(messageFile, JSON.stringify({ id: "m1", task_id: "task-1", from: "USENDER", text: "draw a logo", files: [], ...message }));
  const env = {
    MESH_JOB_DIR: jobDir, MESH_MESSAGE_FILE: messageFile, MESH_REPLY_FILE: join(jobDir, "reply.txt"), AGENT_DIR: agentDir,
    AGENT_DIRECTORY_WORK: state ?? join(root, "state"), AGENT_JOB_SECONDS: "120",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:8790", ANTHROPIC_API_KEY: "not-a-key-agentmesh-model-door", AGENTMESH_MODEL_URL: "http://127.0.0.1:8790",
    LD_LIBRARY_PATH: "/opt/mesh/lib", PATH: process.env.PATH, ...(WINDOWS ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  const events = () => (existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const stateDir = join(env.AGENT_DIRECTORY_WORK, "http-agent");
  const token = () => readFileSync(join(stateDir, "token"), "utf8").trim();
  const remember = () => { for (const e of events()) if (e.event === "start" && !started.includes(e.pid)) started.push(e.pid); };
  return { root, jobDir, agentDir, env, port, events, stateDir, token, remember, answers: a };
}

const read = (p) => readFileSync(p, "utf8");
const updatesOf = (dir) => (existsSync(join(dir, "updates.jsonl")) ? read(join(dir, "updates.jsonl")).trim().split("\n").map((l) => JSON.parse(l)) : []);

test("a turn that is still working is polled, each update is a status line, and its reply and delivered file come back as pieces", async () => {
  const j = await job({ message: { text: "draw a logo, and render it in the background" } });
  const r = await answerOne(j.env, { pollMs: 50 });
  j.remember();
  assert.equal(r.status, "answered");
  assert.equal(exitCodeOf(r.status), 0);
  assert.match(r.reply, /Here is a first look\./);
  assert.match(r.reply, /The render finished\./);
  const lines = updatesOf(j.jobDir);
  assert.ok(lines.some((l) => l.progress === "The render finished."), JSON.stringify(lines));
  assert.ok(lines.every((l) => typeof l.progress === "string" && Object.keys(l).length === 1), "status lines in the adapter's shape");
  // The file it delivered, in out/ and listed the way one-message.mjs lists them.
  const pieces = JSON.parse(read(join(j.jobDir, "pieces.json")));
  assert.deepEqual(pieces.map((p) => [p.name, p.step, p.path, p.media_type]), [["logo.png", "answer", "out/logo.png", "image/png"]]);
  assert.equal(readFileSync(join(j.jobDir, "out", "logo.png")).subarray(1, 4).toString(), "PNG");
  const outcome = JSON.parse(read(join(j.jobDir, "outcome.json")));
  assert.equal(outcome.status, "answered");
  assert.deepEqual(outcome.pieces, ["logo.png"]);
  assert.equal(read(join(j.jobDir, "reply.txt")).trim(), r.reply.trim());
  // The thread is the job's id; the poll carried the cursor of the last answer.
  const ev = j.events();
  assert.equal(ev.find((e) => e.event === "ask").thread, "task-1");
  assert.deepEqual(ev.filter((e) => e.event === "poll").map((e) => e.after), [0]);
  assert.ok(!ev.some((e) => e.event === "refused"), "every call carried the token");
});

test("the waiting ends when a poll says the work is done", async () => {
  const j = await job({ message: { text: "background please" }, answers: { env: { FAKE_POLL_FLAG: "1" } } });
  const r = await answerOne(j.env, { pollMs: 50 });
  j.remember();
  assert.equal(r.status, "answered");
  assert.equal(j.events().filter((e) => e.event === "poll").length, 1);
});

test("the agent's server starts once, detached, with the image's own environment, the try's settings and the model door, and one token per container", async () => {
  const j = await job();
  const first = await answerOne(j.env, { pollMs: 50 });
  j.remember();
  assert.equal(first.status, "answered");
  assert.match(first.reply, /You said: draw a logo/);
  const s = j.events().find((e) => e.event === "start");
  assert.ok(s, "the server was started");
  assert.equal(s.cwd.replace(/\\/g, "/").toLowerCase(), j.root.replace(/\\/g, "/").toLowerCase(), "in the image's own working folder");
  assert.equal(s.env.PATH, "/opt/venv/bin:/usr/local/bin:/usr/bin:/bin", "the image's own PATH, not this container's");
  assert.equal(s.env.IMAGE_OWN, "yes");
  assert.equal(s.env.FAKE_SETTING, "from the try");
  assert.equal(s.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:8790");
  assert.equal(s.env.ANTHROPIC_API_KEY, "not-a-key-agentmesh-model-door");
  assert.equal(s.env.AGENTMESH_MODEL_URL, "http://127.0.0.1:8790");
  assert.equal(s.env.LD_LIBRARY_PATH, null, "the adapter's libraries are not the agent's");
  assert.equal(s.env.MESH_JOB_DIR, null, "nothing of this job's own environment is passed on");
  assert.equal(s.tokens_set, true, "the token reached its variable through the try's template");
  assert.match(j.token(), /^[0-9a-f]{64}$/);
  if (!WINDOWS) assert.equal(statSync(join(j.stateDir, "token")).mode & 0o777, 0o600);
  const token = j.token();
  // A second message to the same container: the same server and the same token.
  writeFileSync(j.env.MESH_MESSAGE_FILE, JSON.stringify({ id: "m2", task_id: "task-2", text: "and again", files: [] }));
  const second = await answerOne(j.env, { pollMs: 50 });
  assert.match(second.reply, /You said: and again/);
  assert.equal(j.events().filter((e) => e.event === "start").length, 1);
  assert.equal(j.token(), token);
  // The token is in nothing written for the sender or the log.
  for (const f of ["reply.txt", "outcome.json"]) assert.ok(!read(join(j.jobDir, f)).includes(token), f);
});

test("two messages at once start the server once", async () => {
  const shared = tmp("http-agent-state-");
  const a = await job({ state: shared });
  const b = await job({ state: shared, answers: { port: a.port } });
  writeFileSync(b.env.MESH_MESSAGE_FILE, JSON.stringify({ id: "m9", task_id: "task-9", text: "second", files: [] }));
  // Both point their records at a's file: the server is a's.
  const [ra, rb] = await Promise.all([answerOne(a.env, { pollMs: 50 }), answerOne(b.env, { pollMs: 50 })]);
  a.remember();
  assert.equal(ra.status, "answered", ra.reply);
  assert.equal(rb.status, "answered", rb.reply);
  assert.equal(a.events().filter((e) => e.event === "start").length + b.events().filter((e) => e.event === "start").length, 1);
});

test("a message's files go to the agent under the named field and are said in the words", async () => {
  const j = await job();
  const f = join(j.root, "0-brand guide.pdf");
  writeFileSync(f, "%PDF-1.4 fake");
  writeFileSync(j.env.MESH_MESSAGE_FILE, JSON.stringify({ id: "m3", task_id: "task-3", text: "use this", files: [{ path: f, media_type: "application/pdf", name: "brand guide.pdf" }, { path: "/nowhere", name: "lost.png", error: "too large" }] }));
  const r = await answerOne(j.env, { pollMs: 50 });
  j.remember();
  assert.equal(r.status, "answered");
  const att = j.events().find((e) => e.event === "attach");
  assert.deepEqual(att.fields, ["files"]);
  assert.deepEqual(att.names, ["brand_guide.pdf"]);
  assert.match(att.type, /^multipart\/form-data; boundary=/);
  assert.match(j.events().find((e) => e.event === "ask").text, /use this\n\nAttached file: \/workspace\/attachments\/brand_guide\.pdf/);
  assert.match(r.reply, /did not reach the agent: lost\.png \(too large\)/);
});

test("files are refused plainly when the agent takes none, and nothing is asked", async () => {
  const j = await job({ answers: { attach: undefined } });
  const f = join(j.root, "photo.png");
  writeFileSync(f, "png");
  writeFileSync(j.env.MESH_MESSAGE_FILE, JSON.stringify({ id: "m4", text: "look", files: [{ path: f, name: "photo.png", media_type: "image/png" }] }));
  const r = await answerOne(j.env, { pollMs: 50 });
  j.remember();
  assert.equal(r.status, "no answer");
  assert.equal(exitCodeOf(r.status), 3);
  assert.match(r.reply, /This agent takes no files, so nothing was sent to it: photo\.png was attached/);
  assert.ok(!j.events().some((e) => e.event === "ask"));
  assert.equal(JSON.parse(read(join(j.jobDir, "outcome.json"))).status, "no answer");
});

test("a server that does not start ends the job with the tail of its log in words, and never the token", async () => {
  const j = await job({ answers: {
    start: [process.execPath, "-e", "console.error('starting'); console.error('could not open the database, token ' + process.env.FAKE_SECRET); process.exit(1)"],
    env: { FAKE_SECRET: "{token}" },
  } });
  const r = await answerOne(j.env, { pollMs: 50, startWaitMs: 20_000 });
  assert.equal(r.status, "no answer");
  assert.match(r.reply, /the agent's own server stopped before it answered \/health on port \d+ \(it exited with code 1\)/);
  assert.match(r.reply, /could not open the database, token \[redacted\]/);
  assert.ok(!r.reply.includes(j.token()));
  assert.ok(!read(join(j.jobDir, "reply.txt")).includes(j.token()));
  assert.ok(!existsSync(join(j.stateDir, "server.lock")), "the start lock is let go");
});

test("as a program it exits 0 on an answer, the server outlives it, and the token is never printed", async () => {
  const j = await job();
  const child = spawn(process.execPath, [HTTP_AGENT], { env: j.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  // `close` waits for every pipe: a server that held one would keep it open.
  const code = await Promise.race([
    new Promise((r) => child.on("close", (c) => r(c))),
    new Promise((r) => setTimeout(() => r("the job's pipes stayed open"), 30_000)),
  ]);
  j.remember();
  assert.equal(code, 0, out);
  assert.match(out, /You said: draw a logo/);
  assert.ok(!out.includes(j.token()));
  const pid = j.events().find((e) => e.event === "start").pid;
  assert.doesNotThrow(() => process.kill(pid, 0), "the agent's server is still running");
});

test("a job with no job folder is refused before anything runs", async () => {
  const j = await job();
  const env = { ...j.env };
  delete env.MESH_JOB_DIR;
  await assert.rejects(() => answerOne(env), /MESH_JOB_DIR is not set/);
  const p = spawn(process.execPath, [HTTP_AGENT], { env, stdio: "ignore", windowsHide: true });
  assert.equal(await new Promise((r) => p.on("close", r)), 2);
});

test("the pieces it is made of", () => {
  assert.deepEqual(commandArgv({ start: null }, { entrypoint: ["/usr/bin/tini", "--"], cmd: ["design-agent", "serve"] }), ["/usr/bin/tini", "--", "design-agent", "serve"]);
  assert.deepEqual(commandArgv({ start: ["python", "-m", "app"] }, { entrypoint: ["x"], cmd: ["y"] }), ["python", "-m", "app"]);
  assert.throws(() => commandArgv({}, { entrypoint: [], cmd: [] }), /names no command/);
  assert.equal(fillPath("/threads/{thread}/files/{name}", { thread: "t 1", name: "a/b.png" }), "/threads/t%201/files/a%2Fb.png");
  assert.equal(fillPath("/u?after={after}", { after: 3 }), "/u?after=3");
  assert.deepEqual(fillBody({ text: "{text}", meta: ["{text}!", 3, { thread: "{thread}" }] }, { text: "hi" }), { text: "hi", meta: ["hi!", 3, { thread: "{thread}" }] });
  assert.equal(fill("{token}:agentmesh", { token: "abc" }), "abc:agentmesh");
  assert.equal(threadOf({ id: "m1", task_id: "a2a/task 7" }), "a2a-task-7");
  assert.equal(threadOf({ id: "msg_1" }), "msg_1");
  assert.equal(homeOf(10001, "root:x:0:0:root:/root:/bin/bash\nagent:x:10001:10001::/home/agent:/bin/sh\n"), "/home/agent");
  const env = serverEnv({ command: { env: ["A=1", "PATH=/p"] }, answers: { env: { B: "x{token}" }, token: { env: "T", value: "{token}:c" } }, token: "tok", model: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8790" }, home: "/home/agent" });
  assert.deepEqual(env, { A: "1", PATH: "/p", HOME: "/home/agent", B: "xtok", T: "tok:c", ANTHROPIC_BASE_URL: "http://127.0.0.1:8790" });
  assert.equal(mediaTypeOf("a.svg", "application/octet-stream"), "image/svg+xml");
  assert.equal(mediaTypeOf("a.bin", "text/html; charset=utf-8"), "text/html");
  assert.equal(updateText({ text: " done " }), "done");
  assert.equal(updateText("  "), "");
  const { got, missing } = messageFiles({ files: [{ path: HTTP_AGENT, name: "a.mjs" }, { path: HTTP_AGENT, name: "a.mjs" }, { path: "/nope", name: "x" }] });
  assert.deepEqual(got.map((f) => f.upload), ["a.mjs", "2-a.mjs"]);
  assert.equal(missing.length, 1);
  assert.equal(redact("Bearer abcdefghijklmnop and tok123456789", { token: "tok123456789" }), "Bearer [redacted] and [redacted]");
  assert.throws(() => readAnswers(JSON.stringify({ over: "grpc" })), /answers over http/);
});
