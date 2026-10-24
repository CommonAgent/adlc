// The job as the runtime requirements start it: node, the run command's own
// arguments with the host's placeholders filled in, a job folder holding
// message.txt, and the attached records passed the way per_file says. The
// package is laid out the way the builder lays it out (each skill's scripts
// from plugin.json under skills/<slug>/scripts/), so a script missing from
// plugin.json fails here and not on a host.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const RUN = json(join(AGENT, "agent-runtime-requirements.json")).run["record-incident"];
const PLUGIN = json(join(AGENT, "plugin.json"));

/** A host: home with the package laid out, a records folder and a work folder. */
function host() {
  const root = mkdtempSync(join(tmpdir(), "incident-recorder-"));
  const pkg = "incident-recorder";
  const skills = PLUGIN.extensions["net.agentdoc.package"].build.skills;
  for (const [slug, { scripts }] of Object.entries(skills)) {
    for (const s of scripts) {
      const to = join(root, "home", pkg, "skills", slug, s);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(AGENT, s)));
    }
  }
  const records = join(root, "records");
  const work = join(root, "work");
  mkdirSync(records, { recursive: true });
  mkdirSync(work, { recursive: true });
  return { root, home: join(root, "home"), pkg, records, work };
}

/** Run one job: write message.txt, attach files, start the run command. */
function run(h, { id = "job-1", message = "", files = [], extra = [], env = {} } = {}) {
  const jobDir = join(h.root, "jobs", id);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, "message.txt"), message);
  const fill = (s, more = {}) => s
    .replaceAll("{home}", h.home).replaceAll("{package}", h.pkg)
    .replaceAll("{job_dir}", jobDir).replaceAll("{records}", h.records).replaceAll("{work}", h.work)
    .replaceAll("{file_path}", more.path ?? "").replaceAll("{file_media_type}", more.type ?? "");
  const argv = RUN.command.map((s) => fill(s));
  for (const f of files) {
    const at = join(h.root, "attached", f.name);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, f.text);
    for (const s of RUN.per_file) argv.push(fill(s, { path: at, type: f.type ?? "application/x-ndjson" }));
  }
  argv.push(...extra);
  const [cmd, ...args] = argv;
  assert.equal(cmd, "node");
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, INCIDENT_RECORDS_ROOTS: "", ...env } });
  const out = r.stdout.trim();
  let doc;
  assert.doesNotThrow(() => { doc = JSON.parse(out); }, `stdout is one JSON object, got: ${out}\n${r.stderr}`);
  return { status: r.status, doc, jobDir, recordsDir: join(h.records, id), stderr: r.stderr };
}

const PLATFORM = [
  { time: "2026-10-24T09:29:05Z", event: "job 41 started" },
  { time: "2026-10-24T09:29:45Z", event: "heartbeat missed" },
].map((o) => JSON.stringify(o)).join("\n") + "\n";
const OWN = [
  { time: "2026-10-24T09:29:15Z", event: "step read-the-spec finished" },
].map((o) => JSON.stringify(o)).join("\n") + "\n";
const MESSAGE = "Please record this one.\nagent: spec-writer.platform@example.com\ntime: 2026-10-24T09:30:00Z\n";

test("the run command reads the message, records the incident and timeline, and prints the reply", () => {
  const h = host();
  const r = run(h, { message: MESSAGE, files: [{ name: "platform-activity.jsonl", text: PLATFORM }, { name: "agent-own.jsonl", text: OWN }] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(typeof r.doc.reply, "string");
  assert.match(r.doc.reply, /spec-writer\.platform@example\.com/);
  assert.match(r.doc.reply, /3 facts from 2 record files/);
  assert.equal(r.doc.agent, "spec-writer.platform@example.com");
  assert.equal(r.doc.failure_time, "2026-10-24T09:30:00.000Z");

  // The job's own records folder holds the record, the timeline and the inventory.
  const incident = json(join(r.recordsDir, "incident.json"));
  const timeline = json(join(r.recordsDir, "timeline.json"));
  const inventory = json(join(r.recordsDir, "inventory.json"));
  assert.equal(incident.agent, "spec-writer.platform@example.com");
  assert.equal(incident.facts.length, 3);
  assert.deepEqual(timeline.events.map((e) => e.fact), ["job 41 started", "step read-the-spec finished", "heartbeat missed"]);
  for (const f of incident.facts) {
    assert.match(f.sourceDigest, /^[0-9a-f]{64}$/);
    assert.ok(["platform-activity.jsonl", "agent-own.jsonl"].includes(f.sourceFile));
    assert.equal(typeof f.byteOffset, "number");
  }
  assert.ok(!("cause" in incident) && !("fix" in incident) && !("remediation" in incident));
  assert.equal(inventory.files.length, 2);
  assert.equal(inventory.files.find((f) => f.name === "platform-activity.jsonl").origin, "platform");
  // The gap after the last event up to the end of the window is stated, not filled in.
  assert.deepEqual(timeline.gaps.map((g) => [g.from, g.to]), [["2026-10-24T09:29:45.000Z", "2026-10-24T09:31:00.000Z"]]);
  assert.match(r.doc.reply, /1 gap where the records say nothing/);
  assert.ok(timeline.gaps.every((g) => g.status === "unknown" && g.interpolated === false));

  // Filed as pieces for the adapter to deliver.
  const pieces = json(join(r.jobDir, "pieces.json"));
  assert.deepEqual(pieces.map((p) => p.name), ["incident record", "timeline"]);
  assert.deepEqual(pieces.map((p) => p.path), ["out/incident.json", "out/timeline.json"]);
  assert.ok(pieces.every((p) => p.step === "write-incident-record" && p.media_type === "application/json"));
  assert.deepEqual(json(join(r.jobDir, "out", "incident.json")), incident);
  assert.deepEqual(json(join(r.jobDir, "out", "timeline.json")), timeline);

  // The standing index sits beside the job folders, keyed by the job.
  const index = json(join(h.records, "incidents.json"));
  assert.equal(index.length, 1);
  assert.equal(index[0].incidentId, "job-1");
});

test("the records folder a message names is read, and --agent/--time win over the message", () => {
  const h = host();
  const folder = join(h.root, "fleet", "records");
  mkdirSync(join(folder, "nested"), { recursive: true });
  writeFileSync(join(folder, "platform.jsonl"), PLATFORM);
  writeFileSync(join(folder, "nested", "ignored.jsonl"), "not json\n");
  const r = run(h, {
    message: `agent: someone-else.example\ntime: 2020-01-01T00:00:00Z\nrecords: ${folder}\n`,
    extra: ["--agent", "code-writer.platform@example.com", "--time", "2026-10-24T09:30:00Z"],
    env: { INCIDENT_RECORDS_ROOTS: join(h.root, "fleet") },
  });
  assert.equal(r.status, 0, r.stderr);
  const incident = json(join(r.recordsDir, "incident.json"));
  assert.equal(incident.agent, "code-writer.platform@example.com");
  assert.equal(incident.failureTime, "2026-10-24T09:30:00.000Z");
  assert.equal(incident.facts.length, 2);
  assert.deepEqual(r.doc.records_read, ["platform.jsonl"]);
});

test("a missing agent or time stops with exit 3 and a reply that says what is needed", () => {
  const h = host();
  const none = run(h, { id: "j-none", message: "something broke, please look\n" });
  assert.equal(none.status, 3);
  assert.match(none.doc.reply, /neither/);
  assert.match(none.doc.reply, /agent: /);
  assert.match(none.doc.reply, /time: /);
  assert.ok(!existsSync(join(none.jobDir, "pieces.json")));

  const noTime = run(h, { id: "j-notime", message: "agent: spec-writer.platform@example.com\n" });
  assert.equal(noTime.status, 3);
  assert.match(noTime.doc.reply, /the time spec-writer\.platform@example\.com failed/);

  const noAgent = run(h, { id: "j-noagent", message: "time: 2026-10-24T09:30:00Z\n" });
  assert.equal(noAgent.status, 3);
  assert.match(noAgent.doc.reply, /handle of the agent/);

  const noZone = run(h, { id: "j-nozone", message: "agent: a.example\ntime: 2026-10-24T09:30:00\n" });
  assert.equal(noZone.status, 3);
  assert.match(noZone.doc.reply, /with its zone/);

  const vague = run(h, { id: "j-vague", message: "agent: a.example\ntime: yesterday afternoon\n" });
  assert.equal(vague.status, 3);
  assert.match(vague.doc.reply, /yesterday afternoon/);
});

test("with no records it still records the incident: the absence is stated and the timeline is empty", () => {
  const h = host();
  const r = run(h, { message: MESSAGE });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.doc.reply, /No records came with this job/);
  assert.match(r.doc.reply, /complete absence of records/);
  const incident = json(join(r.recordsDir, "incident.json"));
  const timeline = json(join(r.recordsDir, "timeline.json"));
  assert.equal(incident.summary, "complete absence of records");
  assert.deepEqual(incident.facts, []);
  assert.deepEqual(timeline.events, []);
  assert.equal(timeline.gaps.length, 1);
  assert.equal(timeline.gaps[0].from, "2026-10-24T09:29:00.000Z");
  assert.equal(timeline.gaps[0].to, "2026-10-24T09:31:00.000Z");
  assert.deepEqual(json(join(r.jobDir, "pieces.json")).map((p) => p.name), ["incident record", "timeline"]);
  // An incident with no records is still an incident in the standing index.
  assert.deepEqual(json(join(h.records, "incidents.json")).map((e) => e.incidentId), ["job-1"]);
});

test("a named folder is not read unless the host lists a root it lies inside", () => {
  const h = host();
  const folder = join(h.root, "elsewhere");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "platform.jsonl"), PLATFORM);

  const noRoots = run(h, { id: "j-noroots", message: `${MESSAGE}records: ${folder}\n` });
  assert.equal(noRoots.status, 0, noRoots.stderr);
  assert.deepEqual(noRoots.doc.records_read, []);
  assert.match(noRoots.doc.reply, /lists no folders a message may name/);
  assert.deepEqual(json(join(noRoots.recordsDir, "incident.json")).facts, []);

  mkdirSync(join(h.root, "fleet"), { recursive: true });
  const outside = run(h, {
    id: "j-outside",
    message: `${MESSAGE}records: ${join(h.root, "fleet", "..", "elsewhere")}\n`,
    env: { INCIDENT_RECORDS_ROOTS: join(h.root, "fleet") },
  });
  assert.equal(outside.status, 0, outside.stderr);
  assert.deepEqual(outside.doc.records_read, []);
  assert.match(outside.doc.reply, /not inside a folder this host lets a message name/);
});

test("a line with no zoned time is left out and named, and the rest of its file is read", () => {
  const h = host();
  const text = [
    JSON.stringify({ event: "restart" }),
    JSON.stringify({ time: "2026-10-24T09:29:20", event: "no zone" }),
    JSON.stringify({ time: "2026-10-24T09:29:10Z", event: "timed" }),
  ].join("\n") + "\n";
  const r = run(h, { message: MESSAGE, files: [{ name: "agent-own.jsonl", text }] });
  assert.equal(r.status, 0, r.stderr);
  const timeline = json(join(r.recordsDir, "timeline.json"));
  assert.deepEqual(timeline.events.map((e) => e.fact), ["timed"]);
  assert.deepEqual(timeline.gaps.map((g) => [g.from, g.to]), [["2026-10-24T09:29:10.000Z", "2026-10-24T09:31:00.000Z"]]);
  assert.match(r.doc.reply, /agent-own\.jsonl at byte 0 has no time with a zone/);
  assert.equal(r.doc.unreadable.length, 2);
});

test("a job run again reads only what it was given this time, and a broken index does not stop it", () => {
  const h = host();
  const first = run(h, { message: MESSAGE, files: [{ name: "platform.jsonl", text: PLATFORM }] });
  assert.equal(first.status, 0, first.stderr);
  writeFileSync(join(h.records, "incidents.json"), "{ half written");
  const again = run(h, { message: `${MESSAGE}records: ${join(h.root, "nowhere")}\n` });
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(again.doc.records_read, []);
  assert.equal(json(join(again.recordsDir, "went-without.json")).length, 1);
  assert.match(again.doc.reply, /could not be added to the standing index/);
  assert.deepEqual(json(join(again.jobDir, "pieces.json")).map((p) => p.name), ["incident record", "timeline"]);
});

test("a records folder that is not there is said in the reply and noted as gone without", () => {
  const h = host();
  const r = run(h, { message: `${MESSAGE}records: ${join(h.root, "no-such-folder")}\n` });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.doc.reply, /I went without the records folder/);
  const ww = json(join(r.recordsDir, "went-without.json"));
  assert.equal(ww.length, 1);
  assert.match(ww[0].wanted, /no-such-folder/);
});

test("an unreadable record is named with its byte offset and the readable ones still go in", () => {
  const h = host();
  const bad = `${JSON.stringify({ time: "2026-10-24T09:29:50Z", event: "ok line" })}\n{not json\n`;
  const r = run(h, { message: MESSAGE, files: [{ name: "platform.jsonl", text: PLATFORM }, { name: "agent-broken.jsonl", text: bad }] });
  assert.equal(r.status, 0, r.stderr);
  const offset = Buffer.byteLength(bad.split("\n")[0]) + 1;
  assert.match(r.doc.reply, new RegExp(`agent-broken\\.jsonl could not be read from byte ${offset}`));
  assert.equal(json(join(r.recordsDir, "incident.json")).facts.length, 3);
});
