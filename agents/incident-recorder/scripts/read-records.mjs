import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { note } from "./went-without.mjs";

export function hashRecord(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function indexRecords() {}

const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
export function hasZonedTime(obj) {
  return Boolean(obj) && typeof obj === "object" && typeof obj.time === "string"
    && ZONED.test(obj.time.trim()) && Number.isFinite(new Date(obj.time).getTime());
}

// THE WINDOW AND THE AGENT (0.1.2). Until 0.1.1 every timed line of every
// file became a fact, so a record of a whole day's activity put lines from
// hours away and lines about other agents into one agent's incident, and the
// gap between the last of them and the failure read as a gap in the failure.
// A line now counts only when its time lies in the window around the failure,
// and only when it is about the failing agent: a line that names an agent
// (`agent`, `agent_handle` or `handle`) names this one, and a line that names
// none is kept, since it is in a file the job was given about this incident.
// What is left out is counted and said, never silently dropped.
export const WINDOW_BEFORE_MS = 15 * 60 * 1000;
export const WINDOW_AFTER_MS = 5 * 60 * 1000;

/** The window read around a failure, as ISO times. */
export function windowAround(failureTime) {
  const t = new Date(failureTime).getTime();
  return { windowStart: new Date(t - WINDOW_BEFORE_MS).toISOString(), windowEnd: new Date(t + WINDOW_AFTER_MS).toISOString() };
}

const AGENT_MEMBERS = ["agent", "agent_handle", "handle"];

/** The agent a record line names, or "" when it names none. */
export function agentOfLine(obj) {
  for (const k of AGENT_MEMBERS) {
    if (typeof obj?.[k] === "string" && obj[k].trim()) return obj[k].trim();
  }
  return "";
}

/** Is `named` the failing agent? Handles are compared whole, without regard to
 *  case. A bare name (no @) is the agent whose handle starts with that name and
 *  a dot, so `tone-check` is `tone-check.platform@example.com`; two bare names
 *  are compared whole. */
export function sameAgent(named, agent) {
  const a = String(named ?? "").trim().toLowerCase();
  const b = String(agent ?? "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes("@") && !b.includes("@")) return a.startsWith(`${b}.`);
  if (b.includes("@") && !a.includes("@")) return b.startsWith(`${a}.`);
  return false;
}

export async function readRecords({ recordsDir, agent, failureTime, wentWithoutDir, windowStart, windowEnd }) {
  const result = { unreadable: [], files: [], events: [], leftOut: { outsideWindow: 0, otherAgent: 0 } };
  const from = windowStart ? new Date(windowStart).getTime() : -Infinity;
  const to = windowEnd ? new Date(windowEnd).getTime() : Infinity;
  if (!existsSync(recordsDir)) return result;

  const files = readdirSync(recordsDir);
  for (const file of files) {
    const p = join(recordsDir, file);
    const buf = readFileSync(p);
    const sha256 = hashRecord(buf);
    
    result.files.push({ name: file, sha256, origin: file.includes("platform") ? "platform" : "target-agent" });

    let offset = 0;
    let idx = 0;
    let fileCorrupted = false;
    while (idx < buf.length) {
      let next = buf.indexOf(10, idx); // \n
      if (next === -1) next = buf.length;
      
      const lineBuf = buf.subarray(idx, next);
      const lineStr = lineBuf.toString("utf8").trim();
      if (lineStr.length > 0) {
        try {
          const obj = JSON.parse(lineStr);
          // A line with no time carrying a zone cannot be placed in the
          // timeline, so it is noted and left out rather than sorted as NaN
          // or read in the host's own zone.
          if (!hasZonedTime(obj)) {
            result.unreadable.push({ file, byteOffset: idx, reason: "no time with a zone", untimed: true });
            idx = next + 1;
            continue;
          }
          const at = new Date(obj.time).getTime();
          if (at < from || at > to) {
            result.leftOut.outsideWindow++;
            idx = next + 1;
            continue;
          }
          const named = agentOfLine(obj);
          if (agent && named && !sameAgent(named, agent)) {
            result.leftOut.otherAgent++;
            idx = next + 1;
            continue;
          }
          result.events.push({
            timestamp: obj.time,
            fact: obj.event,
            digest: sha256,
            offset: idx,
            sourceFile: file
          });
        } catch (e) {
          result.unreadable.push({
            file,
            byteOffset: idx,
            reason: "corrupted or unreadable"
          });
          if (wentWithoutDir) {
            note(wentWithoutDir, {
              wanted: file,
              did: "skipped corrupted file",
              why: `file ${file} corrupted or unreadable`
            });
          }
          fileCorrupted = true;
          break; // Stop processing this file if it's corrupted
        }
      }
      idx = next + 1;
    }
    
    if (fileCorrupted) {
      // If we decide to remove it from `files` inventory when it's corrupted, we could pop it.
      // But let's leave it in `result.files` for now, or maybe remove it?
      // Wait, the test says "examined files". It's fine to leave it, or maybe we pop it? Let's leave it.
    }
  }
  return result;
}

if (process.argv[1] === import.meta.url || process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.join(" ");
  if (!args.includes("--agent") || !args.includes("--time")) {
    console.error("agent and time required");
    process.exit(2);
  }
}
