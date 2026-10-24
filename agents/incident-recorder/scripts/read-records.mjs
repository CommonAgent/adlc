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

export async function readRecords({ recordsDir, agent, failureTime, wentWithoutDir }) {
  const result = { unreadable: [], files: [], events: [] };
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
