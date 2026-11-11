// Every environment variable a script reads is declared, or placed by the host.
//   node --test test/undeclared-settings.test.mjs
//
// What is worth pinning: a variable the agent's own files do not declare is a
// finding with its file, its line and its name, in the job's own code and in
// a function handed process.env; a variable a system setting, a credential, a
// run config setting, a spec, a SKILL.md command line or the host declares is
// not; a step's own entry point is read only when a run command or a SKILL.md
// starts that script; a credential nobody binds is said once, under
// claims-match-code; and nothing is said without the declarations. That this
// package keeps the rule itself is in house-rules.test.mjs.
//
// Nothing here runs a package, touches a network or calls a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHouseRules, declaredSettings, envReads, envSets, mainBlock, undeclaredSettingFindings } from "../scripts/house-rules.mjs";
import { readOf } from "./helpers.mjs";

const json = (v) => JSON.stringify(v, null, 2) + "\n";

/** A small reader agent: one run command, one public service with an
 *  address setting, a run config setting, and a script that reads what it
 *  is handed. */
function reader({ script, runtime = {}, descriptor = {}, more = {} } = {}) {
  const rt = {
    format: "agent-runtime-requirements-v1",
    systems: [{ name: "story-list", kind: "service", settings: [{ env: "STORY_LIST_ADDRESS", purpose: "the story list's address" }] }],
    directories: [{ name: "records", purpose: "every record" }],
    run: { read: { command: ["node", "{home}/{package}/skills/read/scripts/read.mjs", "--job", "{job_dir}"], reply: "json:reply" } },
    ...runtime,
  };
  const d = {
    format: "agent-descriptor-v1", agent_version: "0.1.0", does: "Reads stories.",
    offerings: [{ id: "read", name: "Read", does: "Reads.", inputs: [], outputs: [], how: { control: "script", intelligence: "none", cost: "none", contract: "full" }, steps: [] }],
    run_config: { settings: [{ name: "count", kind: "preference", default: 10 }] },
    records: [],
    ...descriptor,
  };
  const manifest = { name: "reader", version: "0.1.0", extensions: { "net.agentdoc.package": { build: { skills: { read: { scripts: ["scripts/read.mjs"] } } } } } };
  return {
    "agent-descriptor.json": json(d),
    "agent-runtime-requirements.json": json(rt),
    "plugin.json": json(manifest),
    "skills/read/SKILL.md": "---\nname: read\ndescription: read\n---\n\n# Read\n",
    "scripts/read.mjs": script,
    ...more,
  };
}
const findingsOf = (files) => { const { read, texts } = readOf(files); return checkHouseRules(read, texts).findings.filter((f) => f.rule === "undeclared-setting"); };
const at = (out) => out.map((f) => `${f.place.file}:${f.place.line} ${/reads (\w+)/.exec(f.claim)[1]}`);

test("an address read from a variable nothing declares is a finding with its file, line and name", () => {
  const out = findingsOf(reader({ script: [
    "// reads the top stories",
    "export async function run({ env = {} } = {}) {",
    "  const base = env.STORY_LIST_ADDRESS;",
    "  const other = env.STORY_API ?? \"\";",
    "  return [base, other];",
    "}",
    "",
  ].join("\n") }));
  assert.deepEqual(at(out), ["scripts/read.mjs:4 STORY_API"]);
  assert.match(out[0].claim, /reads STORY_API, and nothing declares it: not a system's credential or setting in agent-runtime-requirements\.json, and not a name the host places\./);
  assert.match(out[0].consequence, /once deployed the script reads nothing there and reaches no service at that address/);
});

test("every form of reading is seen, and a comment, a write or a lowercase name is not", () => {
  const text = [
    "// STORY_KEY is read from env.IN_A_COMMENT",
    "const a = process.env.ONE;",
    "const b = process.env?.TWO;",
    "const c = process.env[\"THREE\"];",
    "const d = env?.[\"FOUR\"];",
    "const { FIVE, SIX: six, SEVEN = 1 } = process.env;",
    "const { EIGHT } = env;",
    "process.env.WRITTEN = \"x\";",
    "const e = process.env.npm_config_x;",
    "",
  ].join("\n");
  assert.deepEqual([...envReads(text, "scripts/x.mjs").entries()], [["ONE", 2], ["TWO", 3], ["THREE", 4], ["FOUR", 5], ["FIVE", 6], ["SIX", 6], ["SEVEN", 6], ["EIGHT", 7]]);
  assert.deepEqual([...envReads("import os\nhome = os.environ[\"A_DIR\"]\nb = os.environ.get('B_DIR')\nc = os.getenv(\"C_DIR\")\n", "scripts/x.py").keys()], ["A_DIR", "B_DIR", "C_DIR"]);
});

test("what the agent's own files declare, and what the host places, is not a finding", () => {
  const script = [
    "// reads with everything declared",
    "const { STORY_LIST_ADDRESS, LIST_TOKEN, MODEL_NAME, MODEL_MAX_OUTPUT_TOKENS } = process.env;",
    "const job = process.env.MESH_JOB_DIR, home = process.env.HOME, dir = process.env.AGENT_DIRECTORY_RECORDS;",
    "const limit = process.env.CEILING_STORY_LIST, bin = process.env.BINARY_FFMPEG;",
    "",
  ].join("\n");
  const files = reader({ script, runtime: {
    systems: [
      { name: "story-list", kind: "service", credential: "list-key", env: "LIST_TOKEN", settings: [{ env: "STORY_LIST_ADDRESS" }] },
      { name: "text-reasoning", kind: "model", protocols: ["gemini"] },
    ],
    binaries: [{ name: "ffmpeg" }],
  } });
  assert.deepEqual(at(findingsOf(files)), []);
  // Without the model system its four settings are not placed.
  const plain = reader({ script: "// reads the model\nconst m = process.env.MODEL_NAME;\n" });
  assert.deepEqual(at(findingsOf(plain)), ["scripts/read.mjs:2 MODEL_NAME"]);
});

test("a setting a handed-over spec declares is declared, and the claim names the spec", () => {
  const script = "// reads\nconst a = process.env.FROM_SPEC;\nconst b = process.env.NOWHERE_URL;\n";
  const spec = { name: "reader", version: "0.1.0", jobs: [{ slug: "read" }], systems: [{ name: "story-list", settings: [{ env: "FROM_SPEC" }] }] };
  const out = findingsOf(reader({ script, more: { "spec.json": json(spec) } }));
  assert.deepEqual(at(out), ["scripts/read.mjs:3 NOWHERE_URL"]);
  assert.match(out[0].claim, /not anything in spec\.json, and not a name the host places/);
});

test("a step's own entry point is read only when a run command or a SKILL.md starts that script", () => {
  const helper = [
    "// a helper the job imports; run on its own it is a step",
    "export const limitOf = (env) => Number(env.LIMIT_SECONDS) || 60;",
    "const thisFile = process.argv[1] ? process.argv[1].split(\"/\").pop() : \"\";",
    "if (thisFile && import.meta.url.endsWith(thisFile)) {",
    "  const { RECORDS } = process.env;",
    "  console.log(RECORDS);",
    "}",
    "",
  ].join("\n");
  assert.deepEqual(mainBlock(helper), [4, 7]);
  const files = reader({ script: "// the job\nimport { limitOf } from \"./helper.mjs\";\n", more: { "scripts/helper.mjs": helper } });
  const m = JSON.parse(files["plugin.json"]);
  m.extensions["net.agentdoc.package"].build.skills.read.scripts.push("scripts/helper.mjs");
  files["plugin.json"] = json(m);
  // The job code's own read is a finding; the step's entry point is not.
  assert.deepEqual(at(findingsOf(files)), ["scripts/helper.mjs:2 LIMIT_SECONDS"]);
  // Started by a SKILL.md, the entry point is the job, and RECORDS= on the
  // command line declares what it reads there.
  files["skills/read/SKILL.md"] += "\n1. node ~/reader/skills/read/scripts/helper.mjs\n";
  assert.deepEqual(at(findingsOf(files)), ["scripts/helper.mjs:2 LIMIT_SECONDS", "scripts/helper.mjs:5 RECORDS"]);
  files["skills/read/SKILL.md"] += "2. RECORDS=<records folder> LIMIT_SECONDS=<seconds> node ~/reader/skills/read/scripts/helper.mjs\n";
  assert.deepEqual(at(findingsOf(files)), []);
});

test("a name the package hands a program it starts is declared", () => {
  assert.deepEqual([...envSets("process.env.A_ONE = \"x\";\nspawn(\"node\", [p], { env: { ...process.env, B_TWO: \"y\" } });\nextra.C_THREE = 1;\n")].sort(), ["A_ONE", "B_TWO", "C_THREE"]);
  assert.deepEqual([...envSets("const x = { D_FOUR: 1 };\n")], []);
  const files = reader({ script: "// the job\nimport { spawnSync } from \"node:child_process\";\nconst extra = {};\nextra.STEP_INPUT = \"a\";\nspawnSync(process.execPath, [\"step.mjs\"], { env: { ...process.env, ...extra } });\n",
    more: { "scripts/step.mjs": "// a step\nconst input = process.env.STEP_INPUT;\n" } });
  assert.deepEqual(at(findingsOf(files)), []);
});

test("a credential nobody binds is said once, under claims-match-code, and a test is not read", () => {
  const { read, texts } = readOf(reader({ script: "// reads\nconst k = process.env.STORE_TOKEN;\n", more: { "test/read.test.mjs": "const t = process.env.TEST_ONLY;\n" } }));
  const out = checkHouseRules(read, texts).findings;
  assert.deepEqual(out.filter((f) => /STORE_TOKEN/.test(f.claim)).map((f) => f.rule), ["claims-match-code"]);
  assert.ok(!out.some((f) => /TEST_ONLY/.test(f.claim)));
});

test("nothing is said without the declarations to hold the code to", () => {
  const { read, texts } = readOf({ "scripts/read.mjs": "// reads\nconst a = process.env.ANYTHING;\n" });
  assert.deepEqual(undeclaredSettingFindings(read.files, texts, {}), []);
  assert.ok(declaredSettings({}).has("MESH_JOB_DIR"));
});

test("a model system places the four settings and the answer budget, and not the former names TEXT_MODEL and TEXT_API_KEY", () => {
  const placed = declaredSettings({ runtime: { systems: [{ name: "text-reasoning", kind: "model", protocols: ["openai-chat"] }] } });
  for (const n of ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL", "MODEL_MAX_OUTPUT_TOKENS"]) assert.ok(placed.has(n), n);
  assert.equal(placed.has("TEXT_MODEL"), false);
  assert.equal(placed.has("TEXT_API_KEY"), false);
});

test("with a diff, an undeclared read off the changed lines is outside the change", () => {
  const files = reader({ script: "// reads\nconst a = process.env.OLD_READ;\nconst b = process.env.NEW_READ;\n" });
  const { read, texts } = readOf(files, { scope: "diff", files: [{ path: "scripts/read.mjs", lines: [3], removed: 0 }] });
  const out = checkHouseRules(read, texts);
  assert.deepEqual(at(out.findings.filter((f) => f.rule === "undeclared-setting")), ["scripts/read.mjs:3 NEW_READ"]);
  assert.deepEqual(at(out.outside_the_change.filter((f) => f.rule === "undeclared-setting")), ["scripts/read.mjs:2 OLD_READ"]);
});

test("a run config setting read from the environment is a holding finding that names Section 5.8, and read from run-context.json it is not", () => {
  const fromEnv = findingsOf(reader({ script: [
    "// reads the count the wrong way",
    "const n = Number(process.env.COUNT ?? 10);",
    "",
  ].join("\n") }));
  assert.deepEqual(at(fromEnv), ["scripts/read.mjs:2 COUNT"]);
  assert.match(fromEnv[0].claim, /COUNT is a run config setting: a run setting arrives in the job's run-context\.json, as the member run_config, never as a variable \(Common Agent 0\.41\.0, Section 5\.8\)\./);
  assert.match(fromEnv[0].consequence, /Read it from run_config in the job's run-context\.json\./);
  const fromContext = findingsOf(reader({ script: [
    "// reads the count from the run context",
    "import { readFileSync } from \"node:fs\";",
    "export function countOf(jobDir) {",
    "  const ctx = JSON.parse(readFileSync(jobDir + \"/run-context.json\", \"utf8\"));",
    "  return ctx.run_config?.settings?.count ?? 10;",
    "}",
    "",
  ].join("\n") }));
  assert.deepEqual(at(fromContext), []);
});
