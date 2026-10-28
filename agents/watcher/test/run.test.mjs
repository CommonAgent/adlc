// The job as the runtime requirements start it: node, the run command's own
// arguments with the host's placeholders filled in, a job folder holding
// message.txt, the install's settings in the environment, a platform that
// answers the watcher's reads, and an agentmesh command that answers its
// questions. The package is laid out the way the builder lays it out, so a
// script missing from plugin.json fails here and not on a host.
//
// The first test is the role's own check (agentroles.ai/watcher.html, How a
// holder is checked): records for three named agents, one of which stopped
// answering and one of which crossed its ceiling. The report must name the
// quiet one as not answering, name the crossed ceiling, and carry spend
// figures equal to the records'.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACCOUNT, AGENT, FAKE_BIN, FIX, TOKEN, agentSpend, agentdoc, fakePlatform, host, json, spendReport, storefront } from "./helpers.mjs";
import { readRecords, windowAround } from "../../incident-recorder/scripts/read-records.mjs";
import { fromText } from "../../incident-recorder/scripts/record-incident.mjs";

const RUN = json(join(AGENT, "agent-runtime-requirements.json")).run["watch-the-fleet"];
const DESCRIPTOR = json(join(AGENT, "agent-descriptor.json"));

const A = "alpha.platform@agentmesh.ai";
const B = "bravo.platform@agentmesh.ai";
const C = "charlie.platform@agentmesh.ai";
const RECORDER = "incident-recorder.platform@agentmesh.ai";

function run(h, { id = "job-1", message = "", env = {} } = {}) {
  const jobDir = join(h.root, "jobs", id);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, "message.txt"), message);
  const fill = (s) => s.replaceAll("{home}", h.home).replaceAll("{package}", h.pkg)
    .replaceAll("{job_dir}", jobDir).replaceAll("{records}", h.records).replaceAll("{work}", h.work);
  const [cmd, ...args] = RUN.command.map(fill);
  assert.equal(cmd, "node");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, AGENTMESH_BIN: FAKE_BIN, FAKE_MESH: h.mesh, FAKE_MESH_LOG: h.log, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (status) => {
      let doc;
      assert.doesNotThrow(() => { doc = JSON.parse(out.trim()); }, `stdout is one JSON object, got: ${out}\n${err}`);
      resolve({ status, doc, jobDir, recordsDir: join(h.records, id) });
    });
  });
}

/** Three agents: alpha answers, bravo has gone quiet, charlie crossed its day ceiling. */
function threeAgents() {
  const spend = spendReport([
    agentSpend({ key: "UALPHA", handle: A, days: [{ day: "2026-10-27", jobs: [{ job: "job-a1", spent_micro: 20_000_000 }] }] }),
    agentSpend({ key: "UBRAVO", handle: B, days: [{ day: "2026-10-26", jobs: [{ job: "job-b1", spent_micro: 5_000_000 }] }] }),
    agentSpend({
      key: "UCHARLIE", handle: C, owner: "member-7",
      days: [{ day: "2026-10-27", jobs: [{ job: "job-c1", spent_micro: 90_000_000 }, { job: "job-c2", spent_micro: 60_000_000 }] }],
      allowed: { registered: true, valid: true, currency: "XCR", ceilings: [{ scope: "day", amount_micro: 100_000_000 }] },
      against: [{ scope: "day", ceiling_micro: 100_000_000, checked: 1, over: [{ day: "2026-10-27", spent_micro: 150_000_000 }] }],
    }),
  ]);
  return {
    cards: { [A]: storefront(A, { key: "UALPHA" }), [B]: storefront(B, { key: "UBRAVO" }), [C]: storefront(C, { key: "UCHARLIE" }) },
    records: { [A]: { runs: 4, failed: 0, average_seconds: 30, window_days: 30 }, [B]: { runs: 2, failed: 1, average_seconds: 40, window_days: 30 }, [C]: { runs: 9, failed: 0, average_seconds: 50, window_days: 30 } },
    docs: { [A]: agentdoc(A, { job_seconds: { most: 120 } }), [B]: agentdoc(B, { job_seconds: { most: 120 } }), [C]: agentdoc(C) },
    spend,
  };
}

test("the role's check: the quiet one is not answering, the crossed ceiling is named, the figures are the records'", async () => {
  const world = threeAgents();
  const p = await fakePlatform(world);
  try {
    const h = host({ [B]: "silent" });
    const r = await run(h, { env: { WATCH_AGENTS: `${A}, ${B}, ${C}`, MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN, INCIDENT_RECORDER: RECORDER, ANSWER_SECONDS: "5" } });
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    const md = readFileSync(join(r.jobDir, "out", "watch-report.md"), "utf8");
    // The header.
    assert.match(md, /^# Watch report\n\nwatched_by: watcher 0\.1\.0\n/);
    assert.match(md, /^agents: 3$/m);
    assert.match(md, /^answering: 2$/m);
    assert.match(md, /^open_alerts: 2$/m);
    assert.match(md, /^spend_total: 175 XCR$/m);
    assert.match(md, /^reconciles: yes$/m);
    // The quiet one, named as not answering.
    assert.match(md, new RegExp(`^\\| ${B.replace(/\./g, "\\.")} \\| yes \\| no \\| yes \\| not answering: it did not answer within 5s \\|$`, "m"));
    // The crossed ceiling, named.
    assert.match(md, /charlie\.platform@agentmesh\.ai: over its 100 XCR per day ceiling 1 time of 1 measured: 150 XCR on 2026-10-27/);
    assert.match(md, new RegExp(`^\\| ${C.replace(/\./g, "\\.")} \\| yes \\| yes \\| no \\| outside its limits: 150 XCR spent on 2026-10-27, over its 100 XCR per day ceiling \\|$`, "m"));
    // The figures equal the records', job by job.
    for (const [job, xcr] of [["job-a1", 20], ["job-b1", 5], ["job-c1", 90], ["job-c2", 60]]) assert.match(md, new RegExp(`\\| \`${job}\` \\| ${xcr} XCR \\|`));
    assert.match(md, /^\| XCR \| 175 XCR \| 175 XCR \| 0 XCR \|$/m);
    // Both alarms went to the incident recorder, and only those two.
    const sends = readFileSync(h.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const raised = sends.filter((s) => s.to === RECORDER);
    assert.deepEqual(raised.map((s) => fromText(s.text).agent).sort(), [B, C]);
    assert.deepEqual(sends.filter((s) => s.to !== RECORDER).map((s) => s.text), Array(3).fill("agentmesh-worker/v1\nstatus"));
    assert.match(r.doc.reply, /2 alerts are open/);
    assert.match(r.doc.reply, /2 alarms were raised to incident-recorder\.platform@agentmesh\.ai/);
  } finally { await p.close(); }
});

test("an alarm is read by the incident recorder as it stands: its agent, its time and every line in its window", async () => {
  const world = threeAgents();
  const p = await fakePlatform(world);
  try {
    const h = host({ [B]: "silent" });
    const r = await run(h, { env: { WATCH_AGENTS: B, MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN, INCIDENT_RECORDER: RECORDER, ANSWER_SECONDS: "5" } });
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    const send = readFileSync(h.log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((s) => s.to === RECORDER);
    const asked = fromText(send.text);
    assert.equal(asked.agent, B);
    assert.ok(!Number.isNaN(new Date(asked.time).getTime()));
    const dir = join(h.root, "recorder-in");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, send.files.split(/[\\/]/).pop()), readFileSync(send.files));
    const got = await readRecords({ recordsDir: dir, agent: asked.agent, failureTime: asked.time, ...windowAround(asked.time) });
    assert.equal(got.files[0].origin, "platform");
    assert.deepEqual(got.unreadable, []);
    assert.ok(got.events.some((e) => /did not answer within 5s/.test(e.fact)), JSON.stringify(got.events));
    assert.ok(got.events.some((e) => /opened an alert/.test(e.fact)));
    // The pieces carry the same file.
    const pieces = json(join(r.jobDir, "pieces.json"));
    assert.deepEqual(pieces.map((x) => x.media_type), ["text/markdown", "application/vnd.agentmesh.watch-record+json", "application/x-ndjson"]);
  } finally { await p.close(); }
});

test("the pieces it files are the outputs the descriptor declares, with the declared kinds", async () => {
  const world = threeAgents();
  const p = await fakePlatform(world);
  try {
    const h = host({ [B]: "silent" });
    const r = await run(h, { env: { WATCH_AGENTS: `${A},${B}`, MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN } });
    assert.equal(r.status, 0);
    const declared = new Map(DESCRIPTOR.offerings[0].outputs.map((o) => [o.name, o.kind]));
    for (const piece of json(join(r.jobDir, "pieces.json"))) {
      const name = piece.name.replace(/ \(.*\)$/, "");
      assert.equal(declared.get(name), piece.media_type, piece.name);
      assert.ok(existsSync(join(r.jobDir, piece.path)), piece.path);
    }
    // No recorder named: the alarm is handed back, and the reply says so.
    assert.match(r.doc.reply, /not raised to an incident recorder/);
    for (const f of ["watch-record.json", "watch-report.md", "raised.json", "went-without.json"]) assert.ok(existsSync(join(r.recordsDir, f)), f);
  } finally { await p.close(); }
});

test("with no agent named it watches nothing and says how the owner names them", async () => {
  const h = host();
  const r = await run(h, { env: { WATCH_AGENTS: "" } });
  assert.equal(r.status, 3);
  assert.match(r.doc.reply, /No agents are named to watch\..*WATCH_AGENTS/);
  assert.equal(existsSync(join(r.jobDir, "pieces.json")), false);
});

test("a message narrows the watch and cannot widen it", async () => {
  const world = threeAgents();
  const p = await fakePlatform(world);
  try {
    const h = host();
    const r = await run(h, { message: `agent: ${A}\nagent: stranger.someone@example.com\n`, env: { WATCH_AGENTS: `${A},${B}`, MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN } });
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    const rec = json(join(r.recordsDir, "watch-record.json"));
    assert.deepEqual(rec.agents.map((a) => a.handle), [A]);
    assert.match(r.doc.reply, /stranger\.someone@example\.com on the watch list/);
    const sends = readFileSync(h.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(sends.map((s) => s.to), [A]);
    assert.ok(!p.seen.some((s) => s.path.includes("stranger")));
  } finally { await p.close(); }
});

test("an agent held at its door has no current answer, keeps an open alert, and is not raised as an incident", async () => {
  const world = threeAgents();
  const p = await fakePlatform(world);
  try {
    const h = host({ [A]: "held" });
    const r = await run(h, { env: { WATCH_AGENTS: A, MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN, INCIDENT_RECORDER: RECORDER } });
    assert.equal(r.status, 0);
    const md = readFileSync(join(r.jobDir, "out", "watch-report.md"), "utf8");
    assert.match(md, /no current answer: the question was held at its door for its owner/);
    assert.match(md, /Not raised to the incident recorder: the watcher could not ask this agent/);
    const sends = readFileSync(h.log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(sends.filter((s) => s.to === RECORDER).length, 0);
  } finally { await p.close(); }
});

test("an agent that is down is not alive, and its alarm goes to the recorder", async () => {
  const world = threeAgents();
  world.cards[A] = storefront(A, { key: "UALPHA", availability: "offline" });
  const p = await fakePlatform(world);
  try {
    const h = host({ [A]: "silent" });
    const r = await run(h, { env: { WATCH_AGENTS: A, MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN, INCIDENT_RECORDER: RECORDER, ANSWER_SECONDS: "5" } });
    const rec = json(join(r.recordsDir, "watch-record.json"));
    assert.equal(rec.agents[0].alive.state, "no");
    assert.deepEqual(rec.agents[0].alert.reasons, ["not alive: the registry says it is offline", "not answering: it did not answer within 5s"]);
    assert.equal(rec.alerts[0].sent, true);
  } finally { await p.close(); }
});

test("a stranger on the list costs only its own spend, and a key that can do more than read is said", async () => {
  const world = threeAgents();
  world.strangers = [C];
  world.scopes = ["credits"];
  const p = await fakePlatform(world);
  try {
    const h = host();
    const r = await run(h, { env: { WATCH_AGENTS: `${A},${C}`, MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN } });
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    assert.match(r.doc.reply, /the key placed also carries credits, which can do more than read/);
    const md = readFileSync(join(r.jobDir, "out", "watch-report.md"), "utf8");
    assert.match(md, /What charlie\.platform@agentmesh\.ai spent: the platform says it is not one of the read key's account's agents\./);
    const asks = p.seen.filter((s) => s.path.endsWith("/spend-report"));
    assert.equal(asks.length, 2);
    assert.match(decodeURIComponent(asks[1].query), new RegExp(`agents=${A.replace(/\./g, "\\.")}$`));
  } finally { await p.close(); }
});

test("it reads the real dev spend report and reconciles it, naming what traces to no job", async () => {
  const spend = json(join(FIX, "spend-report.dev-2026-10-28.json"));
  const key = spend.agents[0].agent;
  const handle = "hire-buyer.test@agentmesh.ai";
  const card = json(join(FIX, "storefront.incident-recorder.dev.json"));
  card.agent_id = key; card.card.card.handle = handle;
  const p = await fakePlatform({ cards: { [handle]: card }, records: { [handle]: json(join(FIX, "record.incident-recorder.dev.json")) }, docs: { [handle]: agentdoc(handle) }, spend });
  try {
    const h = host();
    const r = await run(h, { env: { WATCH_AGENTS: handle, MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN } });
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    const md = readFileSync(join(r.jobDir, "out", "watch-report.md"), "utf8");
    assert.match(md, /^spend_total: 1980 XCR$/m);
    assert.match(md, /^every_spend_traced: no$/m);
    assert.match(md, /^reconciles: yes$/m);
    assert.match(md, /1650 XCR traces to no job: accounted before the platform kept a line per job/);
    assert.match(md, /\| `credits:f7364c40-d49d-4f68-bf07-e9a14fc86ad0:01a180c4-602d-7000-ba95-9fb26203d8c9` \| 330 XCR \|/);
    assert.equal(ACCOUNT, json(join(r.recordsDir, "watch-record.json")).account);
  } finally { await p.close(); }
});
