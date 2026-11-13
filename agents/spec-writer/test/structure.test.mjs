// The Design by code: the structure of the agent's own files from the spec,
// the prose from the model, a revision as an edit.
//   node --test test/structure.test.mjs
//
// No model and no network: the stand-in model is a function in this file.
// In the round trip on hn-reader (2026-11-09) the Design was a fresh model
// draft every time: asked to rename one output, it renamed the offering, its
// step and its skill folder too, and the build could never pass, because the
// files disagreed with the spec. What is pinned: every structural field is
// code's (a model that answers one is not heard); every declaration the
// spec keeps is at its place in the files; the package maker takes them; a
// revision that renames one output changes that output's name and nothing
// else, its about staying the one the spec gives it (0.10.2), and the
// offering, steps, skill folders and run command staying as they were; and words about the files alone leave the spec byte for byte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordOf, seedSpec } from "../scripts/seed.mjs";
import { mergeFill, writeTheSpec } from "../scripts/spec.mjs";
import { declarationProblems, parseDeclaredIn, valueAt } from "../scripts/declared.mjs";
import { carriedProse, houseRun, mergeProse, namedProse, proseSlots, proseUnchangedProblems, runOf, schemaWithoutAddresses, slugOf, structureOf } from "../scripts/structure.mjs";
import { designFromSpec } from "../scripts/draft.mjs";
import { agentFilesOf } from "../scripts/files.mjs";
import { checkBuilds } from "../scripts/builds.mjs";
import { askedWithV3, fillFor, keysAsked, proseFor } from "./as-built-fixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_PY = join(HERE, "..", "..", "package-maker", "build.py");
const SAID = "Write a spec.\nname: tide-reader\nprice: free\ndropped: B3\n";
const theSpec = () => { const seed = seedSpec(recordOf(askedWithV3(SAID)), { said: SAID }); return mergeFill(seed, fillFor(seed)); };
const promptOf = (req) => req.body.contents[0].parts.map((p) => p.text).join("\n\n");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A stand-in model that writes the prose it is asked for, and also answers
 *  structural fields and prose it was not asked for, which code must not
 *  hear. */
const greedy = (tag = "") => async (req) => {
  const p = promptOf(req);
  const a = proseFor(p, { tag });
  for (const slug of ["read-the-tides", "fetch-the-table", "write-the-tides"]) {
    a.jobs[slug] = { does: `Something else entirely${tag}.`, when: `when anything at all happens${tag}`, ...(a.jobs[slug] ?? {}), slug: "renamed-by-the-model", title: "Renamed" };
  }
  a.offerings = [{ id: "renamed-by-the-model" }];
  a.description ??= `A description nobody asked for${tag}.`;
  return { text: JSON.stringify(a) };
};

test("where a declaration points is a file and a path into it", () => {
  assert.deepEqual(parseDeclaredIn("agent-descriptor.json offerings[0].outputs[1].name"), { file: "agent-descriptor.json", path: ["offerings", 0, "outputs", 1, "name"], text: "agent-descriptor.json offerings[0].outputs[1].name" });
  assert.deepEqual(parseDeclaredIn("agent-runtime-requirements.json run.read-the-tides.command").path, ["run", "read-the-tides", "command"]);
  assert.deepEqual(parseDeclaredIn('plugin.json extensions["net.agentdoc.package"].build').path, ["extensions", "net.agentdoc.package", "build"]);
  assert.equal(parseDeclaredIn("offerings[0].id"), null, "a place with no file is not a declaration's place");
  assert.equal(valueAt({ a: [{ b: 2 }] }, ["a", 0, "b"]), 2);
});

test("the structure is the spec's: offering, steps, pieces, labels, settings, systems, command and price, all by code", () => {
  const { draft, problems } = structureOf(theSpec());
  assert.deepEqual(problems, []);
  assert.deepEqual(draft.jobs.map((j) => [j.slug, j.offered, j.steps ?? null]), [["read-the-tides", true, ["fetch-the-table", "write-the-tides"]], ["fetch-the-table", false, null], ["write-the-tides", false, null]]);
  const job = draft.jobs[0];
  assert.equal(job.title, "Read the tides");
  assert.deepEqual(job.inputs.map((i) => [i.name, i.kind, i.label]), [["harbor", "text", "Harbor"]]);
  assert.deepEqual(job.outputs.map((o) => [o.name, o.kind]), [["tides", "application/vnd.example.tides+json"], ["tide report", "text/markdown"]]);
  assert.equal(job.outputs[0].schema.properties.chart.const, undefined, "an address in a schema stays in the spec");
  assert.equal(job.outputs[0].schema.properties.format.const, "tides-v1");
  assert.deepEqual(job.run, { command: ["node", "{home}/{package}/skills/read-the-tides/scripts/tides.mjs", "--job", "{job_dir}", "--records", "{records}"], reply: "json:reply" });
  assert.deepEqual(job.scripts, ["scripts/tides.mjs", "scripts/stop.mjs"], "the dropped behavior's module is no script");
  assert.deepEqual(draft.run_config.settings[0], { name: "how_many", kind: "preference", label: "How many tides", about: draft.run_config.settings[0].about, default: 12, min: 1, max: 24, step: 1, job_may_set: true });
  assert.deepEqual(draft.systems[0].settings[0], { env: "TIDE_SERVICE_ADDRESS", purpose: draft.systems[0].settings[0].purpose, default: "https://tides.example.org/api" });
  assert.equal(draft.systems[0].name, "tide-service");
  assert.deepEqual(draft.price, { model: "free" });
  assert.deepEqual(draft.runtimes, [{ name: "node" }]);
  for (const k of proseSlots(draft)) assert.ok(!/^job:.*\.(?:does|when|good|empty|instructions)$/.test(k) || draft.jobs.find((j) => k.startsWith(`job:${j.slug}.`))[k.split(".").pop()] === "", `${k} is left for the model`);
});

test("a system's credential and its settings reach the runtime requirements by variable, with no value (spec-v1 1.3.0)", () => {
  const spec = theSpec();
  spec.systems.push(
    { name: "code-host", reach: "read", why: "To read the merged pull requests, on GitHub.", credential: { name: "code-host token", env: "CODE_HOST_TOKEN" }, settings: [{ env: "CODE_HOST_ADDRESS", purpose: "where the code host's API answers" }] },
    { name: "team-chat", reach: "write", why: "To post the draft, on Slack.", credential: { name: "team-chat token", env: "TEAM_CHAT_TOKEN" } },
    { name: "public-feed", reach: "read", why: "A keyless public feed.", credential: "none" },
  );
  const { draft, problems } = structureOf(spec);
  assert.deepEqual(problems, []);
  const by = Object.fromEntries(draft.systems.map((s) => [s.name, s]));
  assert.equal(by["code-host"].credential, "code-host token");
  assert.equal(by["code-host"].env, "CODE_HOST_TOKEN");
  assert.deepEqual(by["code-host"].settings, [{ env: "CODE_HOST_ADDRESS", purpose: "where the code host's API answers" }]);
  assert.equal(by["team-chat"].env, "TEAM_CHAT_TOKEN");
  assert.equal(by["team-chat"].settings, undefined);
  assert.equal(by["public-feed"].credential, undefined, "none takes no credential");
  const runtime = JSON.parse(agentFilesOf(draft)["agent-runtime-requirements.json"]);
  const rt = Object.fromEntries(runtime.systems.map((s) => [s.name, s]));
  assert.deepEqual(rt["code-host"], { name: "code-host", kind: "service", credential: "code-host token", env: "CODE_HOST_TOKEN", settings: [{ env: "CODE_HOST_ADDRESS", purpose: "where the code host's API answers" }] });
  assert.deepEqual(rt["team-chat"], { name: "team-chat", kind: "service", credential: "team-chat token", env: "TEAM_CHAT_TOKEN" });
});

test("with no declaration the offering comes from the features' offering, and a command's flags take what the host puts after each", () => {
  const spec = theSpec();
  spec.interfaces = spec.interfaces.filter((i) => i.kind !== "declaration");
  spec.features[0].offering = "Read the tides";
  const a = structureOf(spec).draft;
  const b = structureOf(structuredClone(spec)).draft;
  assert.deepEqual(a, b, "the same spec gives the same structure");
  assert.deepEqual(a.jobs.map((j) => j.slug), ["read-the-tides"]);
  assert.deepEqual(a.jobs[0].outputs.map((o) => o.name), ["tides"], "a file the code writes is a piece; the behavior's other words are not");
  assert.deepEqual(a.jobs[0].run.command, ["node", "{home}/{package}/skills/read-the-tides/scripts/tides.mjs", "--job", "{job_dir}", "--records", "{records}"], "an optional flag the host has nothing for is left out");
  const r = runOf("x", { id: "I9", name: "scripts/x.mjs", flags: ["--job", "--file", "--colour"], required_flags: ["--job", "--colour"] });
  assert.deepEqual(r.run, { command: ["node", "{home}/{package}/skills/x/scripts/x.mjs", "--job", "{job_dir}"], per_file: ["--file", "{file_path}::{file_media_type}"], reply: "json:reply" });
  assert.match(r.problems[0], /requires --colour, and the host has nothing to put after it/);
  assert.equal(slugOf("Arbitrary URLs supplied by the stories"), "arbitrary-urls-supplied-by-the-stories");
  assert.equal(schemaWithoutAddresses({ $schema: "https://json-schema.org/draft/2020-12/schema", enum: ["a", "https://x.example/"] }).taken, 1);
});

// 2026-11-12: time-zone-converter's command read {job_dir}/message.txt, and its
// run named no message_file, so the host wrote the sender's text nowhere and the
// installed agent answered every message as if it were empty.
test("a command handed the sender's text declares message_file at the same path, and one without it declares none", () => {
  const house = houseRun("convert");
  assert.equal(house.message_file, "{job_dir}/message.txt");
  assert.equal(house.command[house.command.indexOf("--text-file") + 1], house.message_file);
  const named = runOf("x", { id: "I1", name: "scripts/x.mjs", flags: ["--job", "--message-file"] }).run;
  assert.equal(named.message_file, "{job_dir}/message.txt");
  const none = runOf("x", { id: "I2", name: "scripts/x.mjs", flags: ["--job", "--file"] }).run;
  assert.equal("message_file" in none, false, "a command that is given only files names no message file");
});

test("the model writes the prose, and only the prose: a structural field it answers is not heard", async () => {
  const spec = theSpec();
  const prompts = [];
  const call = async (req) => { prompts.push(promptOf(req)); return greedy()(req); };
  const out = await designFromSpec({ spec, call, table: null });
  assert.equal(out.calls, 1);
  assert.match(prompts[0], /Code has already written every structural field/);
  // A piece's about that the spec gives is the spec's, and is not asked.
  const built = structureOf(spec);
  assert.ok(built.fixed.includes("job:read-the-tides.outputs:tides.about"));
  assert.deepEqual(keysAsked(prompts[0]), proseSlots(built.draft).filter((k) => !built.fixed.includes(k)));
  assert.deepEqual(out.spec.jobs.map((j) => j.slug), ["read-the-tides", "fetch-the-table", "write-the-tides"]);
  assert.equal(out.spec.jobs[0].title, "Read the tides");
  assert.equal(out.spec.offerings, undefined);
  assert.match(out.spec.jobs[0].when, /^when somebody wants the next tides/);
  assert.match(out.spec.systems[0].needs, /tides\.example\.org/);
  assert.match(out.spec.systems[0].needs, /writes down links to charts\.example\.net, which it never calls/);
  assert.deepEqual(out.findings, []);
  assert.deepEqual(declarationProblems(spec, agentFilesOf(out.spec)), []);
  assert.equal(out.design.mode, "fresh");
});

test("every declaration the spec keeps is at its place in the files, and a file that says otherwise is found", async () => {
  const spec = theSpec();
  const out = await designFromSpec({ spec, call: greedy(), table: null });
  const files = agentFilesOf(out.spec);
  assert.deepEqual(declarationProblems(spec, files), []);
  const desc = JSON.parse(files["agent-descriptor.json"]);
  assert.equal(desc.offerings[0].outputs[1].name, "tide report");
  assert.ok("skills/read-the-tides/SKILL.md" in files && "skills/fetch-the-table/SKILL.md" in files);
  desc.offerings[0].steps[0].id = "read-the-table";
  const bad = { ...files, "agent-descriptor.json": JSON.stringify(desc) };
  assert.deepEqual(declarationProblems(spec, bad), ['interface I9 keeps agent-descriptor.json offerings[0].steps[0].id as "fetch-the-table", and the agent\'s files say "read-the-table"; the files say what the spec keeps']);
});

test("the package maker takes the files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-structure-"));
  try {
    const out = await designFromSpec({ spec: theSpec(), call: greedy(), table: null });
    const built = checkBuilds({ spec: out.spec, env: { BUILD_PY }, keep: join(dir, "agent") });
    assert.equal(built.checked, true, "the builder ran");
    assert.deepEqual(built.problems, []);
    assert.equal(built.ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the round trip's case: a revision renaming one output leaves the offering, steps, skill folders and command as they were", async () => {
  const spec = theSpec();
  const first = await designFromSpec({ spec, call: greedy(), table: null });
  const words = "Rename the output tides to next-tides.";
  // The spec first: the stand-in model renames the output, and also tries to
  // rename the offering and its step, which the words do not name.
  const asked = { said: words, revision: { how: "sent back with changes", answers: { said: words } }, attached: [{ name: "spec.json", kind: "the spec", media_type: "application/vnd.agentmesh.spec+json", text: JSON.stringify(spec, null, 2) }] };
  const sneaky = async () => ({ text: JSON.stringify({ edits: [
    { set: "I14", value: { kind: "declaration", name: "the first output's name", keep: true, declared_in: "agent-descriptor.json offerings[0].outputs[0].name", value: "next-tides", about: spec.interfaces.find((i) => i.id === "I14").about } },
    { set: "I7", value: { ...spec.interfaces.find((i) => i.id === "I7"), value: "read-next-tides" } },
    { set: "I9", value: { ...spec.interfaces.find((i) => i.id === "I9"), value: "fetch-the-next-table" } },
  ], notes: "renamed" }) });
  const revised = await writeTheSpec({ asked, call: sneaky });
  assert.deepEqual(revised.revised.changed, ["I14"], "only the output's declaration changed in the spec");
  assert.equal(revised.spec.interfaces.find((i) => i.id === "I7").value, "read-the-tides");
  // Then the files, from the revised spec, with the earlier files in hand.
  const prompts = [];
  const call = async (req) => { prompts.push(promptOf(req)); return greedy(" (again)")(req); };
  const second = await designFromSpec({ spec: revised.spec, call, earlier: first.spec, words, table: null });
  assert.equal(prompts.length, 0, "the renamed output's about is the spec's, so the model is asked nothing");
  const a = agentFilesOf(first.spec);
  const b = agentFilesOf(second.spec);
  assert.deepEqual(Object.keys(b), Object.keys(a), "the same files: the same skill folders");
  const da = JSON.parse(a["agent-descriptor.json"]);
  const db = JSON.parse(b["agent-descriptor.json"]);
  assert.deepEqual([db.offerings[0].id, db.offerings[0].name, db.offerings[0].steps.map((s) => s.id)], [da.offerings[0].id, da.offerings[0].name, da.offerings[0].steps.map((s) => s.id)]);
  assert.equal(db.offerings[0].outputs[0].name, "next-tides");
  assert.equal(db.offerings[0].outputs[0].about, da.offerings[0].outputs[0].about, "the about is the spec's, as it was");
  db.offerings[0].outputs[0].name = da.offerings[0].outputs[0].name;
  assert.ok(same(db, da), "nothing else in the descriptor changed");
  assert.equal(b["agent-runtime-requirements.json"], a["agent-runtime-requirements.json"], "the run command and everything the host reads are as they were");
  for (const k of Object.keys(a).filter((k) => k.endsWith("SKILL.md") && !k.includes("read-the-tides"))) assert.equal(b[k], a[k], `${k} is byte for byte`);
  assert.deepEqual(declarationProblems(revised.spec, b), []);
  assert.deepEqual(second.findings, []);
  assert.deepEqual(second.design.prose_written, []);
  assert.deepEqual(second.design.structure_changed, ["jobs"]);
});

test("with no declaration, a rename of one output opens only that feature's pieces: its offering, and so the skill folder, stay", async () => {
  const spec = theSpec();
  spec.interfaces = spec.interfaces.filter((i) => i.kind !== "declaration");
  spec.features[0].offering = "read-the-tides";
  const first = await designFromSpec({ spec, call: greedy(), table: null });
  assert.deepEqual(first.spec.jobs[0].outputs.map((o) => o.name), ["tides"]);
  const words = "Rename the output tides to next-tides.";
  const asked = { said: words, revision: { how: "sent back with changes", answers: { said: words } }, attached: [{ name: "spec.json", kind: "the spec", media_type: "application/vnd.agentmesh.spec+json", text: JSON.stringify(spec, null, 2) }] };
  const f1 = spec.features[0];
  // The stand-in renames the output and, as on the round trip, the offering.
  const edit = { ...f1, offering: "read-next-tides", outputs: f1.outputs.map((o) => (o.name === "out/tides.json" ? { ...o, name: "next-tides" } : o)) };
  const revised = await writeTheSpec({ asked, call: async () => ({ text: JSON.stringify({ edits: [{ set: "F1", value: edit }] }) }) });
  assert.deepEqual(revised.revised.targets, ["F1.pieces"]);
  assert.equal(revised.spec.features[0].offering, "read-the-tides", "the offering is not the words' to change");
  assert.ok(revised.spec.features[0].outputs.some((o) => o.name === "next-tides"));
  assert.match(revised.notes, /your words name F1's pieces and not its offering/);
  const second = await designFromSpec({ spec: revised.spec, call: greedy(" (again)"), earlier: first.spec, words, table: null });
  assert.deepEqual(second.spec.jobs.map((j) => j.slug), ["read-the-tides"]);
  assert.deepEqual(second.spec.jobs[0].outputs.map((o) => o.name), ["next-tides"]);
  assert.equal(second.spec.jobs[0].outputs[0].schema.properties.format.const, "tides-v1", "the renamed piece keeps its schema");
  assert.deepEqual(Object.keys(agentFilesOf(second.spec)), Object.keys(agentFilesOf(first.spec)));
  assert.equal(agentFilesOf(second.spec)["agent-runtime-requirements.json"], agentFilesOf(first.spec)["agent-runtime-requirements.json"]);
  assert.equal(second.spec.jobs[0].outputs[0].about, first.spec.jobs[0].outputs[0].about, "the renamed piece keeps the about the spec gives it");
  assert.deepEqual(second.design.prose_written, []);
});

test("words about the files alone leave the spec byte for byte and change only the prose they name", async () => {
  const spec = theSpec();
  const first = await designFromSpec({ spec, call: greedy(), table: null });
  const words = "The when line of fetch-the-table should say it runs first.";
  const asked = { said: words, revision: { how: "sent back with changes", answers: { said: words } }, attached: [{ name: "spec.json", kind: "the spec", media_type: "application/vnd.agentmesh.spec+json", text: JSON.stringify(spec, null, 2) }] };
  let specCalls = 0;
  const revised = await writeTheSpec({ asked, call: async () => { specCalls += 1; return { text: "{}" }; } });
  assert.equal(specCalls, 0, "no model is asked about the spec");
  assert.equal(JSON.stringify(revised.spec, null, 2), JSON.stringify(spec, null, 2), "the spec is byte for byte as it was");
  assert.deepEqual(revised.revised.targets, []);
  const prompts = [];
  const second = await designFromSpec({ spec: revised.spec, call: async (req) => { prompts.push(promptOf(req)); return greedy(" (first)")(req); }, earlier: first.spec, words, table: null });
  assert.deepEqual(keysAsked(prompts[0]), ["job:fetch-the-table.when"]);
  assert.match(second.spec.jobs[1].when, /\(first\)$/);
  const a = agentFilesOf(first.spec);
  const b = agentFilesOf(second.spec);
  for (const k of Object.keys(a)) if (k !== "skills/fetch-the-table/SKILL.md" && k !== "agent-descriptor.json") assert.equal(b[k], a[k], k);
  // Words that name nothing in the files ask no model at all.
  let calls = 0;
  const none = await designFromSpec({ spec, call: async () => { calls += 1; return { text: "{}" }; }, earlier: first.spec, words: "Looks good to me.", table: null });
  assert.equal(calls, 0);
  assert.deepEqual(agentFilesOf(none.spec), a);
});

test("prose a revision does not name is held byte for byte, and what the words name is read as whole words", () => {
  const { draft } = structureOf(theSpec());
  const filled = mergeProse(draft, { jobs: { "read-the-tides": { when: "when somebody wants the tides", good: "x" } }, systems: { "tide-service": "reads the tide table" } }, new Set(["job:read-the-tides.when", "system:tide-service.needs"]));
  assert.deepEqual(filled.set, ["job:read-the-tides.when", "system:tide-service.needs"], "good was not the model's to write");
  const carried = carriedProse(filled.draft, filled.draft);
  const changed = structuredClone(filled.draft);
  changed.jobs[0].when = "when anything happens";
  assert.deepEqual(proseUnchangedProblems(carried, changed, new Set()), ["job:read-the-tides.when changed, and your words do not name it; it stays as it was"]);
  assert.deepEqual(proseUnchangedProblems(carried, changed, new Set(["job:read-the-tides.when"])), []);
  assert.deepEqual([...namedProse("Rename the output tides to next-tides.", draft)], ["job:read-the-tides.outputs:tides.about"], "read-the-tides is not named by tides");
  assert.deepEqual([...namedProse("Make the refusals shorter and fix the good result of write-the-tides.", draft)].sort(), ["job:write-the-tides.good", "refuses"]);
  assert.deepEqual([...namedProse("The empty line is wrong everywhere.", draft)], ["job:read-the-tides.empty", "job:fetch-the-table.empty", "job:write-the-tides.empty"]);
});
