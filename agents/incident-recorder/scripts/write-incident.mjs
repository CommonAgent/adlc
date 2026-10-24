import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function assertFactual(record) {
  if ("cause" in record || "root_cause" in record) {
    throw new Error("speculation about root causes or agent intent");
  }
  if ("remediation" in record || "fix" in record || "suggestion" in record) {
    throw new Error("strictly factual without speculative advice");
  }
}

export function formatIncidentRecord({ agent, failureTime, timeline, inventory }) {
  const record = {
    agent,
    failureTime,
    facts: timeline.events.map(e => ({
      fact: e.fact,
      timestamp: e.timestamp,
      sourceDigest: e.digest,
      byteOffset: e.offset,
      sourceFile: e.sourceFile
    })),
    gaps: timeline.gaps
  };
  assertFactual(record);
  return record;
}

export function updateStandingIndex(filePath, entry) {
  let list = [];
  if (existsSync(filePath)) {
    list = JSON.parse(readFileSync(filePath, "utf8"));
  }
  list.push(entry);
  writeFileSync(filePath, JSON.stringify(list, null, 2));
}

export function writeIncident() {}

if (process.argv[1] === import.meta.url || process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.join(" ");
  if (!args.includes("--timeline") || !args.includes("--inventory")) {
    console.error("timeline and inventory required");
    process.exit(2);
  }
}
