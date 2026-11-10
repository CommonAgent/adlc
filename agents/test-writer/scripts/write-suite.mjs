// Write the suite: the one step here that wakes a model, and the only one.
//
// The model is given the whole task. It gets the spec, the command lines the
// harness will run, a reference saying what a good suite carries, one whole
// suite that holds a package which runs today, and the spec that suite tests.
// It answers with the test files, and with what it could not write a test
// for and why. The program's part is not the writing. It decides when to ask,
// checks what came back, and refuses to deliver a suite that fails its own
// check.
//
// Two checks before anything is delivered. The first is static: every file
// opens by saying what it pins, names its tests as sentences, and reaches the
// scripts it is for; and every script the spec names is reached by some file.
// The second is the one that matters: the suite is run against empty stand-ins
// for every script the spec names, and it has to fail. A suite that passes
// with every function absent has asserted nothing. Where either check finds
// something, the same request goes once more with the findings appended.
// Never a third time: two goes and then the suite stands as it is, with every
// finding that survives said out loud.
//
// One file in every suite is not the model's: test/delivered-formats.test.mjs,
// the standard check that each delivered piece is what its declared kind says
// (Markdown with its convention's headings, a JSON kind with its shape, HTML,
// an address, a signed binary). It is copied whole from the references into
// every suite this writes, the model's tests call its checkDelivered on each
// job folder they fill, and a suite whose declaration has outputs and whose
// tests never call it goes back with that finding (owner, 2026-10-27).
//
// A second file is not the model's either: test/records-per-job.test.mjs, the
// standard check that each job keeps its per-job records in a folder of its
// own under the records folder every job shares, named after its job folder.
// Three agents built on dev wrote their went-without record straight into the
// records folder, so each job overwrote the last, and no suite ran two jobs
// (technical debt 639). The model's suite runs two jobs with one records
// folder and calls its checkRecordsPerJob, and a suite whose declaration keeps
// a record per job and whose tests never call it goes back with that finding.
//
// A third is test/worked-values.test.mjs, the standard check that each
// expected value a rule in the spec decides is worked twice: once as the
// literal the model expects, once as a computation in the test over the same
// input, worked(value, () => computation, what), a constant at the top of the
// file. A model works values out wrong in its head (a suite pinned 16 vowels
// where the sentence holds 14, and "HTTP" where one letter per word gives
// "HTP"), and a suite that pins a wrong value stops the build at the code
// step, where a script that keeps the spec cannot pass it (technical debt
// 646). The run beside the agent's own files evaluates every worked value,
// and each that disagrees with its own computation goes back as a finding
// naming both. A suite that works no value goes back too, unless its notes
// say why no expected value in it is decided by a rule; so does a worked
// value inside a test, where a stand-in throws before it is reached, and one
// whose computation is only a literal.
//
// A fourth is test/printed-reply.test.mjs, which runs each job's command the
// way the host does, with an empty message, and reads the reply the way the
// host does (run.reply: stdout, or json:<member> of the one JSON object
// printed). A reply that is empty there is a job the host records as stopped
// and tells the sender was cut short: consonant-ledger's run.reply named a
// member its script never printed, and nothing before the host ran the
// command line (technical debt 657). It runs on its own; the model's tests
// call nothing in it.
//
// The spec (spec-v1, stages.json 1.6.0) is what the suite is written from
// (test-writer 0.9.0). SPEC_V1 names it: the analysis Requirements hands
// back, with each feature's requirements (the exact words, patterns and
// numbers each fixes), its acceptance scenarios in Gherkin, and the
// interfaces that must be kept. It goes to the model whole, in a section of
// its own, ahead of what the agent's own files declare. The suite is then
// held to it by code (spec-rules.mjs): every acceptance scenario has a test
// named with its id, "[F1.A1] ...", every exact entry of a requirement
// verified by test is carried by a test named for its feature, and every kept
// file or message with a schema is held by some test. A fifth standard file
// is made from it with no model, test/kept-interfaces.test.mjs
// (kept-interfaces.mjs): a kept function is exported under its name from its
// module, async as its signature says; a kept command accepts its flags; and
// what a job writes to a kept file is held to its schema. Without SPEC_V1 the
// suite is written from the agent's files alone, as before, and the job says
// it went without the spec.
//
// Two things change the ask. EXISTING names a folder holding the suite the
// package already has (test/*.test.mjs): it goes to the model whole, the
// answer may only add new files, and the kept files are never rewritten. And
// a spec naming more scripts than one part holds is written in parts, each
// checked on its own, because one answer for eight scripts was cut at the
// output limit and delivered nothing.
//
//   needs: node >= 22; MODEL_NAME, MODEL_ENDPOINT, MODEL_PROTOCOL, and MODEL_KEY
//   where the endpoint asks for one, for the text-reasoning model
//   DECLARED=<declared.json> SPEC=<the agent's folder, or a spec.json> RECORDS=<records folder> WORK=<work folder>
//   [EXISTING=<folder holding test/>] [ASKED_TEXT=<the message, as a file>] [REVISE=1]
//   [DEPENDS=<folder holding scripts/ the change depends on>] [SPEC_V1=<the spec, spec-v1 JSON>]
//   [CARRIED=<folder holding the original's own tests, placed>]
//   [REFERENCE=<md>] [WORKED=<test file>] [WORKED_SPEC=<spec.json>] [KEPT_TEST=<master copy>] node write-suite.mjs
//
// One feature's tests (test-writer 0.11.0). A message with a line of its own
// "feature: <id>" asks for that feature's tests alone, as Product Factory asks
// once each feature of a version is made in a run of its own, at the same time
// as the others. The spec goes to the model and to the spec rules with that
// feature alone among its features (its interfaces, constraints, systems and
// settings kept), so the acceptance scenarios and exact entries a suite is held
// to are that feature's; a feature the spec does not hold yet is described in
// the message, and then no spec rule asks for a scenario. Each new file is
// named for the feature, test/<id in lower case>-<name>.test.mjs, renamed so by
// code when the model names it otherwise, so two features' suites never write
// the same file. The standard checks are the same bytes in every feature's
// suite. With a suite attached it adds, as always.
//
// The original's own tests are carried (test-writer 0.10.0). CARRIED names a
// folder job.mjs filled by code (carried.mjs): each original test at
// test/<name>, unchanged but for the import specifiers the manifest lists,
// each support file at test/support/<path from the repository's top>, and
// their record, test/carried-tests.json. They go to the model whole, as the
// strongest check the rebuild meets; the model never answers with one of
// their names, a revision never changes one, and they are delivered with the
// suite. Every test file of the suite, carried, kept and new, is checked to
// load, by code: node --check passes, and an ES module test uses no
// __dirname, __filename or require it does not declare. A new file that
// fails goes back to the model as a finding; a carried or kept one that fails
// is said in the reply, and never edited.
//
// The model is reached through the shared model caller (model-caller.mjs,
// Common Agent 12.4.1) and nothing else: which model, where it is, the
// credential and the request format are the four settings the install places,
// read on every call, and the package names no model and no address of its
// own. With a setting missing, a protocol the package does not declare, or
// the declared protocols unreadable, no call is made and the job is refused
// in words. The service is sent a
// generous output limit, and an answer cut at that limit is refused as cut,
// because a cut answer otherwise reads as a malformed one.
//
// The files the change depends on go in whole. DEPENDS names a folder holding
// attached scripts under scripts/, and every shared copy the spec names that
// this package carries too (model-caller.mjs, went-without.mjs,
// agent-folder.mjs) is read from this package's own copy. Each goes into the
// request with the names it exports, and a test that imports from one of them
// a name it does not export is a static finding naming the name and the file.
// With none attached and none named, the request is as it was.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { standInChecks, suiteFiles } from "./check-suite.mjs";
import { note } from "./went-without.mjs";
import { DESCRIPTOR_FILE, MANIFEST_FILE, RUNTIME_FILE, loadSpec } from "./agent-folder.mjs";
import { callModel, cannotCall, modelSettings } from "./model-caller.mjs";
import { asyncThrowsFindings, namedByScenario, namedTestsIn, pinFindings, restoreNotes, restoreUnnamed, scenarioIdsIn } from "./suite-rules.mjs";
import { isSpecV1, keptOf, scenariosOf, specFindings, testedRequirements } from "./spec-rules.mjs";
import { keptInterfacesTest } from "./kept-interfaces.mjs";
import { CARRIED_RECORD, carriedWords, loadFindings } from "./carried.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** The model, as the shared caller reads it from the install's settings. The
 *  package names no model of its own, because a model named in a package is a
 *  rebuild waiting to happen: models are retired on somebody else's schedule.
 *  With none set, the job is refused in words. */
export const modelOf = (env = {}) => modelSettings(env).name;

/** The request formats the package's text-reasoning system declares, read
 *  from agent-runtime-requirements.json beside the package (one level up in
 *  the source, three in a built package's skills/<slug>/scripts/). Where the
 *  declaration is not found, cannot be read or names none, null, and then
 *  nothing is sent and the job is refused (PROTOCOLS_UNREAD). `here` is the
 *  scripts folder the file is looked for above, so a test can point it at
 *  another file. */
export function declaredProtocols(here = HERE) {
  for (const at of [join(here, "..", "agent-runtime-requirements.json"), join(here, "..", "..", "..", "agent-runtime-requirements.json")]) {
    if (!existsSync(at)) continue;
    try {
      const sys = (JSON.parse(readFileSync(at, "utf8"))?.systems ?? []).find((s) => s?.name === "text-reasoning");
      if (Array.isArray(sys?.protocols) && sys.protocols.length) return sys.protocols.map(String);
    } catch { /* an unreadable declaration is no declaration */ }
  }
  return null;
}

/** Why the job is refused when the declared protocols could not be read:
 *  without them the caller would hold MODEL_PROTOCOL to nothing and send
 *  whatever it speaks (Common Agent 12.4.1), so nothing is sent. */
export const PROTOCOLS_UNREAD = "the model system's declared protocols could not be read from agent-runtime-requirements.json, so nothing was sent to the model";

/** Why no call is made, or "" when one can be: a setting the caller refuses,
 *  or the declared protocols unread. */
export function whyNoCall(env = process.env, { protocols = declaredProtocols() } = {}) {
  const read = Array.isArray(protocols) && protocols.length;
  return cannotCall(env, { protocols: read ? protocols : undefined }) || (read ? "" : PROTOCOLS_UNREAD);
}

/** The call the job makes: the prompt as plain text through the shared
 *  caller, streamed, with this env and the package's declared protocols,
 *  noting what each call used in `used`. With the declared protocols unread
 *  it throws PROTOCOLS_UNREAD before anything is sent. */
export function callFor(env = process.env, { protocols = declaredProtocols(), fetchImpl, used = [] } = {}) {
  return async (request) => {
    if (!(Array.isArray(protocols) && protocols.length)) throw new Error(PROTOCOLS_UNREAD);
    // Streamed, so a long suite is never lost to a wait for headers.
    const got = await callModel(promptOf(request), { env, protocols, ...(fetchImpl ? { fetchImpl } : {}), maxOutputTokens: OUTPUT_TOKENS, stream: true });
    used.push({ service: got.protocol, asked: got.model, answered_by: got.answered_by, tokens_in: got.tokens_in, tokens_out: got.tokens_out, cost: null });
    return got.text;
  };
}

/** The most the service may write in one answer. A whole suite for a package
 *  of several scripts runs long, and a cut answer is worthless. */
export const OUTPUT_TOKENS = 64000;

/** Two goes and no more. The second carries the findings from the first. */
export const TRIES = 2;

export const INSTRUCTION = `You are writing the test suite for an agent package, from its spec, before
any of its scripts exist.

You are given, in order: the spec, the command lines the harness will run,
a reference saying what a good suite carries, one whole suite that holds a
package which runs today, and the spec that suite tests.

Write the suite the spec describes, in the shape the reference measures:
node's own test runner and nothing else, one file per script or one per
package, each file opening with a comment that says what it pins, each test
named as a lowercase sentence about the decision it holds, and every function
that would reach the world handed in by the test.

The scripts do not exist yet. Your imports are the interface they will have
to meet, so choose them with care: one exported function per decision, named
for what it decides, taking plain values and returning plain values, with a
thin main under the guard that reads the variables and prints. Every script
the spec names must be reached by some file, by import or by spawning it.

Pin, in this order: each refusal the spec lists, as a case that tries the
thing and is refused with the reply's wording; the empty case, exit 3 with
the reply the job's "empty" sentence promises, no model called and no pieces
filed; each record the spec declares, written where declared, whether the
job succeeded or not; the "good" sentence, clause by clause, as assertions
on the artifact; the process contract once per script, the exit-2 line when a
required variable is missing; and the spec itself, that the offering's steps
are jobs and each job's "how" is what it claims.

Every delivered piece must be in its declared format, and one file in every
suite checks that: test/delivered-formats.test.mjs, which the test writer adds
itself. Do not write it and do not answer with it. In each test that fills a
job folder (one that runs a job's main, or calls its pieces script's fill),
import { checkDelivered } from "./delivered-formats.test.mjs" and assert
checkDelivered(jobDir) deep-equals []. It reads ../agent-descriptor.json and
holds each piece pieces.json lists to its declared kind: Markdown with the
headings its "about" sketches, a JSON kind with its sketched shape, and so on.

Every job of an agent is handed the same records folder, the agent's own
(RECORDS, or --records), and it is kept from one job to the next. A record
the spec keeps per job has a file pattern that starts with the job's folder,
such as */went-without.json, read relative to that records folder, so a job
writes it under a folder named after its job folder:
<records>/<the job folder's name>/went-without.json. A test therefore hands
every job the same records folder, never a folder per job. The suite that
works, below, hands its job records/job1 as the records folder, an older
layout the host does not make: do not copy that part. One file in every
suite checks the rest: test/records-per-job.test.mjs, which the test writer adds itself. Do not write it and do not answer with it.
Every job writes went-without.json, with no entries when it lacked nothing,
because the conformance check reads it after jobs that may lack nothing; a
test may find it after a successful job with no entries in it, and never
asserts that it is absent.
When the spec keeps a record per job, write a test that runs
two ordinary jobs of the same kind, jobs that succeed, each with its own job
folder and both with the same records folder; then
import { checkRecordsPerJob } from "./records-per-job.test.mjs" and assert
checkRecordsPerJob(records, [jobDir1, jobDir2]) deep-equals []. A record the
spec says is written only in some cases, and that neither job writes, is
named in its third argument: { except: ["<the record's file or name>"] }.
went-without.json is never excepted, and the check holds every job to it
whatever except names.

Every expected value that a rule in the spec decides from the input (a
count, a total, a length, letters taken from words, an order, a sum, which
items pass a test) is worked twice, because a value worked out in the head
is often wrong, and a suite that pins a wrong value stops the build: no
script that keeps the spec can pass it. Write each one as a constant at the
top of the file, after the imports and before any test, with
worked(value, () => computation, "what it is"), and use the constant in the
tests. value is the literal you expect. computation is plain JavaScript in
the test file itself, over the same input, that applies the spec's rule step
by step (count the vowels with a loop over the letters; take each word's
first letter), with any helper it needs declared as a function in the same
file; never a function from ../scripts/, and never the literal again. Read
each rule from the spec word for word: a computation that follows the rule
catches the value you remembered instead (an acronym the world spells one
way, which the spec's rule spells another). Keep inputs short, so the value
is easy to check. A count, a total or a length is asserted against its
worked constant, never as a bare number in an assertion (not
assert.equal(result.total, 4), and not a number written into a pattern for
assert.match); an exit status or a count of calls is not such a value.
import { worked } from "./worked-values.test.mjs". The
test writer runs every computation and sends back each value that disagrees
with its own computation. Where no expected value in the suite is decided by
such a rule (every expectation is a reply's wording, a refusal, an exit code
or what a stand-in model said), say so in NOTES, on a line that starts
"No worked values:", with why. worked() is in one file of every suite:
test/worked-values.test.mjs, which the test writer adds itself. Do not write it and do not answer with it.

Each job's command line is run by one more file the test writer adds
itself, test/printed-reply.test.mjs: with an empty message, it checks that
what the command prints gives the reply run.reply names. Do not write it,
do not answer with it, and do not run the command lines for that yourself.

Pin every number and rule each feature and each refusal states: a limit,
a count, a time limit, an order, the exact words or pattern it quotes, an
exit code. A test of the feature asserts each one as the feature gives it:
"a 10-second timeout" is a test that the call is given a 10 second limit
(10 or 10000 written in the test), "up to 20 at a time" is a test that no
batch is bigger than 20, and words in quotes are asserted exactly as
quoted. The test writer reads each feature the message lists and each
refusal the spec declares, and sends back every number and quoted word no
test of it carries, naming the feature.

A function that awaits anything, or is handed an async stand-in (a fetch
written async () => ...), refuses by returning a rejected promise, not by
throwing. Test it with an async test and await assert.rejects(promise, ...),
never assert.throws, which sees only a throw made before the function
returns; and await assert.doesNotReject, never assert.doesNotThrow. The test
writer sends back every assert.throws whose callback is async, awaits, or
reaches a function declared async or handed an async stand-in.

Read a delivered piece by whole lines. Find a line by a pattern for the
whole line (assert.match(text, /^- a: 1$/m)), or by the text after its
heading line, and never by a single letter or a short word searched anywhere
in the piece: a heading or a word of prose holds letters too ("## Counts"
holds o and u before any i), and a test that finds them there fails a piece
that keeps the spec.

Never write a test that would pass with the scripts absent. Never touch a
network or a model from a test. Never write the scripts. A script that calls
a model is tested against a stand-in model server the test starts on the
local machine and reaches through MODEL_ENDPOINT, the way the install points
the script at its model: never a real model service.

Answer with the files and nothing else, in this form, one block per file:

<<<FILE test/<name>.test.mjs>>>
...the whole file...
<<<END>>>

Then, only if there is something you could not write a test for:

<<<COULD NOT>>>
<what> | <why>
<<<END>>>

Then, only if you assumed something the spec did not settle:

<<<NOTES>>>
...
<<<END>>>`;

/** What is said when the package already has a suite. A released agent's
 *  suite holds tests somebody relied on, and the writer used to answer "add
 *  two files" by writing the whole suite again from the spec, three times
 *  (debt 43). So the suite goes in whole, and the answer may only add. */
export const ADD_INSTRUCTION = `This package already has a suite, given below whole under THE SUITE IT
ALREADY HAS. Do not rewrite it and do not answer with any of its files: they
are kept exactly as they are, and a file you answer with under one of their
names is refused. Write only NEW test files, for what they asked for above,
in the same style and against the same interface the existing files import.
A new file must still fail against empty stand-ins on its own.`;

/** The feature a message asks the tests of, on a line of its own, "feature: F2"; null when it names none (test-writer 0.11.0). */
export function featureAsked(asked = "") {
  return /^feature:\s*([A-Za-z][A-Za-z0-9._-]{0,63})\s*$/m.exec(String(asked ?? ""))?.[1] ?? null;
}

/** The spec with that feature alone among its features, and every interface,
 *  constraint, system and setting kept; null when the spec holds no such
 *  feature (test-writer 0.11.0). */
export function specForFeature(spec, id) {
  const features = (Array.isArray(spec?.features) ? spec.features : []).filter((x) => trim(x?.id) === id);
  return features.length ? { ...spec, features } : null;
}

/** The name a new file of one feature's tests takes: test/<id in lower case>-<its name>, unless it is named for the feature already. */
export function featureFileName(path, id) {
  const m = /^test\/([^/]+)$/.exec(String(path ?? ""));
  const pre = String(id).toLowerCase();
  if (!m || STANDARD_NAMES.includes(m[1])) return path;
  const name = m[1].toLowerCase();
  return name.startsWith(`${pre}-`) || name === `${pre}.test.mjs` ? path : `test/${pre}-${m[1]}`;
}

/** What is said when the message asks for one feature's tests (test-writer 0.11.0). */
export function featureInstruction(id, inSpec = true) {
  const lower = String(id).toLowerCase();
  return `This job writes the tests of one feature alone, ${id}${inSpec ? ", the only feature in THE SPEC above. The spec's interfaces, constraints, systems and settings are there for what its tests call and must keep" : ", which the spec does not hold yet: WHAT THEY ASKED FOR describes it"}. Every other feature is written in a run of its own, so write tests for ${id} and for nothing else. Name each test with ${id}'s ids in square brackets as always, and name each new file for the feature: test/${lower}-<what it checks>.test.mjs. A file named otherwise is renamed so.`;
}

/** What is said with the original's own tests (test-writer 0.10.0). */
export const CARRIED_INSTRUCTION = `These are the original's own tests, given whole: the code being rebuilt
passed them, and the rebuilt scripts must pass them too, so they are in the
suite as they are. The test writer placed them, and they are locked. Do not
write them again, do not change them, and do not answer with any of their
names: a file under one of their names is refused. Where they import
./support/..., those are the original's own files, placed beside them. Read
them for the interface the scripts must keep: the scripts they import, and
the names and arguments they call. Your own tests are still written from the
spec, named by its ids, and import from the scripts by the same names these do.`;

/** What is said when the code step sent the suite back (technical debt 636):
 *  a test it could not pass without breaking what the spec says, and a
 *  person who decided the test is the one that is wrong. Only the files the
 *  message names are written again; the rest are kept, as when adding. */
export function reviseInstruction(files = [], tests = {}) {
  const listed = files.filter((f) => Array.isArray(tests[f]) && tests[f].length);
  const only = listed.length ? `
The words name these tests, and only these may change:
${listed.flatMap((f) => tests[f].map((n) => `- "${n}" in ${f}`)).join("\n")}
Every other test in those files, and every line outside the named tests,
stays byte for byte as it is; the test writer puts back any test the words
did not name, whatever the answer did to it, and takes out a test the answer
adds.` : "";
  return `This suite came back from the code step, given below whole under THE SUITE IT
ALREADY HAS. What they asked for above says which test cannot pass without
breaking what the spec says, and a person has decided the test is the one that
is wrong. The spec governs: rewrite only these files, each whole under its own
name, so that every test in them says what the spec says:
${files.map((f) => `- ${f}`).join("\n")}
Change only what is wrong in them, and keep every other test in them as it was.
Every other file of the suite is kept exactly as it is, and a file you answer
with under one of their names is refused. Work each value a rule decides again
from the spec's own words. A rewritten file must still fail against empty
stand-ins on its own.${only}`;
}

/** The tests a revision may change in each file it names (test-writer
 *  0.8.0): those the person's words name, by name, by a line they cite or
 *  by a phrase they quote from one test; null for a file the words name
 *  without naming a test in it, whose every test may change. */
export function namedTestsFor(existing = [], revise = [], asked = "") {
  const out = {};
  for (const p of revise) {
    const f = existing.find((x) => x.path === p);
    if (!f) continue;
    const n = namedTestsIn(f, asked);
    out[p] = n.all ? null : [...n.names];
  }
  return out;
}

/** The answer's revised files with every test the words did not name put
 *  back as it was (suite-rules.mjs, restoreUnnamed). A file that comes out
 *  the same as before is not revised and is left out, so the answer is
 *  asked for again or refused as one that changed nothing. Returns
 *  { files, notes, fresh }: fresh maps each revised path to the lines that
 *  are the answer's own, which are the only lines the line checks read. */
export function keepUnnamed(files = [], existing = [], revise = [], asked = "") {
  const notes = []; const fresh = new Map(); const out = [];
  for (const f of files) {
    const before = revise.includes(f.path) ? existing.find((x) => x.path === f.path) : null;
    if (!before) { out.push(f); continue; }
    const r = restoreUnnamed(before.text, f.text, namedTestsIn(before, asked));
    notes.push(...restoreNotes(f.path, r));
    if (r.text === before.text) continue;
    fresh.set(f.path, r.fresh);
    out.push({ ...f, text: r.text });
  }
  return { files: out, notes, fresh };
}

/** The standard checks the test writer adds itself: never revised by the model. */
const STANDARD_NAMES = ["delivered-formats.test.mjs", "records-per-job.test.mjs", "worked-values.test.mjs", "printed-reply.test.mjs", "kept-interfaces.test.mjs"];

/** The files of a suite a revision names, by file name (with or without
 *  test/), by the name of a test in them, or by the spec's id for an
 *  acceptance scenario a test in them is named with ("F1.A2", test-writer
 *  0.9.0). The standard checks are the test writer's own and never named. A
 *  word that is part of a name is not one. */
export function namedForRevision(existing = [], asked = "") {
  const text = String(asked ?? "");
  const scenarios = scenarioIdsIn(text);
  const out = [];
  for (const f of existing) {
    const name = String(f.path).split("/").pop();
    if (STANDARD_NAMES.includes(name)) continue;
    const byName = new RegExp(`(^|[^A-Za-z0-9._-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`).test(text);
    const byTest = testNamesOf(f.text).some((n) => n.length >= 12 && text.includes(n));
    const byScenario = testNamesOf(f.text).some((n) => namedByScenario(n, scenarios));
    if (byName || byTest || byScenario) out.push(f.path);
  }
  return out;
}

/** What a revision delivers (AgentMesh debt 665): the files it was sent back
 *  for and the test writer's standard checks. A file the answer wrote under
 *  any other name is dropped and named, never delivered: a revision changes
 *  the named tests in place. */
export function revisionDelivery(files = [], revise = []) {
  const keep = (p) => revise.includes(p) || STANDARD_NAMES.includes(String(p).split("/").pop());
  return {
    files: files.filter((f) => keep(f.path)),
    dropped: files.filter((f) => !keep(f.path)).map((f) => f.path),
    revised: files.map((f) => f.path).filter((p) => revise.includes(p)),
  };
}

/** What is said when the suite is written in parts. One answer cannot hold a
 *  whole suite for a package of many scripts: the planner's eight came back
 *  cut at the output limit with nothing delivered (debt 66). */
export function partInstruction(part) {
  const others = part.others ?? [];
  return `This suite is written in parts, because one answer cannot hold all of it.
This part writes the test files for these scripts, and only these:
${part.scripts.map((s) => `- ${s}`).join("\n")}
${others.length ? `Other parts write the tests for ${others.join(", ")}; do not test those here.\n` : ""}${(part.taken ?? []).length ? `These files are already written by earlier parts; do not use their names: ${part.taken.join(", ")}.\n` : ""}${part.first ? "This is the first part, so it also carries the tests on the spec itself.\n" : "The tests on the spec itself are in the first part; do not repeat them.\n"}Keep this part to at most ${PART_TESTS} tests.`;
}

/** How many scripts one part covers, and about how many tests it may carry. */
export const PART_SCRIPTS = 3;
export const PART_TESTS = 24;

/** The scripts in groups of PART_SCRIPTS, in the order the spec names them.
 *  A package of that many or fewer is one part, which is the old single ask. */
export function partsOf(scripts = [], size = PART_SCRIPTS) {
  const out = [];
  for (let i = 0; i < scripts.length; i += size) out.push(scripts.slice(i, i + size));
  return out.length ? out : [[]];
}

/** The names a module exports, from its export statements: functions (async
 *  and generator ones too), classes, const, let and var, and the names an
 *  `export { a, b as c }` list gives out (c, not b). A default export has no
 *  name to import by braces and is left out. */
export function exportsOf(code) {
  const text = String(code ?? "");
  const names = new Set();
  for (const m of text.matchAll(/^[ \t]*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^[ \t]*export\s+class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^[ \t]*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^[ \t]*export\s*\{([^}]*)\}/gm)) {
    for (const item of m[1].split(",")) {
      const t = trim(item.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
      if (!t) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(t);
      const name = as ? as[1] : t.split(/\s+/)[0];
      if (name && name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

/** The copies every package carries of the same file, kept the same by
 *  test_folder.py. A spec naming one of them means its scripts will call it
 *  as it is written. */
export const SHARED_COPIES = ["scripts/model-caller.mjs", "scripts/went-without.mjs", "scripts/agent-folder.mjs"];

/** Every script a spec names: its own list and each job's. */
const namedScripts = (spec) => [...new Set([
  ...(Array.isArray(spec?.scripts) ? spec.scripts : []),
  ...(spec?.jobs ?? []).flatMap((j) => (Array.isArray(j?.scripts) ? j.scripts : [])),
].map((s) => trim(s).replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))];

/** The shared copies the spec names that this package carries in its own
 *  scripts/, each read from this package's copy as {path, text, exports}.
 *  `here` is the scripts folder to read from, so a test can point it
 *  elsewhere. */
export function sharedDependencies(spec, here = HERE) {
  const named = new Set(namedScripts(spec).map((s) => s.split("/").pop()));
  const out = [];
  for (const path of SHARED_COPIES) {
    const name = path.split("/").pop();
    if (!named.has(name)) continue;
    const at = join(here, name);
    if (!existsSync(at)) continue;
    const text = readFileSync(at, "utf8");
    out.push({ path, text, exports: exportsOf(text) });
  }
  return out;
}

/** The files the change depends on, as the request and the check use them:
 *  the attached ones first, then the shared copies the spec names that were
 *  not attached, each with its exported names. */
export function dependenciesFor({ spec = null, dependencies = [] } = {}) {
  const out = [];
  const seen = new Set();
  for (const d of [...(dependencies ?? []), ...sharedDependencies(spec)]) {
    if (!d?.path || seen.has(d.path)) continue;
    seen.add(d.path);
    const text = String(d.text ?? "");
    out.push({ path: d.path, text, exports: Array.isArray(d.exports) ? d.exports : exportsOf(text) });
  }
  return out;
}

/** The attached dependencies under a folder: every script under its
 *  scripts/, as {path, text, exports}. */
export function dependenciesIn(dir) {
  const at = join(dir, "scripts");
  if (!dir || !existsSync(at)) return [];
  return readdirSync(at).filter((n) => /\.(m|c)?js$/i.test(n)).sort().map((n) => {
    const text = readFileSync(join(at, n), "utf8");
    return { path: `scripts/${n}`, text, exports: exportsOf(text) };
  });
}

/** The original's own tests as job.mjs placed them under a folder
 *  (test-writer 0.10.0): { tests: [{path, text}], support: [{path, bytes}],
 *  record (its text, or null), from ("manifest" or "record"), gaps, dropped,
 *  files: path -> {file, at} }. Empty without a folder. */
export function carriedIn(dir) {
  const none = { tests: [], support: [], record: null, from: null, gaps: [], dropped: [], files: new Map() };
  if (!dir || !existsSync(dir)) return none;
  const tests = suiteFiles(dir);
  const support = [];
  const walk = (at, rel) => {
    if (!existsSync(at)) return;
    for (const n of readdirSync(at).sort()) {
      const p = join(at, n);
      if (statSync(p).isDirectory()) walk(p, `${rel}/${n}`);
      else support.push({ path: `${rel}/${n}`, bytes: readFileSync(p) });
    }
  };
  walk(join(dir, "test", "support"), "test/support");
  let meta = {};
  try { meta = JSON.parse(readFileSync(join(dir, "carried.json"), "utf8")); } catch { meta = {}; }
  const record = existsSync(join(dir, CARRIED_RECORD)) ? readFileSync(join(dir, CARRIED_RECORD), "utf8") : null;
  return {
    tests, support, record, from: meta.from ?? null,
    gaps: Array.isArray(meta.gaps) ? meta.gaps : [], dropped: Array.isArray(meta.dropped) ? meta.dropped : [],
    files: new Map((Array.isArray(meta.tests) ? meta.tests : []).map((t) => [t.path, { file: t.file ?? null, at: t.at ?? null }])),
  };
}

/** What is said with the files the change depends on. */
export const DEPENDS_INSTRUCTION = `These are the real files the scripts will call, given whole. The suite
calls them as they are written: import from each only the names it exports,
listed beside it, and call them with the arguments they really take. Do not
test these files themselves.`;

/** What is said with the agent's own files. The spec above them is this
 *  agent's reading of them, in the older spec.json shape, and a declaration
 *  test written from that shape asserted members the files do not carry
 *  (technical debt 618). */
export const AGENT_FILES_INSTRUCTION = `These are the agent's own files as they stand in the package root, beside
test/. A test on the declaration reads them from there (../agent-descriptor.json,
../plugin.json, ../agent-runtime-requirements.json) and asserts only what they
carry, exactly as shown here. The spec above is a reading of these files and
not their shape: the agent's name is plugin.json's \`name\`, and
agent-descriptor.json carries no package name (a \`name\` there, when it is
present, is a display name for a person); an offering is found by its \`id\`,
every offering listed is offered, and the descriptor has no \`offered\`,
\`slug\` or \`jobs\` member. A test that touches no script must already pass
against these files before any script exists, and the suite goes back if one
does not.`;

/** What is said with the spec (spec-v1), the analysis the suite is written
 *  from (test-writer 0.9.0). The kept-interfaces paragraph is said only when
 *  the spec keeps an interface, since only then does the file exist. */
export function specInstruction(spec = null) {
  const kept = keptOf(spec).length > 0;
  return `This is the spec (spec-v1), given whole: what the product must do and how
anyone can tell that it does. Write the suite from it. The agent's own files,
further down, say how the package is laid out (its scripts, the command
lines, its records and declared outputs); the spec says what those scripts
must do, and where the two differ, the spec governs what a test asserts.

Write at least one test for every acceptance scenario (features[].acceptance),
named with the scenario's id in square brackets at the start and then a
lowercase sentence: "[F1.A1] a points line is read by its pattern". A test
for two scenarios carries both ids: "[F1.A1, F1.A2] ...". Keep the F number in
the name: the build maps each test to its feature by it. Each scenario's test
follows its Given, When and Then in that order and checks every requirement
its checks list names, as that requirement's shall says.

Every requirement whose verify is test is checked by a test named for its
feature, and each entry of its exact is written in that test as it stands:
words byte for byte, a pattern as the same pattern (a regular expression
literal or a string with the same characters), a number as the number (a
time limit in seconds may be written in milliseconds). A refusal's words, a
reply's wording and a pattern the product must recognize are asserted
exactly, never paraphrased. A constraint (C1, C2, ...) whose verify is test
is checked by a test named "[C1] ...". The test writer sends back each
scenario no test is named for and each exact entry no test of its feature
carries. A requirement verified by inspection, analysis or demonstration
needs no test.

The inputs and outputs of a feature carry JSON Schemas: build each test's
input to fit its schema, and assert what comes out against its schema. Never
invent a name, an address, a number or a word the spec does not give; where
the spec leaves a question open (open), test around it and say so in NOTES.${kept ? `

An interface with keep true must be kept exactly as the spec gives it: import
a kept function under its name from its module and call it as its signature
says (await it when it is async), and run a kept command with its flags as
given. The test writer adds one more file itself, made from the spec:
test/kept-interfaces.test.mjs. It checks that each kept function is exported
as its signature says and that each kept command accepts its flags, and it
exports checkKept(jobDir, { expect: [ids] }) and keptProblems(id, value). Do
not write it and do not answer with it. In each test that runs a job that
writes a kept file, import { checkKept } from "./kept-interfaces.test.mjs" and
assert checkKept(jobDir, { expect: ["<the file's id>"] }) deep-equals []; for
a kept message, assert keptProblems("<its id>", value) deep-equals [].` : ""}`;
}

/** What is said of the reading of the agent's files when the spec came too:
 *  the same words as AGENT_FILES_INSTRUCTION, naming that reading for what it
 *  is. */
export const agentFilesInstruction = (withSpec = false) => (withSpec
  ? AGENT_FILES_INSTRUCTION.replace("The spec above is a reading of these files", "WHAT THE AGENT'S FILES DECLARE, above, is a reading of these files")
  : AGENT_FILES_INSTRUCTION);

/** The agent's own files a declaration test reads, as {path, text}: the
 *  ones its folder has, and none made up. */
export function agentFilesOf(folder) {
  return [DESCRIPTOR_FILE, MANIFEST_FILE, RUNTIME_FILE]
    .filter((rel) => folder && existsSync(join(folder, rel)))
    .map((rel) => ({ path: rel, text: readFileSync(join(folder, rel), "utf8") }));
}

/** The parts of the request, in order, as text. Pure and exported so the
 *  whole prompt can be read in a test rather than inferred from a fixture. */
export function requestParts({ spec = null, specV1 = null, declared = null, reference = "", worked = "", workedSpec = "", findings = [], asked = "", existing = [], revise = [], part = null, dependencies = [], agentFiles = [], carried = [], feature = null, featureInSpec = true } = {}) {
  const parts = [INSTRUCTION];
  if (trim(asked)) parts.push(`--- WHAT THEY ASKED FOR ---\n${trim(asked)}`);
  // The spec (spec-v1), whole and in its own section, ahead of the reading of
  // the agent's files, which is then named for what it is (test-writer 0.9.0).
  const withSpec = isSpecV1(specV1);
  if (withSpec) parts.push(`--- THE SPEC ---\n${specInstruction(specV1)}\n\n${JSON.stringify(specV1, null, 2)}`);
  // One feature's tests (test-writer 0.11.0).
  if (feature) parts.push(`--- ONE FEATURE ---\n${featureInstruction(feature, featureInSpec)}`);
  parts.push(`--- ${withSpec ? "WHAT THE AGENT'S FILES DECLARE" : "THE SPEC"} ---\n${spec ? JSON.stringify(spec, null, 2) : "(no spec)"}`);
  if (agentFiles.length) {
    parts.push(`--- THE AGENT'S OWN FILES ---\n${agentFilesInstruction(withSpec)}\n\n${agentFiles.map((f) =>
      `=== ${f.path} ===\n${f.text}${String(f.text).endsWith("\n") ? "" : "\n"}=== end of ${f.path} ===`).join("\n\n")}`);
  }
  const commands = (declared?.jobs ?? []).flatMap((j) => (j.commands ?? []).map((c) => ({ job: j.slug, ...c })));
  if (commands.length) {
    parts.push(`--- THE COMMANDS THE HARNESS RUNS ---\n${commands.map((c) =>
      `${c.job}: ${c.script}${c.variables.length ? ` with ${c.variables.join(", ")}` : ""}${c.flags.length ? ` and --${c.flags.join(" --")}` : ""}`).join("\n")}`);
  }
  if (trim(reference)) parts.push(`--- WHAT A GOOD SUITE CARRIES ---\n${trim(reference)}`);
  if (trim(worked)) parts.push(`--- A SUITE THAT WORKS ---\n${trim(worked)}`);
  if (trim(workedSpec)) parts.push(`--- THE SPEC THAT SUITE TESTS ---\n${trim(workedSpec)}`);
  const depends = dependenciesFor({ spec, dependencies });
  if (depends.length) {
    parts.push(`--- THE FILES THE CHANGE DEPENDS ON ---\n${DEPENDS_INSTRUCTION}\n\n${depends.map((d) =>
      `=== ${d.path} (exports: ${d.exports.length ? d.exports.join(", ") : "nothing"}) ===\n${d.text}${d.text.endsWith("\n") ? "" : "\n"}=== end of ${d.path} ===`).join("\n\n")}`);
  }
  if (carried.length) {
    parts.push(`--- THE ORIGINAL'S OWN TESTS ---\n${CARRIED_INSTRUCTION}\n\n${carried.map((f) =>
      `<<<FILE ${f.path}>>>\n${f.text}${String(f.text).endsWith("\n") ? "" : "\n"}<<<END>>>`).join("\n")}`);
  }
  if (existing.length) {
    parts.push(`--- THE SUITE IT ALREADY HAS ---\n${existing.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n")}`);
    parts.push(revise.length ? reviseInstruction(revise, namedTestsFor(existing, revise, asked)) : ADD_INSTRUCTION);
  }
  if (part) parts.push(`--- THIS PART ---\n${partInstruction(part)}`);
  if (findings.length) {
    parts.push(`--- WHAT WAS WRONG WITH YOUR LAST SUITE ---\n${findings.map((f) => `- ${f}`).join("\n")}\nWrite it again with these fixed. Keep everything else as it was.`);
  }
  return parts;
}

/** One ask, as plain values: the model the settings name, and the parts of
 *  the prompt in order. Nothing is sent here. */
export function suiteRequest(opts = {}) {
  return {
    model: modelOf(opts.env ?? {}),
    body: { contents: [{ parts: requestParts(opts).map((text) => ({ text })) }] },
  };
}

/** The one prompt an ask is sent as: its parts, in order, a blank line apart. */
export const promptOf = (request) => (request?.body?.contents ?? []).flatMap((c) => (c?.parts ?? []).map((p) => String(p?.text ?? ""))).join("\n\n");

/** The files, out of whatever wrapping they arrived in.
 *
 *  A model asked for blocks returns them inside one code fence about as often
 *  as bare. A path that climbs out of test/ is refused outright: these files
 *  are written to disk. */
export function answerFrom(text) {
  let raw = trim(text);
  if (!raw) throw new Error("the service answered with nothing");
  const fenced = /^```[a-z]*\s*([\s\S]*?)\s*```$/.exec(raw);
  if (fenced) raw = fenced[1];
  const files = [];
  for (const m of raw.matchAll(/<<<FILE\s+([^>\n]+?)\s*>>>\r?\n([\s\S]*?)\r?\n?<<<END>>>/g)) {
    let path = trim(m[1]).replace(/\\/g, "/").replace(/^\.\//, "");
    if (/(^|\/)\.\.(\/|$)/.test(path) || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
      throw new Error(`the answer names a file outside the package: ${path}`);
    }
    if (!path.startsWith("test/")) path = `test/${path.split("/").pop()}`;
    const body = m[2].replace(/^\r?\n/, "");
    if (!trim(body)) continue;
    files.push({ path, text: body.endsWith("\n") ? body : body + "\n" });
  }
  if (!files.length) throw new Error("the answer carries no test file");
  const couldNot = [];
  const cn = /<<<COULD NOT>>>\r?\n([\s\S]*?)<<<END>>>/.exec(raw);
  if (cn) {
    for (const line of cn[1].split(/\r?\n/)) {
      const t = trim(line).replace(/^-\s*/, "");
      if (!t) continue;
      const at = t.indexOf("|");
      couldNot.push(at > 0 ? { what: trim(t.slice(0, at)), why: trim(t.slice(at + 1)) } : { what: t, why: "" });
    }
  }
  const notes = /<<<NOTES>>>\r?\n([\s\S]*?)<<<END>>>/.exec(raw);
  return { files, could_not: couldNot, notes: notes ? trim(notes[1]) : "" };
}

/** The standard format check every suite carries, and where its master copy
 *  is kept: references/ beside this script's folder in a built package, and
 *  the same folder in the package's source. */
export const FORMAT_TEST = "test/delivered-formats.test.mjs";
export function formatTestAt(env = {}, here = HERE) {
  return firstOf(trim(env.FORMAT_TEST) ? [trim(env.FORMAT_TEST)] : [
    join(here, "..", "references", "delivered-formats.test.mjs"),
    join(here, "..", "..", "test-writer", "references", "delivered-formats.test.mjs"),
  ]);
}

/** The suite with the format check in it: the files as they are, and the
 *  check added unless one of them is it already. */
export function withFormatTest(files = [], text = "") {
  if (!trim(text) || files.some((f) => f.path === FORMAT_TEST)) return files;
  return [...files, { path: FORMAT_TEST, text }];
}

/** What a suite being added to keeps, and the format check it is given: the
 *  current copy, unless it already carries those same bytes. An older copy
 *  is the test writer's own file and is replaced, not kept. */
export function refreshFormatTest(existing = [], text = "") {
  const kept = existing.find((f) => f.path === FORMAT_TEST);
  if (kept && kept.text === text) return { existing, generated: [] };
  return { existing: existing.filter((f) => f !== kept), generated: [{ path: FORMAT_TEST, text }] };
}

/** Whether a declaration has any output for the format check to hold. */
export const declaresOutputs = (declared) => (declared?.jobs ?? []).some((j) => (j.outputs ?? []).length);

/** The standard check that each job leaves its own records (debt 639), and
 *  where its master copy is kept, the same way as the format check's. */
export const RECORDS_TEST = "test/records-per-job.test.mjs";
export function recordsTestAt(env = {}, here = HERE) {
  return firstOf(trim(env.RECORDS_TEST) ? [trim(env.RECORDS_TEST)] : [
    join(here, "..", "references", "records-per-job.test.mjs"),
    join(here, "..", "..", "test-writer", "references", "records-per-job.test.mjs"),
  ]);
}

/** The standard check that each value a rule decides is worked twice (debt
 *  646), and where its master copy is kept, the same way as the others'. */
export const WORKED_TEST = "test/worked-values.test.mjs";
export function workedTestAt(env = {}, here = HERE) {
  return firstOf(trim(env.WORKED_TEST) ? [trim(env.WORKED_TEST)] : [
    join(here, "..", "references", "worked-values.test.mjs"),
    join(here, "..", "..", "test-writer", "references", "worked-values.test.mjs"),
  ]);
}

/** The standard check that each job's command prints the reply its run.reply
 *  names, read as the host reads it (debt 657), and where its master copy is
 *  kept, the same way as the others'. */
export const REPLY_TEST = "test/printed-reply.test.mjs";
export function replyTestAt(env = {}, here = HERE) {
  return firstOf(trim(env.REPLY_TEST) ? [trim(env.REPLY_TEST)] : [
    join(here, "..", "references", "printed-reply.test.mjs"),
    join(here, "..", "..", "test-writer", "references", "printed-reply.test.mjs"),
  ]);
}

/** The standard check that each interface the spec keeps is kept (test-writer
 *  0.9.0), and where the master copy it is made from is kept, the same way as
 *  the others'. Unlike them it is made per spec: kept-interfaces.mjs fills in
 *  the spec's kept interfaces, so a spec that keeps none gives no file. */
export const KEPT_TEST = "test/kept-interfaces.test.mjs";
export function keptTestAt(env = {}, here = HERE) {
  return firstOf(trim(env.KEPT_TEST) ? [trim(env.KEPT_TEST)] : [
    join(here, "..", "references", "kept-interfaces.test.mjs"),
    join(here, "..", "..", "test-writer", "references", "kept-interfaces.test.mjs"),
  ]);
}

/** The files the test writer adds to every suite, by path. */
export const STANDARD_TESTS = [FORMAT_TEST, RECORDS_TEST, WORKED_TEST, REPLY_TEST, KEPT_TEST];

/** The suite with the standard checks in it: each added unless the suite
 *  has a file at its path already, and none added whose text is empty. */
export function withStandardTests(files = [], { formatTest = "", recordsTest = "", workedTest = "", replyTest = "", keptTest = "" } = {}) {
  let out = files;
  for (const [path, text] of [[FORMAT_TEST, formatTest], [RECORDS_TEST, recordsTest], [WORKED_TEST, workedTest], [REPLY_TEST, replyTest], [KEPT_TEST, keptTest]]) {
    if (trim(text) && !out.some((f) => f.path === path)) out = [...out, { path, text }];
  }
  return out;
}

/** What a suite being added to keeps, and the standard file at `path` it is
 *  given: the current copy, unless it already carries those same bytes. */
export function refreshStandardTest(existing = [], path = FORMAT_TEST, text = "") {
  const kept = existing.find((f) => f.path === path);
  if (kept && kept.text === text) return { existing, generated: [] };
  return { existing: existing.filter((f) => f !== kept), generated: [{ path, text }] };
}

/** Whether a declaration keeps a record per job: a record whose file pattern
 *  starts with the job's folder (`*` then `/`) and is not marked standing. */
export const declaresPerJobRecords = (declared) => (declared?.records ?? [])
  .some((r) => typeof r?.file === "string" && r.file.replace(/\\/g, "/").startsWith("*/") && r.when !== "standing");

/** Whether some file of a suite calls the records check. */
export const callsRecordsCheck = (files = []) => files.some((f) => f.path !== RECORDS_TEST
  && /from\s+["']\.\/records-per-job\.test\.mjs["']/.test(f.text) && /checkRecordsPerJob\s*\(/.test(f.text));

export const NO_RECORDS_CHECK = "no test calls checkRecordsPerJob(records, [jobDir1, jobDir2]) from ./records-per-job.test.mjs, so nothing checks that each job keeps its records in a folder of its own and the next job does not overwrite them; run two jobs of the same kind with their own job folders and one records folder, then call it and assert it returns []";

/** Whether some file of a suite calls the format check on a job folder. */
export const callsFormatCheck = (files = []) => files.some((f) => f.path !== FORMAT_TEST
  && /from\s+["']\.\/delivered-formats\.test\.mjs["']/.test(f.text) && /checkDelivered\s*\(/.test(f.text));

export const NO_FORMAT_CHECK = "no test calls checkDelivered(jobDir) from ./delivered-formats.test.mjs on a job folder it filled, so nothing checks that each delivered piece is in its declared format; call it in each test that fills a job folder and assert it returns []";

/** Whether some file of a suite works a value with the worked-values check. */
export const callsWorked = (files = []) => files.some((f) => f.path !== WORKED_TEST
  && /from\s+["']\.\/worked-values\.test\.mjs["']/.test(f.text) && /\bworked\s*\(/.test(f.text));

/** Whether the model's notes say no expected value in the suite is decided
 *  by a rule, on a line of their own that starts "No worked values:". */
export const saysNoWorkedValues = (notes = "") => /(^|\n)[ \t]*(?:[-*][ \t]*)?no worked values\s*:/i.test(String(notes ?? ""));

export const NO_WORKED_VALUES = "no expected value is worked twice: write each value a rule in the spec decides from the input (a count, a total, letters taken from words, an order) as a constant at the top of the file, worked(value, () => computation, \"what it is\") from ./worked-values.test.mjs, the computation plain code in the test over the same input; or, if no expected value in the suite is decided by such a rule, say so in NOTES on a line that starts \"No worked values:\" with why";

/** Code with its line comments and quoted strings blanked, line for line, so
 *  a word in a comment or a test's name is not read as a call. */
const codeLines = (text) => String(text ?? "").split("\n")
  .map((l) => l.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g, '""').replace(/(^|[^:])\/\/.*$/, "$1"));

/** A one-letter string literal, '"a"' or "'a'": a letter and nothing else,
 *  so "\n" or "," is not one. */
const LETTER = /^\s*(["'`])[A-Za-z\u00C0-\u024F]\1\s*$/;
const LETTER_LIST = /^\s*\[\s*(?:(["'`])[A-Za-z\u00C0-\u024F]\1\s*,\s*)+(["'`])[A-Za-z\u00C0-\u024F]\2\s*,?\s*\]/;

/** Each search for a single letter in a suite's files, as findings by line:
 *  indexOf, lastIndexOf, includes or search given a one-letter literal, an
 *  element of a list of single letters, or a variable that runs over one. A
 *  heading or a word of prose holds letters too ("## Counts" holds o and u),
 *  so such a test cannot tell a piece that keeps the spec from one that does
 *  not, and may fail every piece that does (build ab_6d0a79ba51025b1beb). */
export function letterSearchFindings(files = [], { fresh = null } = {}) {
  const out = [];
  for (const f of files) {
    const only = fresh?.get?.(f.path) ?? null;
    if (STANDARD_TESTS.includes(f.path)) continue;
    const text = String(f.text ?? "");
    const lists = new Set();
    for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:worked\s*\(\s*)?(\[[^\]\n]*\])/g)) {
      if (LETTER_LIST.test(m[2])) lists.add(m[1]);
    }
    const runners = new Set();
    for (const m of text.matchAll(/for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*|\[[^\]\n]*\])/g)) {
      if (lists.has(m[2]) || LETTER_LIST.test(m[2])) runners.add(m[1]);
    }
    for (const m of text.matchAll(/([A-Za-z_$][\w$]*|\[[^\]\n]*\])\s*\.\s*forEach\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)/g)) {
      if (lists.has(m[1]) || LETTER_LIST.test(m[1])) runners.add(m[2]);
    }
    const isLetter = (arg) => LETTER.test(arg)
      || runners.has(arg.trim())
      || [...lists].some((n) => new RegExp(`^\\s*${n.replace(/\$/g, "\\$")}\\s*\\[[^\\]]*\\]\\s*$`).test(arg));
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/\.\s*(indexOf|lastIndexOf|includes|search)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
        const args = m[2].split(",");
        if (!isLetter(args[0]) || (only && !only.has(i + 1))) continue;
        out.push(`${f.path}:${i + 1} searches the text for a single letter with ${m[1]}(${args[0].trim()}); a heading or a word of prose holds letters too ("## Counts" holds o and u), so no piece that keeps the spec can be told apart. Find the whole line instead, by a pattern for the line (/^- a: \\d+$/m) or the text after its heading line`);
      }
    });
  }
  return out;
}

/** What a test got, named by a word no spec rule decides: an exit status, a
 *  count of calls or attempts, a length. Compared to a bare number, these
 *  are left alone. */
const NOT_A_RULE = /(?:status|code|exit|exitCode|calls?|called|invocations?|requests?|attempts?|length|size)\s*$/i;
/** A number written as one, not inside a name, an escape such as \d, or a
 *  quantifier such as {2,3}. */
const NUMBER = /(?<![\w\\{,.$])-?\d+(?:\.\d+)?(?![\w},])/;

/** The first argument of a call whose text starts at `open` (just inside the
 *  parenthesis), split at commas outside brackets and strings: its arguments
 *  as written. */
function argumentsAt(text, open) {
  const args = []; let cur = ""; let depth = 0; let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { cur += ch; if (ch === "\\") { cur += text[i + 1] ?? ""; i += 1; } else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; cur += ch; continue; }
    if (ch === "/" && depth >= 0 && /^\s*$/.test(cur)) {
      // A regular expression literal as an argument: kept whole.
      const m = /^\/(?:[^/\\\n]|\\.)+\/[a-z]*/.exec(text.slice(i));
      if (m) { cur += m[0]; i += m[0].length - 1; continue; }
    }
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) { if (depth === 0) { args.push(cur); return args; } depth -= 1; }
    if (ch === "," && depth === 0) { args.push(cur); cur = ""; continue; }
    cur += ch;
  }
  return args;
}

/** Each assertion in a suite's files that pins a value as a bare number, as
 *  one finding per file naming its lines: assert.equal, strictEqual,
 *  deepEqual or deepStrictEqual whose expected value is a number, or an
 *  object or list holding one, and assert.match whose pattern has a number
 *  written in it. What was got is left alone when its name says it is an
 *  exit status, a count of calls or a length. A value a rule decides belongs
 *  in a worked constant, where it is checked against its own computation
 *  (build ab_481ac696b24d8cf8fd pinned a 3, e 1, total 4 for "Café façade
 *  rôle naïve" in a suite that worked 23 other values). */
export function bareLiteralFindings(files = [], { fresh = null } = {}) {
  const out = [];
  for (const f of files) {
    if (STANDARD_TESTS.includes(f.path)) continue;
    const text = String(f.text ?? "");
    const only = fresh?.get?.(f.path) ?? null;
    const lines = [];
    for (const m of text.matchAll(/\bassert\s*\.\s*(equal|strictEqual|deepEqual|deepStrictEqual|match)\s*\(/g)) {
      const [got = "", want = ""] = argumentsAt(text, m.index + m[0].length);
      const line = text.slice(0, m.index).split("\n").length;
      if (only && !only.has(line)) continue;
      if (m[1] === "match") {
        const re = /^\s*\/((?:[^/\\\n]|\\.)+)\/[a-z]*\s*$/.exec(want);
        if (re && NUMBER.test(re[1])) lines.push(line);
        continue;
      }
      if (NOT_A_RULE.test(got.replace(/\?\./g, "."))) continue;
      const w = want.trim();
      if (/^-?\d+(?:\.\d+)?$/.test(w) || (/^[[{]/.test(w) && NUMBER.test(w.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')))) lines.push(line);
    }
    if (lines.length) {
      out.push(`${f.path} pins ${lines.length === 1 ? "a value" : "values"} a rule may decide as a bare number in an assertion (line${lines.length === 1 ? "" : "s"} ${[...new Set(lines)].join(", ")}); write each as a worked constant at the top of the file, worked(value, () => computation, "what it is"), and assert against the constant, so its own computation checks it`);
    }
  }
  return out;
}

/** What is wrong with the worked values in a suite's files, as findings by
 *  line: a worked() inside a test, which a stand-in that throws first keeps
 *  from ever being checked, and a computation that is only a literal, which
 *  checks nothing. A test runs from its line at the left margin to the next
 *  statement there. */
export function workedFindings(files = [], { fresh = null } = {}) {
  const out = [];
  for (const f of files) {
    if (STANDARD_TESTS.includes(f.path)) continue;
    const only = fresh?.get?.(f.path) ?? null;
    const lines = codeLines(f.text);
    let inTest = false;
    lines.forEach((l, i) => {
      if (/^(?:test|it|describe|suite)(?:\.\w+)?\s*\(/.test(l)) inTest = true;
      else if (/^\S/.test(l) && !/^[}\])]/.test(l)) inTest = false;
      if (inTest && /(?<![\w$.])worked\s*\(/.test(l) && (!only || only.has(i + 1))) {
        out.push(`${f.path}:${i + 1} calls worked() inside a test; put each worked value in a constant at the top of the file, after the imports and before any test, where it is checked before any script is reached`);
      }
    });
    const raw = String(f.text ?? "").split("\n");
    raw.forEach((l, i) => {
      if (only && !only.has(i + 1)) return;
      if (/(?<![\w$.])worked\s*\([^,]+,\s*\(\s*\)\s*=>\s*(?:-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|true|false|null)\s*[,)]/.test(l)) {
        out.push(`${f.path}:${i + 1} works a value whose computation is only a literal, which checks nothing; compute it from the test's input by the spec's rule`);
      }
    });
  }
  return out;
}

/** The names of the tests in a file, as written. */
export function testNamesOf(text) {
  return [...String(text ?? "").matchAll(/^\s*test(?:\.skip|\.only)?\(\s*(["'`])((?:(?!\1).)+)\1/gm)].map((m) => m[2]);
}

/** What is wrong with a suite before it is run. Each finding is a sentence
 *  the model can act on. */
/** The names a test file imports by braces, with where from:
 *  [{from, names}], where `names` are the exported names asked for (a in
 *  `a as b`). */
export function namedImportsOf(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/\bimport\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = m[1].split(",").map((s) => trim(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))).filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
    out.push({ from: m[2], names });
  }
  return out;
}

/** The dependency an import in a test file reaches, or null: the import's
 *  path resolved from the test's own folder and matched to a dependency's
 *  path, or to its file name when the dependency is not under scripts/. */
function dependencyReached(testPath, from, dependencies) {
  if (!/^\.\.?\//.test(from)) return null;
  const resolved = posix.normalize(posix.join(posix.dirname(String(testPath ?? "test/x").replace(/\\/g, "/")), from));
  const name = resolved.split("/").pop();
  return dependencies.find((d) => d.path === resolved)
    ?? dependencies.find((d) => !String(d.path).startsWith("scripts/") && String(d.path).split("/").pop() === name)
    ?? null;
}

/** What a test file imports from a dependency that the dependency does not
 *  export, as findings naming the name and the file. */
export function importFindings(files = [], dependencies = []) {
  const out = [];
  if (!dependencies.length) return out;
  for (const f of files) {
    for (const imp of namedImportsOf(f.text)) {
      const dep = dependencyReached(f.path, imp.from, dependencies);
      if (!dep) continue;
      const exported = new Set(dep.exports ?? exportsOf(dep.text));
      for (const name of imp.names) {
        if (!exported.has(name)) {
          out.push(`${f.path} imports ${name} from ${dep.path}, which does not export it; ${dep.path} exports ${[...exported].join(", ") || "nothing"}, and the suite calls it as it is written`);
        }
      }
    }
  }
  return out;
}

export function staticFindings(files = [], declared = null, { existing = [], revise = [], taken = [], scripts = null, formatCheck = false, recordsCheck = false, workedCheck = false, literalCheck = false, notes = "", dependencies = [], fresh = null, pins = null, specV1 = null, specCheck = false, carried = [] } = {}) {
  const out = [];
  if (!files.length) return [revise.length ? `the answer changes none of the tests the words name in the files it was sent back for: ${revise.join(", ")}; the answer rewrites none of the files it was sent back for, so change those tests, and only those, and answer with each file whole under its own name` : "no test file came back"];
  // The format check and the records check are the test writer's own files,
  // added after the answer.
  for (const path of STANDARD_TESTS) {
    if (files.some((f) => f.path === path)) {
      out.push(`${path} is written by the test writer itself and added to every suite; do not answer with it`);
      files = files.filter((f) => f.path !== path);
    }
  }
  if (!files.length) return out;
  // A file under a name the suite already has is a rewrite, and a rewrite of
  // a released agent's suite is what this guards against.
  // In a revision the files it names may come back under their own names.
  const revisable = new Set(revise);
  const kept = new Set([...existing.map((f) => f.path).filter((p) => !revisable.has(p)), ...taken]);
  // The original's own tests are locked (test-writer 0.10.0): an answer
  // under one of their names is refused and never delivered.
  const locked = new Set(carried.map((f) => f.path));
  for (const f of files) {
    if (locked.has(f.path)) out.push(`${f.path} is one of the original's own tests, carried unchanged and locked; never answer with it, and put new tests in a file with a name of its own`);
    else if (kept.has(f.path)) out.push(`${f.path} is already in the suite and is kept as it is; put new tests in a new file with a name of its own`);
  }
  files = files.filter((f) => !locked.has(f.path));
  if (!files.length) return out;
  if (revise.length && !files.some((f) => revisable.has(f.path))) {
    out.push(`the answer rewrites none of the files it was sent back for: ${revise.join(", ")}; answer with each of them whole, under its own name`);
  }
  // A revision changes the named tests in place (AgentMesh debt 665): on dev
  // the test writer wrote test/reply.test.mjs and left the named test as it
  // was, so the code step met the same wrong test again.
  if (revise.length) {
    for (const f of files) {
      if (!revisable.has(f.path) && !kept.has(f.path)) out.push(`${f.path} is a new file, and a revision changes only the files it was sent back for, in place: make the change inside ${revise.join(", ")}`);
    }
  }
  // Reach and count are over the suite as it will stand: what it already
  // has, and what came back. In a part they are over that part's scripts.
  const answered = new Set(files.map((f) => f.path));
  const whole = [...existing.filter((f) => !answered.has(f.path)), ...carried, ...files];
  const named = scripts ?? declared?.scripts ?? [];
  let total = existing.filter((f) => !answered.has(f.path)).reduce((n, f) => n + testNamesOf(f.text).length, 0);
  for (const f of files) {
    const names = testNamesOf(f.text);
    total += names.length;
    if (!/^\s*\/\//.test(f.text)) out.push(`${f.path} does not open with a comment saying what it pins`);
    if (!names.length) out.push(`${f.path} has no test in it`);
    const badNames = names.filter((n) => /^(test|should|it )/i.test(n) || /^[A-Z]/.test(n));
    if (badNames.length) out.push(`${f.path} names tests as labels rather than sentences: ${badNames.slice(0, 3).map((n) => `"${n}"`).join(", ")}`);
    if (!/from\s+["']\.\.\/scripts\//.test(f.text) && !/spawnSync|execFileSync|spawn\(/.test(f.text)) {
      out.push(`${f.path} imports nothing from ../scripts/ and spawns no script, so nothing in it can fail when the scripts are wrong`);
    }
    if (!/node:test/.test(f.text)) out.push(`${f.path} does not use node:test`);
    if (/from\s+["'](?!node:|\.\.?\/)/.test(f.text)) out.push(`${f.path} imports a package that is not node's own; a suite depends on nothing outside node`);
  }
  out.push(...importFindings(files, dependencies));
  out.push(...workedFindings(files, { fresh }));
  out.push(...letterSearchFindings(files, { fresh }));
  if (workedCheck || literalCheck) out.push(...bareLiteralFindings(files, { fresh }));
  // An async function refuses with a rejected promise (test-writer 0.8.0).
  out.push(...asyncThrowsFindings(files, { dependencies, skip: STANDARD_TESTS, fresh }));
  // Every number and quoted word a feature or a refusal states, over a
  // whole new suite: a suite added to or revised keeps what it had.
  if (pins) out.push(...pinFindings(whole, { words: pins.words, declared, skip: STANDARD_TESTS }));
  // Written from the spec (test-writer 0.9.0): every acceptance scenario has
  // a test named with its id, every exact entry of a requirement verified by
  // test is carried by a test of its feature, and every kept file or message
  // with a schema is held by some test. Over the suite as it will stand.
  if (specCheck) out.push(...specFindings(whole, specV1, { skip: STANDARD_TESTS }));
  const all = whole.map((f) => f.text).join("\n");
  for (const s of named) {
    const name = String(s).split("/").pop();
    if (!all.includes(name)) out.push(`nothing reaches ${s}: no file imports it or spawns it`);
  }
  if (formatCheck && !callsFormatCheck(whole)) out.push(NO_FORMAT_CHECK);
  if (recordsCheck && !callsRecordsCheck(whole)) out.push(NO_RECORDS_CHECK);
  if (workedCheck && !callsWorked(whole) && !saysNoWorkedValues(notes)) out.push(NO_WORKED_VALUES);
  const k = named.length;
  if (k && total < 2 * k) out.push(`${total} test${total === 1 ? "" : "s"} for ${k} script${k === 1 ? "" : "s"}; the nine existing suites carry about eight per script, and fewer than two each is not a suite`);
  return out;
}

/** What the stand-in run says is wrong, in the model's terms. */
export function standInFindings(run, { skip = [] } = {}) {
  if (!run) return [];
  if (run.timed_out) return [`against empty stand-ins the suite did not finish in time; a test must not wait on anything`];
  if (run.tests === 0 && run.status === 0) return ["against empty stand-ins no test ran at all; the files must be test/<name>.test.mjs and use node:test"];
  if (!run.fails) return [`against empty stand-ins for every script the suite passed (${run.pass} of ${run.tests}), so it asserts nothing about them; import the functions and assert what they return`];
  const out = [];
  // A standard check or an original test that fails against the agent's
  // files is not the model's to mend, so it is not sent back to it.
  const u = (run.unpassable ?? []).filter((x) => !STANDARD_TESTS.includes(x.path) && !skip.includes(x.path));
  if (u.length) {
    out.push(`${u.length === 1 ? "this test touches" : `these ${u.length} tests touch`} no script and still ${u.length === 1 ? "fails" : "fail"} against the agent's own files as they are, so no script can ever make ${u.length === 1 ? "it" : "them"} pass: `
      + u.map((x) => `"${x.name}" in ${x.path}${x.error ? ` (${x.error.replace(/\s+/g, " ")})` : ""}`).join("; ")
      + `. Assert only what agent-descriptor.json, plugin.json and agent-runtime-requirements.json carry, exactly as THE AGENT'S OWN FILES show them`);
  }
  // A worked value its own computation does not give is pinned wrong, or
  // computed wrong; either way no script that keeps the spec passes it.
  const w = run.wrong_values ?? [];
  if (w.length) {
    out.push(`${w.length === 1 ? "a worked value disagrees with its own computation" : `${w.length} worked values disagree with their own computations`}: `
      + w.join("; ")
      + `. Work each again from the spec's own words: read the rule once more, apply it to the input by hand, then fix whichever of the value and the computation is wrong, so that they agree and both say what the spec says`);
  }
  return out;
}

/** Ask, check what came back, and ask once more with the findings. Returns
 *  the suite, whatever survived, and what it cost. `run` is the stand-in
 *  run, handed in so a test never spawns node. */
export async function askForSuite({ call, run = null, tries = TRIES, ...opts } = {}) {
  if (typeof call !== "function") throw new Error("askForSuite needs a call");
  let findings = [];
  let last = null;
  let standIns = null;
  let calls = 0;
  let restored = [];
  for (let go = 0; go < tries; go += 1) {
    const request = suiteRequest({ ...opts, findings });
    calls += 1;
    last = answerFrom(await call(request));
    // A revision changes only the tests the words name: every other test is
    // put back byte for byte before anything is checked (test-writer 0.8.0).
    let fresh = null;
    if ((opts.revise ?? []).length) {
      const kept = keepUnnamed(last.files, opts.existing ?? [], opts.revise, opts.asked ?? "");
      last = { ...last, files: kept.files };
      restored = kept.notes;
      fresh = kept.fresh;
    }
    findings = staticFindings(last.files, opts.declared, {
      fresh,
      // A new suite, written whole in one ask: every number and quoted word a
      // feature or a refusal states is pinned by a test of it.
      pins: !opts.part && !(opts.existing ?? []).length ? { words: opts.asked ?? "" } : null,
      existing: opts.existing ?? [], revise: opts.revise ?? [], taken: opts.part?.taken ?? [], scripts: opts.part?.scripts ?? null,
      // Over the whole suite when it is one ask; a suite in parts is held to
      // it once all its parts are in (askInParts).
      formatCheck: !opts.part && declaresOutputs(opts.declared),
      recordsCheck: !opts.part && declaresPerJobRecords(opts.declared),
      // Held whenever the worked-values check goes into the suite.
      workedCheck: !opts.part && Boolean(trim(opts.workedTest)),
      // Per file, so held in a part too.
      literalCheck: Boolean(trim(opts.workedTest)),
      notes: last.notes,
      dependencies: dependenciesFor(opts),
      // Held to the spec when one came: a new suite and a suite being added
      // to, whole in one ask (a suite in parts once all its parts are in);
      // never a revision, which changes only the tests it names.
      specV1: opts.specV1 ?? null,
      specCheck: isSpecV1(opts.specV1) && !opts.part && !(opts.revise ?? []).length && opts.specRules !== false,
      carried: opts.carried ?? [],
    });
    // Every test file the model wrote loads (test-writer 0.10.0): node
    // --check passes, and an ES module uses no CommonJS name it lacks.
    const locked = new Set((opts.carried ?? []).map((f) => f.path));
    findings.push(...(opts.load ?? loadFindings)(last.files.filter((f) => !STANDARD_TESTS.includes(f.path) && !locked.has(f.path))));
    standIns = null;
    if (!findings.length && run) {
      standIns = await run(withStandardTests(last.files.filter((f) => !locked.has(f.path)), opts));
      findings = standInFindings(standIns, { skip: [...locked] });
    }
    if (!findings.length) break;
  }
  return {
    files: last.files,
    could_not: last.could_not,
    notes: last.notes,
    findings,
    stand_ins: standIns,
    calls,
    tried_again: calls > 1,
    restored,
  };
}

/** An answer cut at its output limit: the shared caller marks it cutAtLimit
 *  and says it was cut at its limit. */
const CUT = /cut at (the output|its) limit/;
const wasCut = (e) => e?.cutAtLimit === true || CUT.test(String(e?.message));

/** The whole suite, in parts when one answer cannot hold it.
 *
 *  A package with PART_SCRIPTS scripts or fewer, or one that already has a
 *  suite being added to, is one ask, exactly as before. A bigger one is asked
 *  for in parts of PART_SCRIPTS scripts, each checked on its own (static, and
 *  against stand-ins) with the same two goes and never a third. A part whose
 *  answer is cut at the output limit is asked again one script at a time,
 *  which is a smaller request and not a third go at the same one. The whole
 *  suite is run against stand-ins once more at the end. */
export async function askInParts({ call, run = null, tries = TRIES, size = PART_SCRIPTS, ...opts } = {}) {
  if (typeof call !== "function") throw new Error("askInParts needs a call");
  const scripts = opts.declared?.scripts ?? [];
  if ((opts.existing ?? []).length || scripts.length <= size) return askForSuite({ call, run, tries, ...opts });
  const queue = partsOf(scripts, size).map((group, i) => ({ scripts: group, first: i === 0 }));
  const files = []; const couldNot = []; const notes = []; const findings = [];
  let calls = 0; let triedAgain = false; let parts = 0;
  while (queue.length) {
    const p = queue.shift();
    const part = { ...p, others: scripts.filter((s) => !p.scripts.includes(s)), taken: [...files.map((f) => f.path), ...(opts.carried ?? []).map((f) => f.path)] };
    let got;
    try {
      got = await askForSuite({ call, run, tries, ...opts, part });
    } catch (e) {
      if (wasCut(e) && p.scripts.length > 1) {
        calls += 1;
        queue.unshift(...p.scripts.map((s, i) => ({ scripts: [s], first: p.first && i === 0 })));
        continue;
      }
      throw e;
    }
    parts += 1;
    calls += got.calls;
    triedAgain ||= got.tried_again;
    files.push(...got.files);
    couldNot.push(...got.could_not);
    if (got.notes) notes.push(got.notes);
    findings.push(...got.findings.map((f) => `in the part for ${p.scripts.join(", ")}: ${f}`));
  }
  if (declaresOutputs(opts.declared) && !callsFormatCheck(files)) findings.push(`the whole suite: ${NO_FORMAT_CHECK}`);
  if (declaresPerJobRecords(opts.declared) && !callsRecordsCheck(files)) findings.push(`the whole suite: ${NO_RECORDS_CHECK}`);
  if (trim(opts.workedTest) && !callsWorked(files) && !saysNoWorkedValues(notes.join("\n"))) findings.push(`the whole suite: ${NO_WORKED_VALUES}`);
  for (const f of pinFindings(files, { words: opts.asked ?? "", declared: opts.declared, skip: STANDARD_TESTS })) findings.push(`the whole suite: ${f}`);
  for (const f of opts.specRules === false ? [] : specFindings(files, opts.specV1, { skip: STANDARD_TESTS })) findings.push(`the whole suite: ${f}`);
  const standIns = run ? await run(withStandardTests(files, opts)) : null;
  if (standIns) for (const f of standInFindings(standIns, { skip: (opts.carried ?? []).map((x) => x.path) })) findings.push(`the whole suite: ${f}`);
  return { files, could_not: couldNot, notes: notes.join("\n"), findings, stand_ins: standIns, calls, tried_again: triedAgain, parts };
}

/** Where the reference and the worked examples are, when nothing names them.
 *  In a built package they sit under references/ beside this script's
 *  folder; in the example folder they are one level up. */
const firstOf = (tries) => tries.find((p) => existsSync(p)) ?? null;
export function referenceAt(env = {}, here = HERE) {
  return firstOf(trim(env.REFERENCE) ? [trim(env.REFERENCE)] : [
    join(here, "..", "references", "what-a-good-suite-carries.md"),
    join(here, "..", "..", "test-writer", "references", "what-a-good-suite-carries.md"),
  ]);
}
export function workedAt(env = {}, here = HERE) {
  return firstOf(trim(env.WORKED) ? [trim(env.WORKED)] : [
    join(here, "..", "references", "a-suite-that-works.test.mjs"),
    join(here, "..", "..", "publisher", "test", "publish.test.mjs"),
  ]);
}
export function workedSpecAt(env = {}, here = HERE) {
  return firstOf(trim(env.WORKED_SPEC) ? [trim(env.WORKED_SPEC)] : [
    join(here, "..", "references", "the-spec-it-tests.json"),
    join(here, "..", "..", "publisher", "spec.json"),
  ]);
}

const sum = (xs) => (xs.some((x) => x !== null) ? xs.reduce((n, x) => n + (x ?? 0), 0) : null);

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const env = process.env;
  const { DECLARED, SPEC, RECORDS, WORK } = env;
  if (!DECLARED || !SPEC || !RECORDS || !WORK) { console.error("DECLARED, SPEC, RECORDS and WORK are required"); process.exit(2); }
  const read = (p) => (p && existsSync(p) ? readFileSync(p, "utf8") : "");
  try {
    const declared = JSON.parse(readFileSync(DECLARED, "utf8"));
    const spec = loadSpec(SPEC);
    // The four model settings are the install's; with one missing, a
    // protocol this package does not declare, or the declared protocols
    // unreadable, nothing is sent and the job is refused in words.
    const protocols = declaredProtocols();
    const why = whyNoCall(env, { protocols });
    if (why) {
      console.log(JSON.stringify({ ok: false, code: 1, reply: `The suite was not written: ${why}.` }));
      console.error(why);
      process.exit(1);
    }
    const model = modelOf(env);
    mkdirSync(RECORDS, { recursive: true });
    // What the writer works from, and what it goes ahead without when a
    // reference file is not where the package put it. Said now, before the
    // call, so a run that dies in the call still says what it was short of.
    const wanted = [
      ["the reference saying what a good suite carries", referenceAt(env)],
      ["a whole suite that holds a working package", workedAt(env)],
      ["the spec that worked suite tests", workedSpecAt(env)],
    ];
    // The format check is not optional: every suite carries it, so a package
    // whose master copy is missing writes no suite rather than one without it.
    const formatTest = read(formatTestAt(env));
    if (!trim(formatTest)) throw new Error(`the standard format check ${FORMAT_TEST} is not among this package's references, so no suite is written without it`);
    // So is the records check, for the same reason.
    const recordsTest = read(recordsTestAt(env));
    if (!trim(recordsTest)) throw new Error(`the standard records check ${RECORDS_TEST} is not among this package's references, so no suite is written without it`);
    // And the worked-values check (debt 646).
    const workedTest = read(workedTestAt(env));
    if (!trim(workedTest)) throw new Error(`the standard worked-values check ${WORKED_TEST} is not among this package's references, so no suite is written without it`);
    // And the printed-reply check (debt 657).
    const replyTest = read(replyTestAt(env));
    if (!trim(replyTest)) throw new Error(`the standard printed-reply check ${REPLY_TEST} is not among this package's references, so no suite is written without it`);
    for (const [what, at] of wanted) {
      if (!at) note(RECORDS, { wanted: what, did: "asked for the suite without it, from the spec and the instruction alone" });
    }
    // The spec (spec-v1) the suite is written from (test-writer 0.9.0). A
    // build before stages.json 1.6.0 sends none, and then the suite is
    // written from the agent's own files alone, said as what the job went
    // without.
    let specV1 = null;
    if (trim(env.SPEC_V1)) {
      try { specV1 = JSON.parse(readFileSync(trim(env.SPEC_V1), "utf8")); } catch { specV1 = null; }
      if (!isSpecV1(specV1)) {
        specV1 = null;
        note(RECORDS, { wanted: "the spec (spec-v1)", did: "wrote the suite from the agent's own files alone", why: `${trim(env.SPEC_V1)} is not a spec-v1 document with features` });
      }
    } else {
      note(RECORDS, { wanted: "the spec (spec-v1), which Requirements hands back", did: "wrote the suite from the agent's own files alone, with no acceptance scenario, exact requirement or kept interface to hold it to" });
    }
    // The kept-interfaces check, made from the spec by code: no file when the
    // spec keeps no interface, and no suite when the master copy is missing
    // and the spec keeps one.
    let kept = null;
    if (specV1 && keptOf(specV1).length) {
      const master = read(keptTestAt(env));
      if (!trim(master)) throw new Error(`the standard kept-interfaces check ${KEPT_TEST} is not among this package's references, so no suite is written without it`);
      kept = keptInterfacesTest(specV1, master);
    }
    const keptTest = kept?.text ?? "";
    // What each call used, kept as the calls are made so the record can say
    // which model answered. The service reports tokens and not money, and a
    // price table would name models, so no cost is stated.
    const used = [];
    const call = callFor(env, { protocols, used });
    // The suite the package already has, when one came with the message: it
    // is added to and never rewritten.
    const existing = trim(env.EXISTING) ? suiteFiles(env.EXISTING) : [];
    // The files the change depends on that came with the message; the shared
    // copies the spec names are added from this package's own scripts/.
    const dependencies = trim(env.DEPENDS) ? dependenciesIn(trim(env.DEPENDS)) : [];
    // A revision (debt 636): only the files the message names are written
    // again. One that names none is refused before the model is asked.
    const asked = read(trim(env.ASKED_TEXT));
    // The original's own tests, placed by job.mjs (test-writer 0.10.0).
    const carriedSet = carriedIn(trim(env.CARRIED));
    const carried = carriedSet.tests;
    // Every carried and kept test loads, or that is said: never edited.
    const keptGaps = [
      ...carriedSet.gaps,
      ...loadFindings(carried).map((w) => `${w}. It is one of the original's own tests, so it is said here and never edited; drop it by naming it ("drop the original test <name>") if it cannot be kept`),
      ...loadFindings(existing.filter((f) => !STANDARD_TESTS.includes(f.path))).map((w) => `${w}. It is kept as it is`),
    ];
    const revise = trim(env.REVISE) === "1" ? namedForRevision(existing, asked) : [];
    // One feature's tests (test-writer 0.11.0): the spec with that feature alone, or, for a
    // feature it does not hold yet, the spec as it came and no spec rule asking for a scenario.
    const feature = trim(env.REVISE) === "1" ? null : featureAsked(asked);
    const featureSpec = feature && specV1 ? specForFeature(specV1, feature) : null;
    // A revision that only drops an original test, as the person named it,
    // changes no other test and asks no model.
    const dropsOnly = trim(env.REVISE) === "1" && !revise.length && carriedSet.dropped.length > 0;
    // A revision may not change one of the original's own tests.
    const lockedNamed = trim(env.REVISE) === "1" && !revise.length && !dropsOnly ? namedForRevision(carried, asked) : [];
    if (lockedNamed.length) {
      console.log(JSON.stringify({ ok: false, code: 3, reply: `Nothing was revised: ${lockedNamed.map((p) => p.replace(/^test\//, "")).join(", ")} ${lockedNamed.length === 1 ? "is one" : "are"} of the original's own tests, carried unchanged, and a revision never changes ${lockedNamed.length === 1 ? "one" : "them"}. To take ${lockedNamed.length === 1 ? "it" : "one"} out of the suite, say "drop the original test ${lockedNamed[0].replace(/^test\//, "")}" and ask again.` }));
      process.exit(0);
    }
    if (trim(env.REVISE) === "1" && !revise.length && !dropsOnly) {
      console.log(JSON.stringify({ ok: false, code: 3, reply: `Nothing was revised: the message names no file of the suite and no test in it (the suite has ${existing.filter((f) => !STANDARD_TESTS.includes(f.path)).map((f) => f.path.replace(/^test\//, "")).join(", ") || "no file"}). Name the test file, or the test as it is written, that cannot pass without breaking what the spec says, and ask again.` }));
      process.exit(0);
    }
    const out = dropsOnly ? { files: [], could_not: [], notes: "", findings: [], stand_ins: null, calls: 0, restored: [] } : await askInParts({
      call, declared, spec, specV1: featureSpec ?? specV1, existing, dependencies, revise,
      asked, carried,
      feature, featureInSpec: Boolean(featureSpec), specRules: !feature || Boolean(featureSpec),
      keptTest,
      run: async (files) => standInChecks({ spec, files, folder: statSync(SPEC).isDirectory() ? SPEC : null }),
      agentFiles: statSync(SPEC).isDirectory() ? agentFilesOf(SPEC) : [],
      reference: read(referenceAt(env)),
      worked: read(workedAt(env)),
      workedSpec: read(workedSpecAt(env)),
      formatTest,
      recordsTest,
      workedTest,
      replyTest,
      env,
    });
    // The standard checks go in beside what the model wrote. They are the
    // test writer's own files, so a suite being added to that carries an
    // older copy gets the current one; a copy that is the same bytes is left
    // as it is.
    const generated = [];
    const standard = [[FORMAT_TEST, formatTest], [RECORDS_TEST, recordsTest], [WORKED_TEST, workedTest], [REPLY_TEST, replyTest]];
    if (trim(keptTest)) standard.push([KEPT_TEST, keptTest]);
    for (const [path, text] of dropsOnly ? [] : standard) {
      const refreshed = refreshStandardTest(existing, path, text);
      existing.splice(0, existing.length, ...refreshed.existing);
      generated.push(...refreshed.generated);
    }
    // One feature's files are named for it, so two features' suites never write the same file.
    if (feature) out.files = out.files.map((x) => ({ ...x, path: featureFileName(x.path, feature) }));
    out.files = [...out.files.filter((f) => !STANDARD_TESTS.includes(f.path)), ...generated];
    // What the kept-interfaces check could not hold is said beside the suite,
    // with what the model could not test.
    if (kept?.could_not?.length) out.could_not = [...(out.could_not ?? []), ...kept.could_not];
    // A revision delivers the named files changed in place and nothing under
    // a new name; one that changed none of them is refused (AgentMesh debt 665).
    if (revise.length) {
      const got = revisionDelivery(out.files, revise);
      if (!got.revised.length) {
        console.log(JSON.stringify({ ok: false, code: 3, reply: `Nothing was revised: the answer did not change ${revise.map((p) => p.replace(/^test\//, "")).join(", ")}, the test file${revise.length === 1 ? "" : "s"} the code step sent back${got.dropped.length ? `, and wrote ${got.dropped.map((p) => p.replace(/^test\//, "")).join(", ")} instead, which a revision never delivers` : ""}. Ask again.` }));
        process.exit(0);
      }
      if (got.dropped.length) out.findings = [...(out.findings ?? []), `not delivered, because a revision changes only the files it was sent back for: ${got.dropped.join(", ")}`];
      out.files = got.files;
    }
    // A file the answer still wrote under the name of an original test is
    // never delivered: the original's own test keeps its name.
    const lockedPaths = new Set(carried.map((f) => f.path));
    const tookName = out.files.filter((f) => lockedPaths.has(f.path)).map((f) => f.path);
    if (tookName.length) {
      out.files = out.files.filter((f) => !lockedPaths.has(f.path));
      out.findings = [...(out.findings ?? []), `not delivered, because the name is an original test's, carried unchanged: ${tookName.join(", ")}`];
    }
    // A revised file replaces the one it revises; the rest are kept.
    const revised = out.files.map((f) => f.path).filter((p) => revise.includes(p));
    existing.splice(0, existing.length, ...existing.filter((f) => !revised.includes(f.path)));
    // The kept files go into the work folder beside the new ones, so the
    // check runs the suite as it will stand; only the new ones are delivered.
    // The original's own tests go in too, with the files they import and
    // their record; they are delivered when they came by the manifest, and
    // the record alone when a revision dropped one (test-writer 0.10.0).
    for (const f of [...existing, ...out.files, ...carried, ...carriedSet.support]) {
      const at = join(WORK, f.path);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, f.bytes ?? f.text);
    }
    if (carriedSet.record) writeFileSync(join(WORK, CARRIED_RECORD), carriedSet.record);
    const carriedDelivered = carriedSet.from === "manifest"
      ? [...carried.map((f) => f.path), ...carriedSet.support.map((f) => f.path), ...(carriedSet.record ? [CARRIED_RECORD] : [])]
      : carriedSet.dropped.length && carriedSet.record ? [CARRIED_RECORD] : [];
    mkdirSync(RECORDS, { recursive: true });
    const files = out.files.map((f) => ({ path: f.path, tests: testNamesOf(f.text).length, names: testNamesOf(f.text) }));
    writeFileSync(join(RECORDS, "suite.json"), JSON.stringify({
      suite: "v1", at: new Date().toISOString(), work: WORK, files,
      ...(existing.length ? { kept: existing.map((f) => f.path) } : {}),
      ...(revise.length ? { revised } : {}),
      ...(generated.length ? { generated: generated.map((f) => f.path) } : {}),
      ...(out.parts ? { parts: out.parts } : {}),
      ...(out.restored?.length ? { restored: out.restored } : {}),
      // The spec the suite was written from (test-writer 0.9.0).
      ...(specV1 ? { spec: {
        product: specV1.product?.name ?? null, version: specV1.product?.version ?? null,
        scenarios: scenariosOf(specV1).map((s) => s.id),
        tested_requirements: testedRequirements(specV1).map((r) => r.id),
        kept: keptOf(specV1).map((i) => i.id),
        ...(kept ? { kept_tests: kept.tests } : {}),
      } } : {}),
      // The original's own tests (test-writer 0.10.0): each by its name in
      // the suite and its path in the codebase, with the tests it names, so
      // a reader can tell them from the ones written from the spec.
      ...(carriedSet.record || carriedSet.gaps.length || carriedSet.dropped.length ? { carried: {
        tests: carried.map((f) => ({ path: f.path, file: carriedSet.files.get(f.path)?.file ?? null, at: carriedSet.files.get(f.path)?.at ?? null, tests: testNamesOf(f.text).length, names: testNamesOf(f.text) })),
        support: carriedSet.support.map((f) => f.path),
        record: carriedSet.record ? CARRIED_RECORD : null,
        delivered: carriedDelivered,
        dropped: carriedSet.dropped,
        words: carriedWords({ tests: carried, support: carriedSet.support, dropped: carriedSet.dropped }),
      } } : {}),
      ...(keptGaps.length ? { load_gaps: keptGaps } : {}),
      could_not: out.could_not, notes: out.notes, findings: out.findings, stand_ins: out.stand_ins,
    }, null, 2) + "\n");
    writeFileSync(join(RECORDS, "calls.json"), JSON.stringify({
      calls: "v1", model, service: modelSettings(env).protocol, made: out.calls,
      answered_by: [...new Set(used.map((u) => u.answered_by).filter(Boolean))],
      tokens_in: sum(used.map((u) => u.tokens_in)), tokens_out: sum(used.map((u) => u.tokens_out)), cost: sum(used.map((u) => u.cost)),
      each: used,
    }, null, 2) + "\n");
    console.log(JSON.stringify({
      ok: true, code: 0, files: files.map((f) => f.path), tests: files.reduce((n, f) => n + f.tests, 0),
      findings: out.findings, calls: out.calls, model,
    }));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
