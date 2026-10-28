// The settings a job runs with (Common Agent 5.8): the Descriptor's declared
// defaults, with the values the run context hands this job laid over them.
//
// A job started under a run config is handed run-context.json, which then
// says "run-context": "v2" and carries `run_config.settings`. Each value is
// used exactly as given, or the job is refused before anything runs, with
// the reason: not_declared (no such setting), not_allowed (outside its
// allowed values or its range). A job with no run config runs on the
// defaults. The values it ran with are said in the reply and the report.
//
//   needs: node >= 22
//   import { settingsFor } from "./run-config.mjs"
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** The run config's settings among the job's files, or {} when none. */
export function handedSettings(paths = []) {
  for (const p of paths.filter((x) => /run-context/i.test(basename(String(x))))) {
    try {
      const d = JSON.parse(readFileSync(p, "utf8"));
      if (d?.["run-context"] === "v2" && isObject(d.run_config) && isObject(d.run_config.settings)) return d.run_config.settings;
    } catch { /* not a run context */ }
  }
  return {};
}

/** {values} the job runs with, or {refused} in words. */
export function settingsFor(declared = [], handed = {}) {
  const values = {};
  for (const s of declared) values[s.name] = s.default;
  for (const [k, v] of Object.entries(handed)) {
    const s = declared.find((x) => x.name === k);
    if (!s) return { refused: `not_declared: this agent has no setting "${k}"` };
    if (Array.isArray(s.allowed) && !s.allowed.includes(v)) return { refused: `not_allowed: "${k}" takes ${s.allowed.map((x) => JSON.stringify(x)).join(", ")}, not ${JSON.stringify(v)}` };
    if (s.range && (typeof v !== "number" || v < s.range.min || v > s.range.max)) return { refused: `not_allowed: "${k}" is a number from ${s.range.min} to ${s.range.max}, not ${JSON.stringify(v)}` };
    values[k] = v;
  }
  return { values };
}
