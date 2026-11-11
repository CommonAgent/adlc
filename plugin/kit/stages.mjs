// The stages a build folder passes, what each one's check asks, and what each
// one pins once it passes.
//
// One pin file, build.lock.json: the code writer's lock (its `digests` are the
// files nobody may change, and its check enforces them at Code), with `gates`
// beside them saying which stage passed, when, and on whose word. A stage's
// files are pinned when it passes, so a later stage can never move what an
// earlier one settled; to change one, the person sends the build back
// (`node .adlc/approve.mjs --send-back <stage>`), which takes the pins off from
// that stage on.
//
// The order is stages.json's writing stages as one builder holds them:
// Requirements, Architecture, the agent's files (the Design), Test, Code.
// Requirements alone passes on the person's word; each later stage passes when
// its check does, because the check is the gate and the builder cannot change it.
//
//   needs: node >= 22
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { LOCK_FILE, digestOf } from "./code-writer/scripts/workspace.mjs";
import { corpusOf, specProblems } from "./spec-writer/scripts/spec-check.mjs";

const trim = (s) => String(s ?? "").trim();
const list = (v) => (Array.isArray(v) ? v : []);

export const STAGES = ["requirements", "architecture", "files", "test", "code"];
export const TITLES = { requirements: "Requirements", architecture: "Architecture", files: "The agent's files", test: "Test", code: "Code" };
export const BY_PERSON = new Set(["requirements"]);

/** The files each stage pins, as paths in the folder; a pattern ending in /
 *  is every file under it. Only the files that are there are pinned. */
export const PINS = {
  requirements: ["spec.json", "spec.md", "request.md"],
  architecture: ["architecture.json", "answers.json", "stack.json", "architecture-record.md"],
  files: ["prose.json", "agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json", "skills/*/SKILL.md"],
  test: ["test/"],
  code: [],
};

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const posix = (p) => p.split(sep).join("/");

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(at, base));
    else out.push(posix(relative(base, at)));
  }
  return out;
}

/** The files a stage pins that are in the folder now. */
export function pinsOf(stage, dir) {
  const out = [];
  for (const p of PINS[stage] ?? []) {
    if (p.endsWith("/")) out.push(...walk(join(dir, p)).map((r) => `${p}${r}`));
    else if (p.includes("*")) {
      const [head, , tail] = p.split("/");
      for (const d of existsSync(join(dir, head)) ? readdirSync(join(dir, head)) : []) {
        const rel = `${head}/${d}/${tail}`;
        if (existsSync(join(dir, rel)) && statSync(join(dir, rel)).isFile()) out.push(rel);
      }
    } else if (existsSync(join(dir, p))) out.push(p);
  }
  return out.sort();
}

/** The lock as it stands, or a new one. */
export function lockOf(dir) {
  const lock = readJson(join(dir, LOCK_FILE));
  return lock && lock.build_lock === "v1" ? { digests: {}, scripts: [], gates: {}, ...lock } : { build_lock: "v1", digests: {}, scripts: [], gates: {} };
}

export const writeLock = (dir, lock) => writeFileSync(join(dir, LOCK_FILE), JSON.stringify(lock, null, 2) + "\n");

/** The first stage not passed: the one the folder is at. */
export const stageOf = (lock) => STAGES.find((s) => !lock.gates?.[s]) ?? null;

/** Every pinned file that changed or went, against the lock. */
export function pinProblems(dir, lock) {
  const out = [];
  for (const [p, want] of Object.entries(lock.digests ?? {})) {
    if (!existsSync(join(dir, p))) out.push(`${p} is pinned and is gone; put it back, or ask the person to send the build back to the stage that wrote it`);
    else if (digestOf(readFileSync(join(dir, p))) !== want) out.push(`${p} is pinned and changed; put it back, or ask the person to send the build back to the stage that wrote it`);
  }
  return out;
}

/** The lock with a stage passed: its gate, and its files pinned. */
export function pass(dir, lock, stage, { by = "check", at = new Date().toISOString() } = {}) {
  const digests = { ...lock.digests };
  for (const p of pinsOf(stage, dir)) digests[p] = digestOf(readFileSync(join(dir, p)));
  const sorted = Object.fromEntries(Object.entries(digests).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { ...lock, digests: sorted, gates: { ...lock.gates, [stage]: { passed: true, by, at } } };
}

/** The lock sent back to a stage: that stage and every one after it open
 *  again, and their files no longer pinned. */
export function sendBack(dir, lock, stage) {
  const i = STAGES.indexOf(stage);
  if (i < 0) throw new Error(`${stage} is not a stage; the stages are ${STAGES.join(", ")}`);
  const reopened = new Set(STAGES.slice(i));
  const digests = Object.fromEntries(Object.entries(lock.digests ?? {}).filter(([p]) => !reopened.has(ownerOf(p))));
  const gates = Object.fromEntries(Object.entries(lock.gates ?? {}).filter(([s]) => !reopened.has(s)));
  return { ...lock, digests, gates };
}

const matches = (pattern, p) => (pattern.endsWith("/") ? p.startsWith(pattern)
  : pattern.includes("*") ? new RegExp(`^${pattern.replace(/[.]/g, "\\.").replace(/\*/g, "[^/]+")}$`).test(p)
  : p === pattern);

/** The stage that pins a path, or null for a file no stage pins. */
export const ownerOf = (p) => STAGES.find((s) => (PINS[s] ?? []).some((x) => matches(x, p))) ?? null;

// ---------- Requirements ----------

const kinds = (spec) => list(spec?.features).flatMap((f) => list(f?.requirements));
const EMPTY_WORDS = /\b(no|none|nothing|empty|zero)\b/i;

/** What the plan's Requirements row adds to the spec writer's checks: every
 *  requirement is checked by a scenario, and the refusals, the empty case and
 *  the failure case are each stated, so none is first decided in the code. */
export function coverageProblems(spec) {
  const out = [];
  const checked = new Set(list(spec?.features).flatMap((f) => list(f?.acceptance).flatMap((a) => list(a?.checks).map(trim))));
  for (const r of kinds(spec)) if (trim(r?.id) && !checked.has(trim(r.id))) out.push(`requirement ${trim(r.id)} is checked by no scenario; every requirement has a scenario a test can be written from`);
  const reqs = kinds(spec);
  if (!reqs.some((r) => trim(r?.kind) === "refusal")) out.push("no requirement is a refusal; say what the agent refuses (kind refusal), each from the person's words");
  if (!reqs.some((r) => trim(r?.kind) !== "refusal" && EMPTY_WORDS.test(String(r?.shall ?? ""))))
    out.push("the empty case is not stated; say what the agent does when it is given nothing to work on or finds nothing (a requirement whose shall says so), and ask the person where their words do not say");
  if (!reqs.some((r) => trim(r?.kind) === "error"))
    out.push("the failure case is not stated; say what the agent does when a system it reaches fails or answers wrongly (kind error), and ask the person where their words do not say");
  return out;
}

/** The Requirements check: the spec writer's own rules over what the person
 *  gave (request.md, and their answers in answers.json: name, price and
 *  version are theirs), and the coverage rules above. */
export function requirementsProblems(dir) {
  const spec = readJson(join(dir, "spec.json"));
  if (!spec) return ["spec.json is not in the folder, or is not JSON; write the spec first"];
  const request = existsSync(join(dir, "request.md")) ? readFileSync(join(dir, "request.md"), "utf8") : "";
  if (!trim(request)) return ["request.md is not in the folder; keep the person's own words there first, because every requirement comes from them"];
  const answers = readJson(join(dir, "answers.json")) ?? {};
  const person = Object.fromEntries(["name", "version", "price"].filter((k) => trim(answers[k])).map((k) => [k, trim(answers[k])]));
  const corpus = corpusOf({ said: request }, answers);
  return [...specProblems(spec, { corpus, person }), ...coverageProblems(spec)];
}

/** Each stage's check, by name. A stage without one here is not built yet. */
export const CHECKS = {
  requirements: requirementsProblems,
};
