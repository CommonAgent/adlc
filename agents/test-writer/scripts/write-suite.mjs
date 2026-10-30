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
//   [EXISTING=<folder holding test/>] [ASKED_TEXT=<the message, as a file>]
//   [REFERENCE=<md>] [WORKED=<test file>] [WORKED_SPEC=<spec.json>] node write-suite.mjs
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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { standInRun, suiteFiles } from "./check-suite.mjs";
import { note } from "./went-without.mjs";
import { loadSpec } from "./agent-folder.mjs";
import { callModel, cannotCall, modelSettings } from "./model-caller.mjs";

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

/** The parts of the request, in order, as text. Pure and exported so the
 *  whole prompt can be read in a test rather than inferred from a fixture. */
export function requestParts({ spec = null, declared = null, reference = "", worked = "", workedSpec = "", findings = [], asked = "", existing = [], part = null } = {}) {
  const parts = [INSTRUCTION];
  if (trim(asked)) parts.push(`--- WHAT THEY ASKED FOR ---\n${trim(asked)}`);
  parts.push(`--- THE SPEC ---\n${spec ? JSON.stringify(spec, null, 2) : "(no spec)"}`);
  const commands = (declared?.jobs ?? []).flatMap((j) => (j.commands ?? []).map((c) => ({ job: j.slug, ...c })));
  if (commands.length) {
    parts.push(`--- THE COMMANDS THE HARNESS RUNS ---\n${commands.map((c) =>
      `${c.job}: ${c.script}${c.variables.length ? ` with ${c.variables.join(", ")}` : ""}${c.flags.length ? ` and --${c.flags.join(" --")}` : ""}`).join("\n")}`);
  }
  if (trim(reference)) parts.push(`--- WHAT A GOOD SUITE CARRIES ---\n${trim(reference)}`);
  if (trim(worked)) parts.push(`--- A SUITE THAT WORKS ---\n${trim(worked)}`);
  if (trim(workedSpec)) parts.push(`--- THE SPEC THAT SUITE TESTS ---\n${trim(workedSpec)}`);
  if (existing.length) {
    parts.push(`--- THE SUITE IT ALREADY HAS ---\n${existing.map((f) => `<<<FILE ${f.path}>>>\n${f.text}<<<END>>>`).join("\n")}`);
    parts.push(ADD_INSTRUCTION);
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

/** Whether some file of a suite calls the format check on a job folder. */
export const callsFormatCheck = (files = []) => files.some((f) => f.path !== FORMAT_TEST
  && /from\s+["']\.\/delivered-formats\.test\.mjs["']/.test(f.text) && /checkDelivered\s*\(/.test(f.text));

export const NO_FORMAT_CHECK = "no test calls checkDelivered(jobDir) from ./delivered-formats.test.mjs on a job folder it filled, so nothing checks that each delivered piece is in its declared format; call it in each test that fills a job folder and assert it returns []";

/** The names of the tests in a file, as written. */
export function testNamesOf(text) {
  return [...String(text ?? "").matchAll(/^\s*test(?:\.skip|\.only)?\(\s*(["'`])((?:(?!\1).)+)\1/gm)].map((m) => m[2]);
}

/** What is wrong with a suite before it is run. Each finding is a sentence
 *  the model can act on. */
export function staticFindings(files = [], declared = null, { existing = [], taken = [], scripts = null, formatCheck = false } = {}) {
  const out = [];
  if (!files.length) return ["no test file came back"];
  // The format check is the test writer's own file, added after the answer.
  if (files.some((f) => f.path === FORMAT_TEST)) {
    out.push(`${FORMAT_TEST} is written by the test writer itself and added to every suite; do not answer with it`);
    files = files.filter((f) => f.path !== FORMAT_TEST);
    if (!files.length) return out;
  }
  // A file under a name the suite already has is a rewrite, and a rewrite of
  // a released agent's suite is what this guards against.
  const kept = new Set([...existing.map((f) => f.path), ...taken]);
  for (const f of files) {
    if (kept.has(f.path)) out.push(`${f.path} is already in the suite and is kept as it is; put new tests in a new file with a name of its own`);
  }
  // Reach and count are over the suite as it will stand: what it already
  // has, and what came back. In a part they are over that part's scripts.
  const whole = [...existing, ...files];
  const named = scripts ?? declared?.scripts ?? [];
  let total = existing.reduce((n, f) => n + testNamesOf(f.text).length, 0);
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
  const all = whole.map((f) => f.text).join("\n");
  for (const s of named) {
    const name = String(s).split("/").pop();
    if (!all.includes(name)) out.push(`nothing reaches ${s}: no file imports it or spawns it`);
  }
  if (formatCheck && !callsFormatCheck(whole)) out.push(NO_FORMAT_CHECK);
  const k = named.length;
  if (k && total < 2 * k) out.push(`${total} test${total === 1 ? "" : "s"} for ${k} script${k === 1 ? "" : "s"}; the nine existing suites carry about eight per script, and fewer than two each is not a suite`);
  return out;
}

/** What the stand-in run says is wrong, in the model's terms. */
export function standInFindings(run) {
  if (!run) return [];
  if (run.timed_out) return [`against empty stand-ins the suite did not finish in time; a test must not wait on anything`];
  if (run.tests === 0 && run.status === 0) return ["against empty stand-ins no test ran at all; the files must be test/<name>.test.mjs and use node:test"];
  if (!run.fails) return [`against empty stand-ins for every script the suite passed (${run.pass} of ${run.tests}), so it asserts nothing about them; import the functions and assert what they return`];
  return [];
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
  for (let go = 0; go < tries; go += 1) {
    const request = suiteRequest({ ...opts, findings });
    calls += 1;
    last = answerFrom(await call(request));
    findings = staticFindings(last.files, opts.declared, {
      existing: opts.existing ?? [], taken: opts.part?.taken ?? [], scripts: opts.part?.scripts ?? null,
      // Over the whole suite when it is one ask; a suite in parts is held to
      // it once all its parts are in (askInParts).
      formatCheck: !opts.part && declaresOutputs(opts.declared),
    });
    standIns = null;
    if (!findings.length && run) {
      standIns = await run(withFormatTest(last.files, opts.formatTest));
      findings = standInFindings(standIns);
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
    const part = { ...p, others: scripts.filter((s) => !p.scripts.includes(s)), taken: files.map((f) => f.path) };
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
  const standIns = run ? await run(withFormatTest(files, opts.formatTest)) : null;
  if (standIns) for (const f of standInFindings(standIns)) findings.push(`the whole suite: ${f}`);
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
    for (const [what, at] of wanted) {
      if (!at) note(RECORDS, { wanted: what, did: "asked for the suite without it, from the spec and the instruction alone" });
    }
    // What each call used, kept as the calls are made so the record can say
    // which model answered. The service reports tokens and not money, and a
    // price table would name models, so no cost is stated.
    const used = [];
    const call = callFor(env, { protocols, used });
    // The suite the package already has, when one came with the message: it
    // is added to and never rewritten.
    const existing = trim(env.EXISTING) ? suiteFiles(env.EXISTING) : [];
    const out = await askInParts({
      call, declared, spec, existing,
      asked: read(trim(env.ASKED_TEXT)),
      run: async (files) => standInRun({ spec, files, folder: statSync(SPEC).isDirectory() ? SPEC : null }),
      reference: read(referenceAt(env)),
      worked: read(workedAt(env)),
      workedSpec: read(workedSpecAt(env)),
      formatTest,
      env,
    });
    // The format check goes in beside what the model wrote. It is the test
    // writer's own file, so a suite being added to that carries an older copy
    // gets the current one; a copy that is the same bytes is left as it is.
    const refreshed = refreshFormatTest(existing, formatTest);
    existing.splice(0, existing.length, ...refreshed.existing);
    const generated = refreshed.generated;
    out.files = [...out.files.filter((f) => f.path !== FORMAT_TEST), ...generated];
    // The kept files go into the work folder beside the new ones, so the
    // check runs the suite as it will stand; only the new ones are delivered.
    for (const f of [...existing, ...out.files]) {
      const at = join(WORK, f.path);
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, f.text);
    }
    mkdirSync(RECORDS, { recursive: true });
    const files = out.files.map((f) => ({ path: f.path, tests: testNamesOf(f.text).length, names: testNamesOf(f.text) }));
    writeFileSync(join(RECORDS, "suite.json"), JSON.stringify({
      suite: "v1", at: new Date().toISOString(), work: WORK, files,
      ...(existing.length ? { kept: existing.map((f) => f.path) } : {}),
      ...(generated.length ? { generated: generated.map((f) => f.path) } : {}),
      ...(out.parts ? { parts: out.parts } : {}),
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
