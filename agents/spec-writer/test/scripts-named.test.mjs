// A job that runs scripts names them (scripts/given.mjs fitToGiven,
// scripts/check-spec.mjs jobProblems).
//   node --test test/scripts-named.test.mjs
//
// No model and no network. A round trip rebuilt an agent from its as-built
// record, and every draft of the spec ran scripts/read-top-stories.mjs but
// named no scripts, so Code had nothing to write and refused. Asked twice in
// words, the model still named none. Code now fills them in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobProblems } from "../scripts/check-spec.mjs";
import { commandScripts, fitToGiven, givenOf, modulesNamed } from "../scripts/given.mjs";

const INTERFACES = {
  format: "as-built-interfaces-v1",
  interfaces: [
    { id: "I1", kind: "file", name: "out/tides.json" },
    { id: "I2", kind: "function", name: "readTides(harbor)", module: "scripts/tides.mjs", export: "readTides", evidence: [{ file: "scripts/tides.mjs", line: 4 }] },
    { id: "I3", kind: "function", name: "parseTable(text)", evidence: [{ file: "scripts/table.mjs", line: 9 }] },
    { id: "I4", kind: "command", name: "scripts/read-tides.mjs", command: "scripts/read-tides.mjs", flags: ["--job"] },
    { id: "I5", kind: "function", name: "outside()", module: "../shared/x.mjs" },
  ],
};
const asked = { said: "Write a spec.", attached: [{ name: "interfaces.json", kind: "data", media_type: "application/json", text: JSON.stringify(INTERFACES) }] };
const job = (extra = {}) => ({ slug: "read-the-tides", how: { control: "script", intelligence: "none", cost: "none", contract: "full" }, run: { command: ["node", "scripts/read-tides.mjs", "--job", "{job_dir}"], reply: "json:reply" }, ...extra });

test("the modules an as-built record lists are read from its functions and commands, and nothing outside scripts/", () => {
  const g = givenOf(asked);
  assert.deepEqual(modulesNamed([{ from: "interfaces.json", json: INTERFACES }]).map((m) => m.file), ["scripts/tides.mjs", "scripts/table.mjs", "scripts/read-tides.mjs"]);
  assert.deepEqual(g.modules.map((m) => m.file), ["scripts/tides.mjs", "scripts/table.mjs", "scripts/read-tides.mjs"]);
  assert.deepEqual(commandScripts(job()), ["scripts/read-tides.mjs"]);
});

test("a lone script job that names no scripts gets its command's script and every module the record lists", () => {
  const fit = fitToGiven({ name: "tides", jobs: [job()] }, givenOf(asked));
  assert.deepEqual(fit.spec.jobs[0].scripts, ["scripts/read-tides.mjs", "scripts/tides.mjs", "scripts/table.mjs"]);
  assert.match(fit.note, /runs scripts and named none/);
});

test("with two script jobs each gets only its own command's script, and a job that names scripts is left as it is", () => {
  const two = { name: "tides", jobs: [job(), job({ slug: "other", run: { command: ["node", "scripts/other.mjs"], reply: "stdout" } }), job({ slug: "kept", scripts: ["scripts/kept.mjs"] })] };
  const fit = fitToGiven(two, givenOf(asked));
  assert.deepEqual(fit.spec.jobs.map((j) => j.scripts), [["scripts/read-tides.mjs"], ["scripts/other.mjs"], ["scripts/kept.mjs"]]);
});

test("the check says when a job's command runs a script that scripts does not name", () => {
  assert.ok(jobProblems(job()).some((p) => /its command runs scripts\/read-tides\.mjs, and scripts does not name it/.test(p)));
  assert.ok(!jobProblems(job({ scripts: ["scripts/read-tides.mjs"] })).some((p) => /scripts does not name it/.test(p)));
  assert.ok(!jobProblems(job({ run: undefined })).some((p) => /scripts does not name it/.test(p)), "a job with no command is not asked for scripts");
});

test("a bare script path in a job's command is written in the packaged form the host runs, and the check says why", async () => {
  const { fitCommands, scriptOfWord } = await import("../scripts/given.mjs");
  const bare = job();
  const fit = fitCommands({ name: "tides", jobs: [bare, job({ slug: "kept", run: { command: ["node", "{home}/{package}/skills/kept/scripts/kept.mjs"], reply: "stdout" } })] });
  assert.deepEqual(fit.spec.jobs[0].run.command, ["node", "{home}/{package}/skills/read-the-tides/scripts/read-tides.mjs", "--job", "{job_dir}"]);
  assert.deepEqual(fit.spec.jobs[1].run.command, ["node", "{home}/{package}/skills/kept/scripts/kept.mjs"], "the packaged form is left alone");
  assert.match(fit.note, /named its script as a bare path/);
  assert.equal(fitCommands({ name: "tides", jobs: [fit.spec.jobs[1]] }).note, "");
  assert.equal(scriptOfWord("{home}/{package}/skills/x/scripts/a.mjs"), "scripts/a.mjs");
  assert.equal(scriptOfWord("{job_dir}"), null);
  assert.ok(jobProblems(bare).some((p) => /names scripts\/read-tides\.mjs as a bare path/.test(p)));
  assert.ok(!jobProblems({ ...fit.spec.jobs[0], scripts: ["scripts/read-tides.mjs"] }).some((p) => /bare path|scripts does not name it/.test(p)));
});
