// The reading step: what the spec declares, recorded without judging it.
//   node --test test/declared.test.mjs
//
// The thing worth pinning is the absence of opinion. This step decides
// nothing about what is worth testing; it lists what the spec says so the
// writer works from the declaration and the checker knows which scripts to
// stand in. What it must get right is that a fact is a fact: every script
// once, the command lines with the variables the harness actually sets, and
// a stop with no model when what arrived is not a spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { NOT_A_SPEC, commandsOf, declaredOf, looksLikeSpec, summary } from "../scripts/declared.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "declared.mjs");

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const SPEC = {
  name: "watcher", version: "0.1.0",
  jobs: [
    {
      slug: "report", title: "Report", offered: true, steps: ["read", "say"],
      when: "when somebody wants to know who answered", good: "A report.", empty: "Says so.", does: "Reads and reports.",
      how, inputs: [{ name: "the roster", kind: "text", required: true }], outputs: [{ name: "the report", kind: "text/plain", when: "per_task" }],
      scripts: ["scripts/read.mjs", "scripts/say.mjs", "scripts/pieces.mjs"],
      instructions: "1. ROSTER=<file> RECORDS=<records folder> node ~/watcher/skills/report/scripts/read.mjs\n\n2. Run `RECORDS=<records folder> node scripts/say.mjs --job <job folder> --quiet` and print its reply.",
    },
    { slug: "read", title: "Read", when: "first", good: "A record.", empty: "Stops.", does: "Reads.", how, scripts: ["scripts/read.mjs"] },
    { slug: "say", title: "Say", when: "last", good: "A reply.", empty: "Says nothing is known.", does: "Writes the reply.", how, scripts: ["scripts/say.mjs"] },
  ],
  records: [{ name: "the report", when: "per_task", file: "*/report.json" }],
  refuses: ["Restarting anything, because that is a person's act."],
  systems: [{ name: "platform", access: "read", env: "PLATFORM_TOKEN", settings: [{ env: "PLATFORM_URL", purpose: "where" }] }],
  runtimes: [{ name: "node", version: ">=22" }],
  directories: [{ name: "records", purpose: "records" }],
};

test("a spec is told by what it carries, and anything else is not one", () => {
  assert.equal(looksLikeSpec(SPEC), true);
  assert.equal(looksLikeSpec({ name: "x", jobs: [] }), false, "no jobs is no spec");
  assert.equal(looksLikeSpec({ name: "x", jobs: [{ title: "no slug" }] }), false);
  assert.equal(looksLikeSpec({ jobs: [{ slug: "a" }] }), false, "a spec with no name is not a spec");
  assert.equal(looksLikeSpec([SPEC]), false);
  assert.throws(() => declaredOf({ name: "x" }), /not a spec/);
});

test("the command lines are read out of the instructions, with the variables set before node and the flags after", () => {
  const cmds = commandsOf(SPEC.jobs[0].instructions);
  assert.equal(cmds.length, 2);
  assert.equal(cmds[0].script, "read.mjs");
  assert.deepEqual(cmds[0].variables, ["ROSTER", "RECORDS"]);
  assert.deepEqual(cmds[0].flags, []);
  assert.equal(cmds[1].script, "say.mjs");
  assert.deepEqual(cmds[1].variables, ["RECORDS"]);
  assert.deepEqual(cmds[1].flags, ["job", "quiet"], "flags after the script are the script's, not the shell's");
  // A line with no node in it is prose, not a command.
  assert.deepEqual(commandsOf("Print the reply and nothing else."), []);
  assert.deepEqual(commandsOf(undefined), []);
});

test("the declaration lists every script once, in the order named, and each job's four sentences", () => {
  const d = declaredOf(SPEC);
  assert.equal(d.declared, "v1");
  assert.equal(d.name, "watcher");
  assert.deepEqual(d.scripts, ["scripts/read.mjs", "scripts/say.mjs", "scripts/pieces.mjs"], "read.mjs is named by two jobs and listed once");
  const report = d.jobs.find((j) => j.slug === "report");
  assert.equal(report.offered, true);
  assert.deepEqual(report.steps, ["read", "say"]);
  for (const k of ["when", "good", "empty", "does"]) assert.equal(report[k], SPEC.jobs[0][k], k);
  assert.deepEqual(report.inputs, [{ name: "the roster", kind: "text", required: true }]);
  assert.equal(report.commands.length, 2);
  assert.deepEqual(d.records, [{ name: "the report", when: "per_task", file: "*/report.json" }]);
  assert.deepEqual(d.systems, [{ name: "platform", access: "read", env: "PLATFORM_TOKEN", settings: ["PLATFORM_URL"] }]);
  // Common Agent 0.16.0-draft renamed systems[].role to systems[].name and
  // keeps `role` as an alias for one revision: a spec in either spelling is
  // read, and a spec that carries both is read as `name`.
  const aliased = declaredOf({ ...SPEC, systems: [{ role: "platform", access: "read" }] });
  assert.deepEqual(aliased.systems, [{ name: "platform", access: "read", env: null, settings: [] }]);
  const both = declaredOf({ ...SPEC, systems: [{ name: "platform", role: "the-alias", access: "read" }] });
  assert.equal(both.systems[0].name, "platform");
  assert.deepEqual(d.directories, ["records"]);
  // A job that says nothing is recorded as saying nothing, not filled in.
  const thin = declaredOf({ name: "t", version: "0.0.1", jobs: [{ slug: "a" }] });
  assert.equal(thin.jobs[0].good, null);
  assert.deepEqual(thin.jobs[0].scripts, []);
});

test("the summary counts what is there and says when no script is named, because a suite could import nothing", () => {
  assert.match(summary(declaredOf(SPEC)), /^watcher 0\.1\.0; 3 jobs \(1 offered\); 3 scripts; 1 record; 1 refusal$/);
  const none = summary(declaredOf({ name: "t", version: "1.0.0", jobs: [{ slug: "a" }] }));
  assert.match(none, /no scripts named, so there is nothing a suite could import/);
});

test("as a process it exits 2 when called wrong, and 3 with a reply when what arrived is not a spec", () => {
  const wrong = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, SPEC: "", RECORDS: "" } });
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /SPEC and RECORDS are required/);
  const dir = mkdtempSync(join(tmpdir(), "test-writer-"));
  try {
    const notSpec = join(dir, "spec.json");
    writeFileSync(notSpec, JSON.stringify({ hello: "world" }));
    const r = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, SPEC: notSpec, RECORDS: join(dir, "records") } });
    assert.equal(r.status, 3);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.reply, NOT_A_SPEC);
    const real = join(dir, "real.json");
    writeFileSync(real, JSON.stringify(SPEC));
    const ok = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, SPEC: real, RECORDS: join(dir, "records") } });
    assert.equal(ok.status, 0);
    const said = JSON.parse(ok.stdout);
    assert.equal(said.ok, true);
    assert.match(said.said, /3 scripts/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
