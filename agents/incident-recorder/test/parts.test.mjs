// The parts the run command is made of, called directly: reading the message,
// checking the time, and the pieces list.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromArgv, fromText, isIsoTime, recordIncident, whatIsMissing } from "../scripts/record-incident.mjs";
import { plan } from "../scripts/pieces.mjs";
import { agentOfLine, sameAgent, windowAround } from "../scripts/read-records.mjs";

test("the message's agent, time and records lines are read, in the clear forms only", () => {
  assert.deepEqual(fromText("agent: a.owner@example.com\ntime: 2026-10-24T09:30:00Z\nrecords: /srv/r\n"),
    { agent: "a.owner@example.com", time: "2026-10-24T09:30:00Z", recordsDir: "/srv/r" });
  assert.deepEqual(fromText("- Agent handle: `a.example`\n- Failure time: 2026-10-24T09:30:00+02:00\n"),
    { agent: "a.example", time: "2026-10-24T09:30:00+02:00", recordsDir: "" });
  // Only the handle is taken, without what is said after it.
  assert.equal(fromText("agent: `a.example` (the writer)\n").agent, "a.example");
  assert.equal(fromText("agent: <a.owner@example.com> (x)\n").agent, "a.owner@example.com");
  // A handle mentioned in passing is not taken.
  assert.deepEqual(fromText("a.example went quiet at 09:30 today"), { agent: "", time: "", recordsDir: "" });
});

test("flags are read, files with and without a media type", () => {
  const a = fromArgv(["--job", "j", "--records", "r", "--work", "w", "--text-file", "m", "--agent", "x", "--time", "t", "--file", "/a/b.jsonl::text/plain", "--file", "/c"]);
  assert.equal(a.job, "j"); assert.equal(a.agent, "x"); assert.equal(a.time, "t");
  assert.deepEqual(a.files, [{ path: "/a/b.jsonl", declared: "text/plain" }, { path: "/c", declared: "" }]);
});

test("only an ISO time with a zone is placed", () => {
  assert.ok(isIsoTime("2026-10-24T09:30:00Z"));
  assert.ok(isIsoTime("2026-10-24T09:30Z"));
  assert.ok(isIsoTime("2026-10-24T09:30:00.250-05:00"));
  assert.ok(!isIsoTime("2026-10-24T09:30:00"));
  assert.ok(!isIsoTime("2026-10-24"));
  assert.ok(!isIsoTime("2026-13-40T09:30:00Z"));
  assert.ok(!isIsoTime("2026-02-30T09:30Z"));
  assert.equal(whatIsMissing({ agent: "a", time: "2026-10-24T09:30:00Z" }), "");
});

test("it refuses to probe the agent or reach the network", async () => {
  assert.match((await recordIncident({ probe: true })).refused, /never sends a ping/);
  assert.match((await recordIncident({ fetchImpl: () => {} })).refused, /no remote APIs/);
});

test("the pieces are the incident record and the timeline, both from the write step", () => {
  const { entries, copies } = plan({ incidentPath: "/r/incident.json", timelinePath: "/r/timeline.json" });
  assert.deepEqual(entries.map((e) => [e.name, e.step, e.path]), [
    ["incident record", "write-incident-record", "out/incident.json"],
    ["timeline", "write-incident-record", "out/timeline.json"],
  ]);
  assert.equal(copies.length, 2);
  assert.throws(() => plan({ incidentPath: "/r/incident.json" }), /timeline is missing/);
});

test("a line's agent is matched by handle, or by bare name against the handle's start", () => {
  assert.equal(agentOfLine({ agent: " a.owner@example.com " }), "a.owner@example.com");
  assert.equal(agentOfLine({ agent_handle: "a.owner@example.com" }), "a.owner@example.com");
  assert.equal(agentOfLine({ handle: "a" }), "a");
  assert.equal(agentOfLine({ event: "x" }), "");
  assert.ok(sameAgent("A.Owner@Example.com", "a.owner@example.com"));
  assert.ok(sameAgent("tone-check", "tone-check.platform@example.com"));
  assert.ok(sameAgent("tone-check.platform@example.com", "tone-check"));
  assert.ok(sameAgent("tone-check", "tone-check"));
  assert.ok(!sameAgent("tone", "tone-check.platform@example.com"));
  assert.ok(!sameAgent("tone-check-two", "tone-check.platform@example.com"));
  assert.ok(!sameAgent("b.owner@example.com", "a.owner@example.com"));
  assert.ok(!sameAgent("", "a"));
  // Names may hold dots: a name is the handle up to one dot before the owner.
  assert.ok(!sameAgent("spec", "spec.writer.platform@example.com"));
  assert.ok(!sameAgent("spec.writer.platform@example.com", "spec"));
  assert.ok(sameAgent("spec.writer", "spec.writer.platform@example.com"));
  // An agent member that is not a name cannot be compared.
  assert.equal(agentOfLine({ agent: { handle: "a.owner@example.com" } }), null);
  assert.equal(agentOfLine({ agent: null, handle: "a" }), "a");
});

test("the window is fifteen minutes before the failure and five after", () => {
  assert.deepEqual(windowAround("2026-10-24T09:30:00Z"), { windowStart: "2026-10-24T09:15:00.000Z", windowEnd: "2026-10-24T09:35:00.000Z" });
});
