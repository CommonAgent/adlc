// The decisions, one at a time: who is watched, what an answer is, what each
// limit is held against, and whether the spend adds up.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { watchList, windowOf, namesIn } from "../scripts/watch-list.mjs";
import { readSendOutput, readAnswer, STATUS_TEXT } from "../scripts/ask.mjs";
import { checkAgent } from "../scripts/checks.mjs";
import { readSpend, moneyWords } from "../scripts/spend.mjs";
import { readRaise } from "../scripts/raise.mjs";
import { alarmFor, alarmFileName } from "../scripts/alarms.mjs";
import { FIX, agentSpend, agentdoc, json, spendReport, storefront } from "./helpers.mjs";

const A = "alpha.platform@agentmesh.ai";
const read = (body, extra = {}) => ({ ok: true, status: 200, body, url: "https://p/x", at: "2026-10-28T06:00:00.000Z", ...extra });
const answered = (reply = { interface: "interface-worker", exchange: "status", job: "j1", state: "done", detail: "ok" }) => ({ handle: A, sent_at: "2026-10-28T06:00:00.000Z", answered_at: "2026-10-28T06:00:01.000Z", seconds: 1, outcome: "answered", reply: JSON.stringify(reply) });

test("the watch list is the owner's, in order; a message narrows it and never widens it", () => {
  assert.deepEqual(namesIn(`${A}, b.x@y.com\nb.x@y.com  ${A}`), [A, "b.x@y.com"]);
  assert.deepEqual(watchList({ setting: `${A},b.x@y.com` }).agents, [A, "b.x@y.com"]);
  const n = watchList({ setting: `${A},b.x@y.com`, text: "Please.\nagent: b.x@y.com\nagent: c.x@y.com\n" });
  assert.deepEqual(n.agents, ["b.x@y.com"]);
  assert.deepEqual(n.refused, ["c.x@y.com"]);
  assert.deepEqual(watchList({ setting: "not-a-handle, spec.writer.platform@agentmesh.ai" }), { agents: ["spec.writer.platform@agentmesh.ai"], refused: [], malformed: ["not-a-handle"], narrowed: false });
  // A handle mentioned in passing is not a line naming it.
  assert.equal(watchList({ setting: A, text: `how is ${A}?` }).narrowed, false);
});

test("the spend window is read from lines of its own, and a bad day is said", () => {
  assert.deepEqual(windowOf("from: 2026-10-01\nto: 2026-10-28"), { from: "2026-10-01", to: "2026-10-28", bad: [] });
  assert.deepEqual(windowOf("from: last week"), { from: null, to: null, bad: ["last week"] });
});

test("the question is the worker interface's status, and every shape the send prints is read", () => {
  assert.equal(STATUS_TEXT, "agentmesh-worker/v1\nstatus");
  assert.equal(readSendOutput({ stdout: "resolved x\n" + JSON.stringify({ reply: "{}", in_reply_to: "r1" }) }).outcome, "answered");
  assert.equal(readSendOutput({ stdout: JSON.stringify({ status: "answered", reply: "hi" }, null, 2) }).outcome, "answered");
  assert.deepEqual(readSendOutput({ stdout: JSON.stringify({ queued: true, no_reply_within: 60 }) }), { outcome: "silent", request_id: null, why: "no answer within 60s" });
  assert.equal(readSendOutput({ stdout: JSON.stringify({ status: "queued_offline", note: "kept" }) }).outcome, "silent");
  assert.equal(readSendOutput({ stdout: JSON.stringify({ status: "held", delivered: false }) }).outcome, "held");
  assert.equal(readSendOutput({ stdout: JSON.stringify({ ok: false, delivered: false, code: "BLOCKED", error: "no" }) }).outcome, "refused");
  assert.equal(readSendOutput({ status: 1, stdout: "", stderr: "boom" }).outcome, "not-sent");
  assert.deepEqual(readAnswer(JSON.stringify({ interface: "interface-worker", exchange: "status", job: "j", state: "working", detail: "running for 5s" })), { worker: true, job: "j", state: "working", detail: "running for 5s" });
  assert.deepEqual(readAnswer("I am fine"), { worker: false, words: "I am fine" });
});

test("presence is alive or not, and a storefront with none says not known", () => {
  const base = { named: A, record: read({ runs: 0 }), agentdoc: read(agentdoc(A)), asked: answered() };
  assert.equal(checkAgent({ ...base, card: read(storefront(A)) }).alive.state, "yes");
  assert.equal(checkAgent({ ...base, card: read(storefront(A, { availability: "offline" })) }).alive.state, "no");
  assert.equal(checkAgent({ ...base, card: read(storefront(A, { availability: null })) }).alive.state, "unknown");
  const gone = checkAgent({ ...base, card: { ok: false, status: 404, url: "u", at: "t", error: "unknown handle" } });
  assert.equal(gone.alive.state, "no");
  assert.deepEqual(gone.alert.reasons, ["not alive: the platform does not know this handle"]);
});

test("an answer that is not the worker interface still counts as answering, in its own words", () => {
  const c = checkAgent({ named: A, card: read(storefront(A)), record: read({ runs: 0 }), agentdoc: read(agentdoc(A)), asked: answered("hello, I am here") });
  assert.equal(c.answering.state, "yes");
  assert.equal(c.answering.as_worker, false);
  assert.equal(c.alert, null);
});

test("time is held against the declared ceiling, both the average and a job running now", () => {
  const card = read(storefront(A));
  const doc = read(agentdoc(A, { job_seconds: { most: 60 } }));
  const slow = checkAgent({ named: A, card, agentdoc: doc, record: read({ runs: 3, average_seconds: 90, window_days: 30 }), asked: answered() });
  assert.equal(slow.limits.state, "outside");
  assert.match(slow.alert.reasons[0], /its average job took 90s, longer than the longest it declares, 60s/);
  const running = checkAgent({ named: A, card, agentdoc: doc, record: read({ runs: 3, average_seconds: 20 }), asked: answered({ interface: "interface-worker", exchange: "status", job: "j", state: "working", detail: "running for 400s" }) });
  assert.equal(running.limits.state, "outside");
  assert.match(running.alert.reasons[0], /running for 400s, past the 60s it declares/);
  const none = checkAgent({ named: A, card, agentdoc: read(agentdoc(A)), record: read({ runs: 3, average_seconds: 20 }), asked: answered() });
  assert.equal(none.limits.state, "unknown");
  assert.equal(none.alert, null);
  const noRuns = checkAgent({ named: A, card, agentdoc: doc, record: read({ runs: 0 }), asked: answered() });
  assert.equal(noRuns.limits.checks.find((x) => x.limit === "time").verdict, "not measured");
});

test("money is held against the registered allowance and the platform's crossing marks", () => {
  const card = read(storefront(A));
  const base = { named: A, card, agentdoc: read(agentdoc(A)), record: read({ runs: 0 }), asked: answered(), spendRead: { url: "https://p/spend", at: "2026-10-28T06:00:00Z" } };
  const allowed = { registered: true, valid: true, currency: "XCR", ceilings: [{ scope: "task", amount_micro: 10_000_000 }] };
  const ok = checkAgent({ ...base, spendAgent: agentSpend({ key: "U", handle: A, allowed, against: [{ scope: "task", ceiling_micro: 10_000_000, checked: 2, over: [] }] }) });
  assert.equal(ok.limits.state, "inside");
  const crossed = checkAgent({ ...base, spendAgent: agentSpend({ key: "U", handle: A, allowed, against: [{ scope: "task", ceiling_micro: 10_000_000, checked: 1, over: [] }], crossings: [{ scope: "task", currency: "XCR", ceiling_micro: 10_000_000, spent_micro: 12_000_000, at: "2026-10-27T09:00:00Z", task_id: "j9" }] }) });
  assert.equal(crossed.limits.state, "outside");
  assert.match(crossed.alert.reasons[0], /marked its task ceiling of 10 XCR crossed at 2026-10-27T09:00:00Z \(job j9\)/);
  assert.equal(crossed.alert.raise, true);
  const unread = checkAgent({ ...base, spendAgent: null, spendWhy: "no key" });
  assert.equal(unread.limits.checks[0].why, "no key");
});

test("an agent the watcher could not ask has an open alert that is not raised", () => {
  const c = checkAgent({ named: A, card: read(storefront(A)), record: read({ runs: 0 }), agentdoc: read(agentdoc(A)), asked: { handle: A, sent_at: "t0", gave_up_at: "t1", outcome: "not-sent", why: "the agentmesh command could not be started" } });
  assert.equal(c.answering.state, "unknown");
  assert.equal(c.alert.raise, false);
  assert.match(c.alert.reasons[0], /^no current answer: the question could not be sent/);
});

test("the spend's arithmetic is checked again, and a report that says it reconciles when it does not is caught", () => {
  const good = readSpend(json(join(FIX, "spend-report.dev-2026-10-28.json")));
  assert.equal(good.reconciles, true);
  assert.equal(good.every_spend_traced, false);
  assert.deepEqual(good.discrepancies, []);
  const bad = spendReport([agentSpend({ key: "U1", handle: A, days: [{ day: "2026-10-27", jobs: [{ job: "j1", spent_micro: 5_000_000 }] }] })]);
  bad.totals[0].spent_micro += 1;
  const r = readSpend(bad);
  assert.equal(r.platform_reconciles, true);
  assert.equal(r.reconciles, false);
  assert.ok(r.discrepancies.some((d) => /the agents add up to 5000000 micro and the total says 5000001/.test(d)), r.discrepancies.join("\n"));
  const day = spendReport([agentSpend({ key: "U1", handle: A, days: [{ day: "2026-10-27", jobs: [{ job: "j1", spent_micro: 5_000_000 }] }] })]);
  day.agents[0].currencies[0].days[0].jobs[0].spent_micro = 4_000_000;
  assert.ok(readSpend(day).discrepancies.some((d) => /on 2026-10-27: the day says 5000000 micro, its job lines 4000000/.test(d)));
  assert.deepEqual(readSpend({ format: "other" }), { ok: false, why: "the spend report is not spend-report-v1 (it says other)" });
  assert.equal(moneyWords(1_500_000, "USD"), "1.5 USD");
});

test("an alarm is the recorder's two lines and a file named for the platform", () => {
  const c = checkAgent({ named: A, card: read(storefront(A)), record: read({ runs: 0 }), agentdoc: read(agentdoc(A)), asked: { handle: A, sent_at: "2026-10-28T06:00:00.000Z", gave_up_at: "2026-10-28T06:01:00.000Z", outcome: "silent", why: "no answer" }, waitSeconds: 60 });
  const al = alarmFor(c, { watcher: "watcher 0.1.0" });
  assert.match(al.text, /^agent: alpha\.platform@agentmesh\.ai\ntime: 2026-10-28T06:01:00\.000Z\n/);
  assert.equal(al.file, alarmFileName(A));
  assert.match(al.file, /platform/);
  const lines = al.jsonl.trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.every((l) => l.time && l.event && l.agent === A && l.seen_by === "watcher 0.1.0"));
  assert.deepEqual(lines.map((l) => l.time), [...lines.map((l) => l.time)].sort());
  assert.ok(lines.every((l) => l.time <= "2026-10-28T06:01:00.000Z"));
});

test("a raise is read as sent, held or refused", () => {
  assert.equal(readRaise({ stdout: JSON.stringify({ queued: true, request_id: "r" }) }).sent, true);
  assert.equal(readRaise({ stdout: JSON.stringify({ status: "delivered", delivered: true, request_id: "r" }) }).sent, true);
  assert.equal(readRaise({ stdout: JSON.stringify({ status: "held", delivered: false }) }).held, true);
  assert.equal(readRaise({ stdout: JSON.stringify({ ok: false, error: "blocked" }) }).sent, false);
  assert.equal(readRaise({ killed: true }).sent, false);
});

// From review, 2026-10-28.

test("with no node here the send prints words, and they are read: an answer, silence, and a raise", () => {
  const reply = JSON.stringify({ interface: "interface-worker", exchange: "status", job: "j", state: "done", detail: "ok" });
  const a = readSendOutput({ stdout: `→ alpha (queued at the recipient; waiting…)\n─ reply ─\n${reply}` });
  assert.equal(a.outcome, "answered");
  assert.equal(a.path, "direct");
  assert.equal(readAnswer(a.reply).worker, true);
  assert.deepEqual(readSendOutput({ stdout: "→ alpha\n(no reply within 60s; it lands in this agent's inbox when it arrives)" }), { outcome: "silent", request_id: null, why: "no answer within 60s", path: "direct" });
  assert.equal(readRaise({ status: 0, stdout: "→ incident-recorder (queued at the recipient)" }).sent, true);
  assert.equal(readRaise({ status: 1, stdout: "✗ not delivered: blocked" }).sent, false);
});

test("a hold or a refusal under payload is read as one, and a note is never taken for an answer", () => {
  assert.equal(readSendOutput({ stdout: JSON.stringify({ reply: "Held, not delivered", payload: { held: true, text: "Held, not delivered" } }) }).outcome, "held");
  assert.equal(readSendOutput({ stdout: JSON.stringify({ reply: null, payload: { ok: false, code: "BLOCKED", error: "no" } }) }).outcome, "refused");
  assert.equal(readRaise({ stdout: JSON.stringify({ reply: "Held", payload: { held: true, text: "Held" } }) }).held, true);
});

test("one overspend is one reason: the platform's mark of a crossing the report measured is not said twice", () => {
  const card = read(storefront(A));
  const allowed = { registered: true, valid: true, currency: "XCR", ceilings: [{ scope: "task", amount_micro: 10_000_000 }] };
  const c = checkAgent({
    named: A, card, agentdoc: read(agentdoc(A)), record: read({ runs: 0 }), asked: answered(),
    spendRead: { url: "https://p/spend", at: "2026-10-28T06:00:00.000Z" },
    spendAgent: agentSpend({ key: "U", handle: A, allowed, against: [{ scope: "task", ceiling_micro: 10_000_000, checked: 1, over: [{ day: "2026-10-20", job: "j9", spent_micro: 12_000_000 }] }], crossings: [{ scope: "task", currency: "XCR", ceiling_micro: 10_000_000, spent_micro: 12_000_000, at: "2026-10-20T09:00:00Z", task_id: "j9" }] }),
  });
  assert.equal(c.alert.reasons.length, 1);
  assert.deepEqual(c.alert.keys, ["money:task:j9"]);
});

test("an alarm for a crossing is dated when the watcher saw it, not when the crossing happened", () => {
  const allowed = { registered: true, valid: true, currency: "XCR", ceilings: [{ scope: "day", amount_micro: 10_000_000 }] };
  const c = checkAgent({
    named: A, card: read(storefront(A)), agentdoc: read(agentdoc(A)), record: read({ runs: 0 }), asked: answered(),
    spendRead: { url: "https://p/spend", at: "2026-10-28T06:00:02.000Z" },
    spendAgent: agentSpend({ key: "U", handle: A, allowed, against: [], crossings: [{ scope: "day", currency: "XCR", ceiling_micro: 10_000_000, spent_micro: 11_000_000, at: "2026-10-20T09:00:00Z", day: "2026-10-20" }] }),
  });
  assert.equal(c.alert.at, "2026-10-28T06:00:02.000Z");
  assert.match(c.alert.reasons[0], /crossed at 2026-10-20T09:00:00Z/);
});

test("an amount the report leaves out is nothing, not a discrepancy", () => {
  const r = spendReport([agentSpend({ key: "U1", handle: A, days: [{ day: "2026-10-27", jobs: [{ job: "j1", spent_micro: 5_000_000 }] }] })]);
  delete r.agents[0].currencies[0].days[0].untraced_micro;
  delete r.agents[0].currencies[0].untraced;
  assert.deepEqual(readSpend(r).discrepancies, []);
});
