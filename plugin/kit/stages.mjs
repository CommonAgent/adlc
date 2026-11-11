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
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { LOCK_FILE, digestOf, scriptsOf as codeScriptsOf } from "./code-writer/scripts/workspace.mjs";
import { specOfFolder } from "./code-writer/scripts/agent-folder.mjs";
import { corpusOf, specProblems } from "./spec-writer/scripts/spec-check.mjs";
import { checkDraft } from "./spec-writer/scripts/check-spec.mjs";
import { addressProblems } from "./spec-writer/scripts/design.mjs";
import { declarationProblems } from "./spec-writer/scripts/declared.mjs";
import { givenOfSpec } from "./spec-writer/scripts/given.mjs";
import { loadSchemas } from "./spec-writer/scripts/can-use.mjs";
import { filesFrom, recordFrom, standardTestsOf } from "./generate.mjs";
import { RUN_SECONDS, declarationRun, placeSuite, runSuite, standInPackage, suiteFiles, supportFiles } from "./test-writer/scripts/check-suite.mjs";
import { bracketIdsOf, scenariosOf, specFindings } from "./test-writer/scripts/spec-rules.mjs";
import { testNamesIn } from "./test-writer/scripts/suite-rules.mjs";
import { loadSpec } from "./test-writer/scripts/agent-folder.mjs";
import { PACKER, pack } from "./packer.mjs";

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

// ---------- Architecture ----------

const NOT_BY_HAND = "never edit it by hand: change what it is written from and write it again";

/** The Architecture check: the record is finished, and it is the record the
 *  generator writes from architecture.json and the person's answers, so every
 *  fact in it came through the architect's own naming, binding and checks. */
export async function architectureProblems(dir) {
  const spec = readJson(join(dir, "spec.json"));
  const named = readJson(join(dir, "architecture.json"));
  if (!named) return ["architecture.json is not in the folder; run `node .adlc/generate.mjs brief` for what it holds, write it, then `node .adlc/generate.mjs record`"];
  const text = existsSync(join(dir, "architecture-record.md")) ? readFileSync(join(dir, "architecture-record.md"), "utf8") : "";
  if (!trim(text)) return ["architecture-record.md is not in the folder; run `node .adlc/generate.mjs record`"];
  const r = await recordFrom({
    spec, named,
    answers: readJson(join(dir, "answers.json")) ?? {},
    request: existsSync(join(dir, "request.md")) ? readFileSync(join(dir, "request.md"), "utf8") : "",
    stack: readJson(join(dir, "stack.json")),
  });
  const out = [];
  if (r.text !== text) out.push(`architecture-record.md is not what the generator writes from architecture.json and answers.json; run \`node .adlc/generate.mjs record\`, and ${NOT_BY_HAND}`);
  for (const f of r.forbidden) out.push(`the record would carry ${f}; a record names no model, model provider, address or credential`);
  for (const f of r.findings) out.push(`architecture.json: ${f}`);
  for (const q of r.questions) out.push(`the person has not answered ${q.key}: ${q.question} Ask them, and put their answer in answers.json under ${q.key}`);
  if (!r.questions.length) for (const p of r.problems) out.push(`the record is not finished: ${p}`);
  return out;
}

// ---------- The agent's files ----------

/** The check on the agent's files: every one is what the generators write
 *  from the spec, the record and prose.json; every prose key is written; the
 *  files hold what good files hold and every declaration the spec keeps; they
 *  carry no address; and the packer accepts them. */
export async function filesProblems(dir, _lock, { env = process.env, packer = pack } = {}) {
  const spec = readJson(join(dir, "spec.json"));
  const recordText = existsSync(join(dir, "architecture-record.md")) ? readFileSync(join(dir, "architecture-record.md"), "utf8") : "";
  const prose = readJson(join(dir, "prose.json"));
  if (!prose) return ["prose.json is not in the folder; run `node .adlc/generate.mjs files`, which lays out every key, then write the words"];
  const r = filesFrom({ spec, recordText, prose });
  const out = [];
  for (const k of r.empty) out.push(`prose.json: ${k} is empty`);
  for (const k of r.unknown) out.push(`prose.json: ${k} is not a key of the agent's files; move its words to the key that is, or delete it`);
  for (const k of r.refused) out.push(`prose.json: ${k} is fixed by the spec; take it out of prose.json`);
  for (const k of r.misshapen) out.push(`prose.json: ${k === "refuses" ? "refuses is a list of sentences" : `${k} is one string`}`);
  out.push(...r.problems);
  for (const [rel, text] of Object.entries(r.files)) {
    const at = join(dir, rel);
    if (!existsSync(at)) out.push(`${rel} is not in the folder; run \`node .adlc/generate.mjs files\``);
    else if (readFileSync(at, "utf8") !== text) out.push(`${rel} is not what the generators write from the spec, the record and prose.json; run \`node .adlc/generate.mjs files\`, and ${NOT_BY_HAND}`);
  }
  if (out.length) return out;
  out.push(...checkDraft(r.draft, { architecture: r.architecture, given: givenOfSpec(spec), table: loadSchemas() }));
  out.push(...addressProblems(r.worded));
  out.push(...declarationProblems(spec, r.files));
  if (out.length) return [...new Set(out)];
  const packed = packer(dir, { env });
  if (!packed.ok) out.push(`the packer (${PACKER.package} ${PACKER.version}, Common Agent ${PACKER.common_agent}) refuses the folder: ${packed.refused}`);
  return out;
}

// ---------- Test ----------

/** The Test check: the standard checks are the test writer's own bytes;
 *  every approved scenario has a test named for it and no test is named for
 *  no scenario; the test writer's rules for exact values and kept interfaces
 *  hold; and against empty stand-ins for every script the suite fails, while
 *  every test that touches no script passes beside the agent's own files. */
export function testProblems(dir, _lock, { spawn } = {}) {
  const spec = readJson(join(dir, "spec.json"));
  const out = [];
  const standard = standardTestsOf(spec);
  for (const [rel, text] of Object.entries(standard)) {
    if (!existsSync(join(dir, rel))) out.push(`${rel} is not in the folder; run \`node .adlc/generate.mjs tests\``);
    else if (readFileSync(join(dir, rel), "utf8") !== text) out.push(`${rel} is the test writer's standard check and is not its bytes; run \`node .adlc/generate.mjs tests\`, and ${NOT_BY_HAND}`);
  }
  const files = suiteFiles(dir);
  const own = files.filter((f) => !(f.path in standard));
  if (!own.length) return [...out, "there are no tests of the agent's own under test/; write one file per feature, each test named with the scenario it checks in square brackets (\"[F1.A1] ...\")"];
  // A test is tied to the approved spec through a scenario, a requirement
  // (Requirements holds every requirement to a scenario) or a constraint (a
  // constraint has no scenario, and the test writer names its test for it).
  const approved = new Set([
    ...scenariosOf(spec).map((s) => s.id),
    ...kinds(spec).map((r) => trim(r?.id)),
    ...list(spec?.constraints).map((c) => trim(c?.id)),
  ].filter(Boolean));
  for (const f of own) {
    for (const name of testNamesIn(f.text)) {
      if (!bracketIdsOf(name).some((id) => approved.has(id))) out.push(`${f.path}: the test "${name}" is named for nothing approved; open its name with the scenario, requirement or constraint it checks in square brackets ("[F1.A1] ...", "[F1.R2] ...", "[C1] ..."), or take it out: a behaviour the spec does not state goes back to the spec`);
    }
  }
  out.push(...specFindings([...files, ...supportFiles(dir)], spec, { skip: Object.keys(standard) }));
  if (out.length) return out;
  // Against empty stand-ins it is the builder's own tests that must fail: the
  // standard checks fail there by themselves, and would hide a suite that
  // asserts nothing. Every file is placed, so an own test that imports a
  // standard check still loads it; only the own tests are run.
  const all = [...files, ...supportFiles(dir)];
  const agent = loadSpec(dir);
  const ownPaths = own.map((f) => f.path);
  const scratch = mkdtempSync(join(tmpdir(), "adlc-standins-"));
  let run;
  try {
    const scripts = standInPackage(agent, scratch, dir);
    placeSuite(all, scratch);
    run = { scripts: scripts.length, ...runSuite(scratch, ownPaths, spawn ? { spawn } : {}) };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  if (run.timed_out) out.push("against empty stand-ins for the scripts the suite did not finish in time; a test waits on something that never comes");
  else if (!run.fails) out.push(`against empty stand-ins for the ${run.scripts} script${run.scripts === 1 ? "" : "s"} the suite passes (${run.pass} of ${run.tests} of its own tests), so it asserts nothing about them; each scenario's test must fail until the code does what it says`);
  const d = declarationRun({ spec: agent, files: all, folder: dir, ...(spawn ? { spawn } : {}) });
  for (const u of d.unpassable ?? []) out.push(`${u.path}: the test "${u.name}" touches no script and fails against the agent's own files, so no script can make it pass; it is wrong about the files, not the code`);
  for (const w of d.wrong_values ?? []) out.push(`a worked value disagrees with its own computation: ${w}`);
  return out;
}

// ---------- Code ----------

/** The Code check: nothing pinned changed (held before any stage's check),
 *  the whole suite passes over the real scripts, each script the agent's
 *  files name, blanked in turn, is noticed by the suite, and the packer
 *  accepts the folder with its scripts. The code writer's own check is not
 *  imported here: it runs as a command when the command run is named
 *  check.mjs, as this one is. */
export function codeProblems(dir, _lock, { env = process.env, packer = pack, spawn } = {}) {
  const out = [];
  const scripts = codeScriptsOf(specOfFolder(dir));
  for (const s of scripts) if (!existsSync(join(dir, s)) || !trim(readFileSync(join(dir, s), "utf8"))) out.push(`${s} is not written; the agent's files name it, and the code is yours to write`);
  if (out.length) return out;
  const paths = suiteFiles(dir).map((f) => f.path);
  const run = runTests(dir, paths, spawn ? { spawn } : {});
  if (run.timed_out) return ["the suite did not finish in time over the scripts; a script waits on something that never comes"];
  if (run.fails) {
    const failing = run.failing.filter((n) => !/^test[\\/]/.test(n) || run.failing.length === 1).slice(0, 20);
    return [`the suite fails over the scripts: ${run.fail} of ${run.tests}. The tests are pinned, so the scripts change, never the tests${failing.length ? `:\n${failing.map((n) => `      not ok: ${n}`).join("\n")}` : ""}`];
  }
  for (const b of blankEach(dir, scripts, paths, spawn)) {
    if (!b.noticed) out.push(`${b.script}, blanked, is not noticed by the suite: nothing tests it. The tests are pinned, so ask the person to send the build back to Test (\`node .adlc/approve.mjs --send-back test\`)`);
  }
  if (out.length) return out;
  const packed = packer(dir, { env });
  if (!packed.ok) out.push(`the packer (${PACKER.package} ${PACKER.version}, Common Agent ${PACKER.common_agent}) refuses the folder with its scripts: ${packed.refused}`);
  return out;
}

/** The suite run as the test writer runs it (node --test, TAP, no trace of a
 *  parent runner), with every failing test's name kept, not only the tail. */
export function runTests(dir, paths, { spawn = spawnSync } = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
  const r = spawn("node", ["--test", "--test-reporter=tap", ...paths], { cwd: dir, env, encoding: "utf8", timeout: RUN_SECONDS * 1000 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const count = (k) => Number(new RegExp(`^# ${k} (\\d+)$`, "m").exec(out)?.[1] ?? 0);
  const tests = count("tests"); const fail = count("fail");
  const status = typeof r.status === "number" ? r.status : 1;
  return {
    tests, pass: count("pass"), fail, timed_out: !!r.error && /ETIMEDOUT|timed out/i.test(String(r.error?.code ?? r.error?.message ?? "")),
    fails: status !== 0 || fail > 0 || tests === 0,
    // A file that did not load is a "not ok" at the top level, named by its path.
    failing: [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => trim(m[1])).filter((n, i, a) => a.indexOf(n) === i),
  };
}

/** Each script blanked in turn, in a copy of the folder: does the suite fail? */
function blankEach(dir, scripts, paths, spawn) {
  const scratch = mkdtempSync(join(tmpdir(), "adlc-blank-"));
  try {
    return scripts.map((s, i) => {
      const at = join(scratch, `without-${i}`);
      cpSync(dir, at, { recursive: true, filter: (src) => !/(?:^|[\\/])(?:\.git|records|node_modules)(?:[\\/]|$)/.test(relative(dir, src)) });
      writeFileSync(join(at, s), "");
      return { script: s, noticed: runTests(at, paths, spawn ? { spawn } : {}).fails };
    });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** Each stage's check, by name. A stage without one here is not built yet. */
export const CHECKS = {
  requirements: requirementsProblems,
  architecture: architectureProblems,
  files: filesProblems,
  test: testProblems,
  code: codeProblems,
};
