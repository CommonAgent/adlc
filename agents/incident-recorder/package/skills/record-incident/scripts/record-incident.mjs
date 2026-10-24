import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRecords } from "./read-records.mjs";
import { buildTimeline } from "./build-timeline.mjs";
import { formatIncidentRecord, updateStandingIndex } from "./write-incident.mjs";

export const EMPTY_REPLY = "notes the complete absence of records and delivers the empty timeline without guessing what occurred";

export function fromArgv(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--job") parsed.job = args[++i];
    if (args[i] === "--records") parsed.records = args[++i];
    if (args[i] === "--work") parsed.work = args[++i];
    if (args[i] === "--agent") parsed.agent = args[++i];
    if (args[i] === "--time") parsed.time = args[++i];
  }
  return parsed;
}

export async function recordIncident({
  jobDir,
  recordsDir,
  workDir,
  agent,
  failureTime,
  recordsPath,
  standingDir,
  probe,
  fetchImpl,
  remoteUrl
}) {
  if (probe) {
    return { refused: "never sends a ping, signal, or message to the target agent" };
  }
  if (fetchImpl) {
    return { refused: "accesses no remote APIs or network endpoints" };
  }

  const { unreadable, files, events } = await readRecords({
    recordsDir: recordsPath,
    agent,
    failureTime,
    wentWithoutDir: recordsDir
  });

  const tStart = new Date(failureTime).getTime() - 60000;
  const tEnd = new Date(failureTime).getTime() + 60000;

  const timeline = buildTimeline({
    events,
    windowStart: new Date(tStart).toISOString(),
    windowEnd: new Date(tEnd).toISOString(),
    expectedCadenceMs: 60000
  });

  if (events.length === 0) {
    const emptyIncident = {
      agent,
      failureTime,
      summary: "complete absence of records",
      facts: [],
      gaps: timeline.gaps
    };
    writeFileSync(join(recordsDir, "incident.json"), JSON.stringify(emptyIncident, null, 2));
    writeFileSync(join(recordsDir, "timeline.json"), JSON.stringify(timeline, null, 2));
    return { code: 3, reply: EMPTY_REPLY };
  }

  const inventory = { files };
  writeFileSync(join(recordsDir, "inventory.json"), JSON.stringify(inventory, null, 2));

  const incident = formatIncidentRecord({ agent, failureTime, timeline, inventory });
  writeFileSync(join(recordsDir, "incident.json"), JSON.stringify(incident, null, 2));
  writeFileSync(join(recordsDir, "timeline.json"), JSON.stringify(timeline, null, 2));

  if (standingDir) {
    updateStandingIndex(join(standingDir, "incidents.json"), {
      incidentId: "inc-" + Date.now(),
      agent,
      failureTime,
      recordedAt: new Date().toISOString()
    });
  }

  return { code: 0 };
}

if (process.argv[1] === import.meta.url || process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.join(" ");
  if (!args.includes("--agent") || !args.includes("--time") || !args.includes("--job")) {
    console.error("agent, time, and job required");
    process.exit(2);
  }
}
