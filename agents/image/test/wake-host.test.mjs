// The wake host (wake-host.mjs): a container agent sleeps at no cost and runs
// its own command only while the platform's waker holds a wake open.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import {
  agentEnv, descendantsOf, readCommand, runSession, sessionEnd, startAgent, wakeCaller, wakeServer, wakeWindows,
} from "../wake-host.mjs";

const WAKER = "platform-waker@example-project.iam.gserviceaccount.com";
const tokenFor = (email) => `Bearer ${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.`;

test("the image's own command is read, entrypoint then cmd, with its folder and its library path", () => {
  const c = readCommand(JSON.stringify({ entrypoint: null, cmd: ["python", "agent.py"], workdir: "/app", env: ["PATH=/usr/bin", "LD_LIBRARY_PATH=/opt/lib"] }));
  assert.deepEqual(c.argv, ["python", "agent.py"]);
  assert.equal(c.cwd, "/app");
  assert.equal(c.ldLibraryPath, "/opt/lib");
  assert.deepEqual(readCommand(JSON.stringify({ entrypoint: ["docker-entrypoint.sh"], cmd: ["node", "agent.mjs"], workdir: "" })).argv, ["docker-entrypoint.sh", "node", "agent.mjs"]);
  assert.throws(() => readCommand(JSON.stringify({ entrypoint: null, cmd: null })), /no command/);
  assert.throws(() => readCommand("nope"), /not JSON/);
});

test("the agent is given its own settings, never the wake host's, and not the port it no longer answers on", () => {
  const env = agentEnv({ RING_HANDLE: "x.demo@agentmesh.ai", AGENTMESH_CREDENTIALS_FILE: "/secrets/c.json", PORT: "8080", WAKE_BY: WAKER, WAKE_IDLE_SECONDS: "60", LD_LIBRARY_PATH: "/opt/wake/lib" });
  assert.deepEqual(env, { RING_HANDLE: "x.demo@agentmesh.ai", AGENTMESH_CREDENTIALS_FILE: "/secrets/c.json" });
  assert.equal(agentEnv({ LD_LIBRARY_PATH: "/opt/wake/lib" }, "/usr/local/cuda/lib").LD_LIBRARY_PATH, "/usr/local/cuda/lib");
  assert.deepEqual(wakeWindows({ WAKE_IDLE_SECONDS: "5", WAKE_MAX_SECONDS: "99999" }), { idleMs: 30_000, maxMs: 3_300_000 });
});

test("only the platform's waker may wake it", () => {
  assert.equal(wakeCaller(tokenFor(WAKER), WAKER).ok, true);
  assert.match(wakeCaller(tokenFor("owner@example.com"), WAKER).why, /only the platform's waker/);
  assert.match(wakeCaller("", WAKER).why, /signed request/);
  assert.match(wakeCaller(tokenFor(WAKER), "").why, /names no waker/);
});

test("a harness the agent started counts as work under way", () => {
  const stats = { 1: "1 (wake-host) S 0", 10: "10 (python agent.py) S 1", 11: "11 (codex (x)) S 10", 12: "12 (node) S 11", 20: "20 (other) S 1" };
  const read = (p) => { const pid = /\/(\d+)\/stat$/.exec(p)[1]; if (!stats[pid]) throw new Error("gone"); return `${stats[pid].split(" ")[0]} ${stats[pid].slice(stats[pid].indexOf("("), stats[pid].lastIndexOf(")") + 1)} ${stats[pid].slice(stats[pid].lastIndexOf(")") + 2)} 0 0`; };
  assert.deepEqual(descendantsOf(10, "/proc", read, () => ["1", "10", "11", "12", "20", "self"]).sort(), [11, 12]);
  assert.deepEqual(descendantsOf(20, "/proc", read, () => ["1", "10", "20"]), []);
});

test("a session ends when nothing has happened for the idle window, and never while work is under way", () => {
  assert.equal(sessionEnd({ busy: false, sinceChangeMs: 120_000, sinceStartMs: 200_000, idleMs: 120_000, maxMs: 3_300_000 }), "idle");
  assert.equal(sessionEnd({ busy: true, sinceChangeMs: 900_000, sinceStartMs: 1_000_000, idleMs: 120_000, maxMs: 3_300_000 }), null);
  assert.equal(sessionEnd({ busy: true, sinceChangeMs: 0, sinceStartMs: 3_300_000, idleMs: 120_000, maxMs: 3_300_000 }), "limit");
});

/** A session on a clock that moves only when it sleeps. */
function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}

test("the agent's ready line is passed on, its log keeps it up, and it is stopped once idle, with the session reported as its work", async () => {
  const c = clock();
  const readies = [];
  let stopped = false;
  let say;
  let ticks = 0;
  const r = await runSession({
    readyLine: "ring member ready", idleMs: 60_000, maxMs: 3_300_000, now: c.now,
    sleep: async (ms) => { c.advance(ms); ticks += 1; if (ticks === 2) say("ring member ready: adk.demo@agentmesh.ai"); if (ticks === 20) say("lap 1 hop 2: ring.pass sent"); },
    ready: (o) => readies.push(o),
    start: async (onOutput) => { say = onOutput; return { died: new Promise(() => {}), busy: () => false, stop: async () => { stopped = true; } }; },
  });
  assert.equal(r.ok, true);
  assert.equal(r.ended, "idle");
  assert.equal(readies.length, 1);
  assert.equal(r.ready_ms, 4000);
  // Last line at tick 20 (40 s), then 60 s of nothing.
  assert.equal(r.session_ms, 100_000);
  assert.ok(stopped);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].kind, "wake");
  assert.equal(r.jobs[0].ms, 100_000);
  assert.equal(r.jobs[0].lines, 2);
});

test("a touch from the platform (more mail) keeps a session up; work under way does too", async () => {
  const c = clock();
  let touchedAt = 0;
  let ticks = 0;
  const r = await runSession({
    idleMs: 30_000, maxMs: 3_300_000, now: c.now,
    sleep: async (ms) => { c.advance(ms); ticks += 1; if (ticks === 10) touchedAt = c.now(); },
    touched: () => touchedAt,
    start: async () => ({ died: new Promise(() => {}), busy: () => ticks >= 20 && ticks < 40, stop: async () => {} }),
  });
  // Touched at 20 s, busy from 40 s until the look at 78 s, idle 30 s after.
  assert.equal(r.ended, "idle");
  assert.equal(r.session_ms, 108_000);
});

test("an agent that stops on its own ends the session as a failure", async () => {
  const c = clock();
  const r = await runSession({ idleMs: 30_000, maxMs: 3_300_000, now: c.now, sleep: c.sleep, start: async () => ({ died: Promise.resolve("1"), busy: () => false, stop: async () => {} }) });
  assert.equal(r.ok, false);
  assert.match(r.ended, /the agent stopped \(1\)/);
  assert.equal(r.jobs[0].ok, false);
});

async function post(port, path, auth) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { authorization: auth } }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end("{}");
  });
}

test("the wake door: refused to anyone but the waker, a wake answered in lines to its end, a touch never starts anything", async () => {
  let sessions = 0;
  let release;
  const server = wakeServer({
    waker: WAKER, log: () => {},
    session: ({ ready }) => { sessions += 1; ready({ ready: true, ready_ms: 900 }); return new Promise((r) => { release = r; }); },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    assert.equal((await post(port, "/wake", tokenFor("someone@example.com"))).status, 403);
    const idle = await post(port, "/wake?touch=1", tokenFor(WAKER));
    assert.equal(JSON.parse(idle.body).touched, false, "a touch while asleep starts nothing");
    assert.equal(sessions, 0);
    const woke = post(port, "/wake", tokenFor(WAKER));
    await new Promise((r) => setTimeout(r, 50));
    const joined = post(port, "/wake", tokenFor(WAKER));
    const touch = await post(port, "/wake?touch=1", tokenFor(WAKER));
    assert.equal(JSON.parse(touch.body).touched, true);
    await new Promise((r) => setTimeout(r, 50));
    release({ ok: true, ended: "idle", session_ms: 5, jobs: [] });
    const lines = (await woke).body.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines[0].taken, true);
    assert.equal(lines[1].ready, true);
    assert.equal(lines.at(-1).done, true);
    const other = (await joined).body.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(other[0].joined, true);
    assert.equal(other[1].ready, true, "a wake that joins is told the agent is already ready");
    assert.equal(sessions, 1, "one session for both wakes");
  } finally {
    server.close();
  }
});

test("the agent's own command is run with its output passed on line by line, and stopped", async () => {
  const lines = [];
  const a = startAgent({
    argv: [process.execPath, "-e", "console.log('ring member ready: x'); setInterval(() => {}, 1000)"],
    cwd: null, env: process.env, onOutput: (l) => lines.push(l), descendants: () => [],
  });
  const quiet = process.stdout.write;
  for (let i = 0; i < 100 && !lines.length; i++) await new Promise((r) => setTimeout(r, 30));
  process.stdout.write = quiet;
  assert.deepEqual(lines, ["ring member ready: x"]);
  assert.equal(a.busy(), false);
  await a.stop();
  assert.ok(await a.died);
});
