// The job as the runtime requirements start it, for every message the watcher
// gets: node, the run command's own arguments with the host's placeholders
// filled in (the sender, what the message replies to, its id), a job folder
// holding message.txt, the install's settings in the environment, and a
// platform on a local port that answers the watcher's reads. What a job leaves
// for the host to send is read from its out/outbox.jsonl, and the answers the
// watched agents would send back are run as the host runs them: a message of
// their own, in reply. The package is laid out the way the builder lays it
// out, so a script missing from plugin.json fails here and not on a host.
//
// The first test is the role's own check (agentroles.ai/watcher.html, How a
// holder is checked): records for three named agents, one of which stopped
// answering and one of which crossed its ceiling. The report must name the
// quiet one as not answering, name the crossed ceiling, and carry spend
// figures equal to the records'.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACCOUNT, AGENT, FIX, TOKEN, ageOpenRound, agentSpend, agentdoc, fakePlatform, host, json, keyFor, runJob, spendReport, storefront } from "./helpers.mjs";
import { STATUS_TEXT } from "../scripts/ask.mjs";
import { readRecords, windowAround } from "../../incident-recorder/scripts/read-records.mjs";
import { fromText } from "../../incident-recorder/scripts/record-incident.mjs";

const DESCRIPTOR = json(join(AGENT, "agent-descriptor.json"));

const A = "alpha.platform@agentmesh.ai";
const B = "bravo.platform@agentmesh.ai";
const C = "charlie.platform@agentmesh.ai";
const OWNER = "owner.platform@agentmesh.ai";
const RECORDER = "incident-recorder.platform@agentmesh.ai";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STATUS = (job = "job-7") => JSON.stringify({ interface: "interface-worker", exchange: "status", job, state: "done", detail: "finished" });

/** Three agents: alpha answers, bravo has gone quiet, charlie crossed its day ceiling. */
function threeAgents() {
  const spend = spendReport([
    agentSpend({ key: keyFor(A), handle: A, days: [{ day: "2026-10-27", jobs: [{ job: "job-a1", spent_micro: 20_000_000 }] }] }),
    agentSpend({ key: keyFor(B), handle: B, days: [{ day: "2026-10-26", jobs: [{ job: "job-b1", spent_micro: 5_000_000 }] }] }),
    agentSpend({
      key: keyFor(C), handle: C, owner: "member-7",
      days: [{ day: "2026-10-27", jobs: [{ job: "job-c1", spent_micro: 90_000_000 }, { job: "job-c2", spent_micro: 60_000_000 }] }],
      allowed: { registered: true, valid: true, currency: "XCR", ceilings: [{ scope: "day", amount_micro: 100_000_000 }] },
      against: [{ scope: "day", ceiling_micro: 100_000_000, checked: 1, over: [{ day: "2026-10-27", spent_micro: 150_000_000 }] }],
    }),
  ]);
  return {
    cards: { [A]: storefront(A), [B]: storefront(B), [C]: storefront(C), [OWNER]: storefront(OWNER), [RECORDER]: storefront(RECORDER) },
    records: { [A]: { runs: 4, failed: 0, average_seconds: 30, window_days: 30 }, [B]: { runs: 2, failed: 1, average_seconds: 40, window_days: 30 }, [C]: { runs: 9, failed: 0, average_seconds: 50, window_days: 30 } },
    docs: { [A]: agentdoc(A, { job_seconds: { most: 120 } }), [B]: agentdoc(B, { job_seconds: { most: 120 } }), [C]: agentdoc(C) },
    spend,
  };
}

const envOf = (p, more = {}) => ({ MESH_API_BASE: p.base, WATCH_TOKEN: TOKEN, INCIDENT_RECORDER: RECORDER, ANSWER_SECONDS: "60", ...more });

/** Run each question a job left as the agent would answer it, when `answers(handle)` gives words. */
async function answer(h, outbox, env, answers) {
  const out = [];
  for (const line of outbox.filter((l) => l.text === STATUS_TEXT)) {
    const said = answers(line.handle);
    if (said === null) continue;
    out.push(await runJob(h, { from: line.handle, inReplyTo: `m-${line.ref}`, message: said, env }));
  }
  return out;
}

test("the role's check: the quiet one is not answering, the crossed ceiling is named, the figures are the records'", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: `${A}, ${B}, ${C}` });
    // The request opens a round: three questions, in one thread, to the agents' ids.
    const ask = await runJob(h, { from: OWNER, env });
    assert.equal(ask.status, 0, JSON.stringify(ask.doc));
    assert.deepEqual(ask.outbox.map((l) => [l.handle, l.to, l.text]), [A, B, C].map((x) => [x, keyFor(x), STATUS_TEXT]));
    assert.equal(new Set(ask.outbox.map((l) => l.thread)).size, 1);
    assert.match(ask.doc.reply, /I asked 3 agents the worker interface's status/);
    assert.equal(existsSync(join(ask.jobDir, "pieces.json")), false, "nothing is delivered before the answers");
    // Alpha and charlie answer; bravo does not.
    const answered = await answer(h, ask.outbox, env, (who) => (who === B ? null : STATUS()));
    assert.match(answered[0].doc.reply, /Recorded the answer from alpha.*2 agents have not answered yet/);
    // Asked again before the wait is over: nobody is asked twice.
    const early = await runJob(h, { from: OWNER, env });
    assert.match(early.doc.reply, /has heard from 2\. Its report goes to whoever asked for it when every one has answered, or when the wait is over at/);
    assert.deepEqual(early.outbox, []);
    // After the wait: the round closes, its report is this job's pieces, and the next round asks.
    ageOpenRound(h, 120);
    const r = await runJob(h, { from: OWNER, env });
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    const md = readFileSync(join(r.jobDir, "out", "watch-report.md"), "utf8");
    assert.match(md, /^# Watch report\n\nwatched_by: watcher 0\.1\.4\n/);
    assert.match(md, /^agents: 3$/m);
    assert.match(md, /^answering: 2$/m);
    assert.match(md, /^open_alerts: 2$/m);
    assert.match(md, /^spend_total: 175 XCR$/m);
    assert.match(md, /^reconciles: yes$/m);
    // The quiet one, named as not answering.
    assert.match(md, new RegExp(`^\\| ${esc(B)} \\| yes \\| no \\| yes \\| not answering: it did not answer within 60s \\|$`, "m"));
    // The crossed ceiling, named.
    assert.match(md, /charlie\.platform@agentmesh\.ai: over its 100 XCR per day ceiling 1 time of 1 measured: 150 XCR on 2026-10-27/);
    assert.match(md, new RegExp(`^\\| ${esc(C)} \\| yes \\| yes \\| no \\| outside its limits: 150 XCR spent on 2026-10-27, over its 100 XCR per day ceiling \\|$`, "m"));
    // The figures equal the records', job by job.
    for (const [job, xcr] of [["job-a1", 20], ["job-b1", 5], ["job-c1", 90], ["job-c2", 60]]) assert.match(md, new RegExp(`\\| \`${job}\` \\| ${xcr} XCR \\|`));
    assert.match(md, /^\| XCR \| 175 XCR \| 175 XCR \| 0 XCR \|$/m);
    // Both alarms go to the incident recorder, each with its file, and the next round asks again.
    const toRecorder = r.outbox.filter((l) => l.to === keyFor(RECORDER));
    assert.deepEqual(toRecorder.map((l) => fromText(l.text).agent).sort(), [B, C]);
    for (const l of toRecorder) assert.ok(existsSync(l.files[0].path), l.files[0].path);
    assert.equal(r.outbox.filter((l) => l.text === STATUS_TEXT).length, 3);
    assert.match(r.doc.reply, /2 alerts are open/);
    assert.match(r.doc.reply, /2 alarms go to incident-recorder\.platform@agentmesh\.ai as this job ends/);
    assert.match(r.doc.reply, /has asked again/);
  } finally { await p.close(); }
});

test("when every agent answers, the round closes on the last answer and its report goes to whoever asked", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: `${A}, ${C}` });
    const ask = await runJob(h, { from: OWNER, env });
    const answered = await answer(h, ask.outbox, env, () => STATUS());
    const last = answered[answered.length - 1];
    assert.match(last.doc.reply, /every agent asked in watch .* has answered, so it is closed\. Its report goes to owner\.platform@agentmesh\.ai as this job ends\./);
    const toOwner = last.outbox.find((l) => l.to === keyFor(OWNER));
    assert.ok(toOwner, JSON.stringify(last.outbox));
    assert.deepEqual(toOwner.files.map((f) => [f.name, f.media_type]), [["watch-report.md", "text/markdown"], ["watch-record.json", "application/vnd.agentmesh.watch-record+json"]]);
    assert.match(readFileSync(toOwner.files[0].path, "utf8"), /^answering: 2$/m);
    // Its reply goes to the agent that answered, and carries no pieces.
    assert.equal(existsSync(join(last.jobDir, "pieces.json")), false);
    // Charlie is over its ceiling, so its alarm goes too.
    assert.equal(last.outbox.filter((l) => l.to === keyFor(RECORDER)).length, 1);
  } finally { await p.close(); }
});

test("an alarm is read by the incident recorder as it stands: its agent, its time and every line in its window", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: B });
    await runJob(h, { from: OWNER, env });
    ageOpenRound(h, 61);
    const r = await runJob(h, { from: OWNER, env });
    const line = r.outbox.find((l) => l.to === keyFor(RECORDER));
    const asked = fromText(line.text);
    assert.equal(asked.agent, B);
    const dir = join(h.root, "recorder-in");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, line.files[0].name), readFileSync(line.files[0].path));
    const got = await readRecords({ recordsDir: dir, agent: asked.agent, failureTime: asked.time, ...windowAround(asked.time) });
    assert.equal(got.files[0].origin, "platform");
    assert.deepEqual(got.unreadable, []);
    assert.ok(got.events.some((e) => /did not answer within 60s/.test(e.fact)), JSON.stringify(got.events));
    assert.ok(got.events.some((e) => /asked it the worker interface's status/.test(e.fact)));
    assert.ok(got.events.some((e) => /opened an alert/.test(e.fact)));
    const pieces = json(join(r.jobDir, "pieces.json"));
    assert.deepEqual(pieces.map((x) => x.media_type), ["text/markdown", "application/vnd.agentmesh.watch-record+json", "application/x-ndjson"]);
  } finally { await p.close(); }
});

test("the pieces it files are the outputs the descriptor declares, with the declared kinds", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: `${A},${B}`, INCIDENT_RECORDER: "" });
    await runJob(h, { env });
    ageOpenRound(h, 61);
    const r = await runJob(h, { env });
    const declared = new Map(DESCRIPTOR.offerings[0].outputs.map((o) => [o.name, o.kind]));
    for (const piece of json(join(r.jobDir, "pieces.json"))) {
      assert.equal(declared.get(piece.name.replace(/ \(.*\)$/, "")), piece.media_type, piece.name);
      assert.ok(existsSync(join(r.jobDir, piece.path)), piece.path);
    }
    // No recorder named: the alarms are handed back, and the reply says so.
    assert.match(r.doc.reply, /not raised to an incident recorder/);
    for (const f of ["watch-record.json", "watch-report.md", "raised.json", "went-without.json"]) assert.ok(existsSync(join(r.recordsDir, f)), f);
  } finally { await p.close(); }
});

test("with no agent named it watches nothing and says how the owner names them", async () => {
  const h = host();
  const r = await runJob(h, { env: { WATCH_AGENTS: "" } });
  assert.equal(r.status, 3);
  assert.match(r.doc.reply, /No agents are named to watch\..*WATCH_AGENTS/);
  assert.deepEqual(r.outbox, []);
});

test("a message narrows the watch and cannot widen it", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const r = await runJob(h, { message: `agent: ${A}\nagent: stranger.someone@example.com\n`, env: envOf(p, { WATCH_AGENTS: `${A},${B}` }) });
    assert.equal(r.status, 0, JSON.stringify(r.doc));
    assert.deepEqual(r.outbox.map((l) => l.handle), [A]);
    assert.match(r.doc.reply, /stranger\.someone@example\.com on the watch list/);
    assert.ok(!p.seen.some((s) => s.path.includes("stranger")));
  } finally { await p.close(); }
});

test("an answer from an agent nobody asked is not recorded", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: A });
    await runJob(h, { env });
    const r = await runJob(h, { from: "someone.else@example.com", inReplyTo: "req-x", message: STATUS(), env });
    assert.match(r.doc.reply, /answers nothing an open watch asked/);
  } finally { await p.close(); }
});

test("an agent the platform does not know is not alive, cannot be asked, and is raised for being down", async () => {
  const world = threeAgents();
  world.cards[A] = 404;
  const p = await fakePlatform(world);
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: `${A},${C}` });
    const ask = await runJob(h, { env });
    assert.deepEqual(ask.outbox.map((l) => l.handle), [C]);
    assert.match(ask.doc.reply, /could not ask alpha\.platform@agentmesh\.ai/);
    ageOpenRound(h, 61);
    const r = await runJob(h, { env });
    const rec = json(join(r.recordsDir, "watch-record.json"));
    const a = rec.agents.find((x) => x.handle === A);
    assert.equal(a.alive.state, "no");
    assert.equal(a.answering.state, "unknown");
    assert.equal(a.alert.raise, true);
  } finally { await p.close(); }
});

test("an agent that is down is not alive, and its alarm goes to the recorder", async () => {
  const world = threeAgents();
  world.cards[A] = storefront(A, { availability: "offline" });
  const p = await fakePlatform(world);
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: A });
    await runJob(h, { env });
    ageOpenRound(h, 61);
    const r = await runJob(h, { env });
    const rec = json(join(r.recordsDir, "watch-record.json"));
    assert.equal(rec.agents[0].alive.state, "no");
    assert.deepEqual(rec.agents[0].alert.reasons, ["not alive: the registry says it is offline", "not answering: it did not answer within 60s"]);
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
    const env = envOf(p, { WATCH_AGENTS: `${A},${C}` });
    await runJob(h, { env });
    ageOpenRound(h, 61);
    const r = await runJob(h, { env });
    assert.match(r.doc.reply, /the key placed also carries credits, which can do more than read/);
    const md = readFileSync(join(r.jobDir, "out", "watch-report.md"), "utf8");
    assert.match(md, /What charlie\.platform@agentmesh\.ai spent: the platform did not report it \(charlie\.platform@agentmesh\.ai is not one of this account's agents\)\./);
    const asks = p.seen.filter((s) => s.path.endsWith("/spend-report"));
    assert.match(decodeURIComponent(asks[1].query), new RegExp(`agents=${esc(A)}$`));
  } finally { await p.close(); }
});

test("it reads the real dev spend report and reconciles it, naming what traces to no job", async () => {
  const spend = json(join(FIX, "spend-report.dev-2026-10-28.json"));
  const key = spend.agents[0].agent;
  const handle = "hire-buyer.test@agentmesh.ai";
  const card = json(join(FIX, "storefront.incident-recorder.dev.json"));
  card.agent_id = key; card.card.card.handle = handle;
  const p = await fakePlatform({ cards: { [handle]: card, [OWNER]: storefront(OWNER) }, records: { [handle]: json(join(FIX, "record.incident-recorder.dev.json")) }, docs: { [handle]: agentdoc(handle) }, spend });
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: handle, INCIDENT_RECORDER: "" });
    const ask = await runJob(h, { from: OWNER, env });
    const [closed] = await answer(h, ask.outbox, env, () => STATUS());
    const md = readFileSync(join(closed.jobDir, "out", "watch-report.md"), "utf8");
    assert.match(md, /^spend_total: 1980 XCR$/m);
    assert.match(md, /^every_spend_traced: no$/m);
    assert.match(md, /^reconciles: yes$/m);
    assert.match(md, /1650 XCR traces to no job: accounted before the platform kept a line per job/);
    assert.match(md, /\| `credits:f7364c40-d49d-4f68-bf07-e9a14fc86ad0:01a180c4-602d-7000-ba95-9fb26203d8c9` \| 330 XCR \|/);
    assert.equal(json(join(closed.jobDir, "out", "watch-record.json")).account, ACCOUNT);
  } finally { await p.close(); }
});

test("an alert stays open from one watch to the next and is raised once; a new reason raises it again; a clear watch closes it", async () => {
  const world = threeAgents();
  const p = await fakePlatform(world);
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: B });
    const raisedIn = (r) => r.outbox.filter((l) => l.to === keyFor(RECORDER)).length;
    await runJob(h, { from: OWNER, env });
    ageOpenRound(h, 61);
    assert.equal(raisedIn(await runJob(h, { from: OWNER, env })), 1);
    ageOpenRound(h, 61);
    const second = await runJob(h, { from: OWNER, env });
    assert.equal(raisedIn(second), 0, "not raised again");
    assert.match(readFileSync(join(second.jobDir, "out", "watch-report.md"), "utf8"), /Still open since .*: raised to the incident recorder incident-recorder\.platform@agentmesh\.ai at .*\. Nothing new has been seen, so it was not raised again\./);
    // A new reason: it is down as well.
    world.cards[B] = storefront(B, { availability: "offline" });
    ageOpenRound(h, 61);
    const third = await runJob(h, { from: OWNER, env });
    assert.equal(raisedIn(third), 1);
    // Clear: it is up, and it answers the question the third request asked.
    world.cards[B] = storefront(B);
    ageOpenRound(h, 61);
    const fourth = await runJob(h, { from: OWNER, env });
    const [closed] = await answer(h, fourth.outbox, env, () => STATUS());
    assert.match(closed.doc.reply, /so it is closed/);
    assert.deepEqual(json(join(h.records, "open-alerts.json")).agents, {});
  } finally { await p.close(); }
});

const SELF = "watcher.platform@agentmesh.ai";

test("a round closes itself when the wait is over: it sends itself a message whose job waits out the wait", async () => {
  const world = threeAgents();
  world.cards[SELF] = storefront(SELF);
  const p = await fakePlatform(world);
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: `${A},${B}`, MESH_SELF_HANDLE: SELF });
    const ask = await runJob(h, { from: OWNER, env });
    const close = ask.outbox.find((l) => l.to === keyFor(SELF));
    assert.ok(close, JSON.stringify(ask.outbox));
    assert.match(ask.doc.reply, /or when the wait is over in 60 seconds, whichever is first/);
    await answer(h, ask.outbox, env, (who) => (who === A ? STATUS() : null));
    // Somebody else cannot close it.
    const forged = await runJob(h, { from: "someone.else@example.com", message: close.text, env });
    assert.match(forged.doc.reply, /Only this watcher closes its own watches/);
    ageOpenRound(h, 61);
    const r = await runJob(h, { from: SELF, message: close.text, env });
    assert.match(r.doc.reply, /The wait for watch .* is over, so it is closed\. Its report goes to owner\.platform@agentmesh\.ai as this job ends\./);
    const toOwner = r.outbox.find((l) => l.to === keyFor(OWNER));
    assert.match(readFileSync(toOwner.files[0].path, "utf8"), new RegExp(`^\| ${esc(B)} \| yes \| no \| `, "m"));
    assert.equal(r.outbox.filter((l) => l.to === keyFor(RECORDER)).length, 1);
    // Closed once: a second close does nothing.
    const again = await runJob(h, { from: SELF, message: close.text, env });
    assert.match(again.doc.reply, /had already closed/);
  } finally { await p.close(); }
});

test("an answer is matched by what it replies to once the host has said what each question went out as", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: `${A},${B}` });
    const ask = await runJob(h, { from: OWNER, env });
    // The host writes what each line went out as, beside the outbox.
    writeFileSync(join(ask.jobDir, "out", "outbox.sent.jsonl"), ask.outbox.map((l) => JSON.stringify({ to: l.handle, message_id: `m-${l.handle}`, ref: l.ref })).join("\n") + "\n");
    const stray = await runJob(h, { from: A, inReplyTo: "m-something-else", message: STATUS(), env });
    assert.match(stray.doc.reply, /answers nothing an open watch asked/);
    const right = await runJob(h, { from: "a-name-the-host-used", inReplyTo: `m-${A}`, message: "any words at all", env });
    assert.match(right.doc.reply, /Recorded the answer from alpha/);
  } finally { await p.close(); }
});

test("a question the host could not send is a gap in the watch, not the agent's silence, and is not raised", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: B });
    const ask = await runJob(h, { from: OWNER, env });
    writeFileSync(join(ask.jobDir, "out", "outbox.sent.jsonl"), JSON.stringify({ to: B, message_id: null, error: "REFUSED: not admitted", ref: ask.outbox[0].ref }) + "\n");
    ageOpenRound(h, 61);
    const r = await runJob(h, { from: OWNER, env });
    const rec = json(join(r.recordsDir, "watch-record.json"));
    assert.equal(rec.agents[0].answering.state, "unknown");
    assert.match(rec.agents[0].answering.why, /REFUSED: not admitted/);
    assert.equal(r.outbox.filter((l) => l.to === keyFor(RECORDER)).length, 0);
  } finally { await p.close(); }
});

test("a round another requester closes still reports to whoever asked for it", async () => {
  const world = threeAgents();
  const OTHER = "scheduler.platform@agentmesh.ai";
  world.cards[OTHER] = storefront(OTHER);
  const p = await fakePlatform(world);
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: B });
    await runJob(h, { from: OWNER, env });
    ageOpenRound(h, 61);
    const r = await runJob(h, { from: OTHER, env });
    assert.ok(r.outbox.some((l) => l.to === keyFor(OWNER) && l.files?.length === 2), JSON.stringify(r.outbox));
    assert.ok(existsSync(join(r.jobDir, "pieces.json")));
  } finally { await p.close(); }
});

test("a round whose questions the host never sent (a deployment's own check) reports a gap, not every agent silent", async () => {
  const p = await fakePlatform(threeAgents());
  try {
    const h = host();
    const env = envOf(p, { WATCH_AGENTS: `${A},${B}` });
    await runJob(h, { from: "deployment-manager", env, hostSends: false });
    ageOpenRound(h, 61);
    const r = await runJob(h, { from: OWNER, env });
    const rec = json(join(r.recordsDir, "watch-record.json"));
    for (const a of rec.agents) assert.equal(a.answering.state, "unknown", a.handle);
    assert.match(rec.agents[0].answering.why, /the question was never sent: the host never said it sent the question/);
    assert.equal(r.outbox.filter((l) => l.to === keyFor(RECORDER)).length, 0);
  } finally { await p.close(); }
});
