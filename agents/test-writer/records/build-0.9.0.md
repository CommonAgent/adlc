# test-writer 0.9.0: the suite is written from the spec

Date: 2026-11-09.

## Why

On 2026-11-09 a real agent (a reader of a public news list) was rebuilt from
its as-built record. The record captured the runner's stop pattern, where page
metadata is read from, the refusal's wording and the output's schema exactly.
None of it reached this agent. Product Factory attached the record's JSON
files beside the agent's own files, and `scripts/job.mjs` picked out only the
agent's files, test files and scripts; everything else was dropped without a
word, and `requestParts` in `scripts/write-suite.mjs` had no section for it.
The suite was written from a descriptor, and the gate passed code the
original's own tests fail.

The standard changed first (stages.json 1.6.0, `standards/spec.schema.json`):
Requirements hands back the spec (spec-v1), the analysis of the product's
functional requirements, and Test is given the spec and the agent's own files
from Design. It hands back a suite with at least one test per acceptance
scenario, named by its id, and is done when every acceptance scenario has a
test, every exact word, pattern and number a requirement verified by test
fixes is checked by a test, the suite fails against empty stand-ins, and it
notices each program removed.

## What changed (from 0.8.0)

- `scripts/spec-rules.mjs`, new, no model:
  - `specV1Among`: the spec among the attachments, by its format
    (`"format": "spec-v1"` with features), under any name; with two, the one
    whose product version is the agent's own, else the last.
  - `acceptanceFindings`: each acceptance scenario no test is named for, by
    its id in square brackets (`[F1.A1] ...`).
  - `exactFindings`: each entry of `exact` of a requirement whose verify is
    `test` that no test named for its feature carries (a test named with the
    feature's id, a scenario's or a requirement's, and the one-line or worked
    constants it uses): words and patterns byte for byte (as written, escaped
    as a pattern, inside a string, or with slashes escaped), a number as the
    number (a time in seconds or milliseconds). A constraint's is looked for
    in tests named for it, else anywhere.
  - `keptCallFindings`: each kept file or message with a schema that no test
    holds with `checkKept` or `keptProblems`.
- `scripts/kept-interfaces.mjs`, new, no model: makes
  `test/kept-interfaces.test.mjs` from the master copy
  (`references/kept-interfaces.test.mjs`, new) and the spec, by filling its
  `KEPT` and `FROM` lines. For each interface with `keep: true`: a function
  gets a test that it is exported under its name from its module, async as
  its signature says; a command, that it accepts its flags; a file, that its
  examples fit its schema, and `checkKept(jobDir, { expect })` for the
  suite's own tests; a message, `keptProblems(id, value)`. An http interface,
  a setting or a function with no module gets none, and the reason goes beside
  the suite as what could not be tested, as does each schema keyword the
  check does not read.
- `scripts/job.mjs`: finds the spec by content, lays it out by its bytes
  beside the work folder and passes it to the writing step as `SPEC_V1`; it is
  never taken for a suite or a dependency. A spec with no agent's files is
  refused in words.
- `scripts/write-suite.mjs`: the spec goes to the model whole in its own
  section, `--- THE SPEC ---`, with what to do with it (`specInstruction`),
  ahead of the reading of the agent's files, which is then headed `--- WHAT
  THE AGENT'S FILES DECLARE ---`. With no spec the request is as it was. The
  three spec checks run in the static check (so the second go carries them)
  for a new suite and one being added to, and over the whole suite at the end
  of one written in parts; never in a revision. The kept-interfaces file is a
  standard file: added after the answer, never written by the model, never
  revised, run with the suite against stand-ins. `suite.json` records the
  spec it was written from (`spec`: product, version, scenarios, the
  requirements a test verifies, the kept interfaces and their tests). With no
  spec, `went-without.json` says so.
- `scripts/suite-rules.mjs`: `featureIdsOf` reads `[F1.A2]` as F1, so the
  feature checks of 0.8.0 count a scenario's test; `namedTestsIn` and
  `namedForRevision` read a scenario id in the person's words (`F1.A2`) as
  naming the test whose name opens with it, the id read whole.
- The descriptor: the spec is an input of its own (spec-v1, optional for one
  transition), beside the agent's own files (required).
- README, rules.md, the reference (`what-a-good-suite-carries.md`) and the
  write-a-suite and write-the-suite skills say the same.

## What stays

Its name, price, offerings, outputs, refusals and records. A suite written
with no spec is written as 0.8.0 wrote it, and a revision changes only the
tests it names, as in 0.8.0.

## Tests

Model-free, on a made-up spec (`test/fixtures/spec-v1/points-reader.spec.json`:
a pattern, a limit, a wording, a refusal, a constraint, a kept async function,
a kept file with a schema, a kept command, an http interface and one that may
change) and the agent's files for it:

- `test/spec-rules.test.mjs`, 13 tests: finding the spec, the three checks
  with one finding each, the second go, no spec check in a revision, the
  request's sections and order, scenario ids in a revision.
- `test/kept-interfaces.test.mjs`, 10 tests: the plan, the same bytes for the
  same spec, the generated file run in a package that keeps the interfaces
  (passes), one that makes the function sync and refuses a flag (fails naming
  [I1] and [I3]), one that renames the function, and an empty stand-in
  (fails); checkKept against good and bad output.
- `test/written-from-the-spec.test.mjs`, 4 tests: the job hands on the spec;
  a spec alone is refused; the writing step run against a stand-in model
  server on this machine sends the spec whole, sends back the scenario the
  first answer missed, and writes the kept-interfaces file; with no spec it
  says it went without one.

The package's suite: 246 tests, 245 pass, 1 skipped (as before).

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.7.0 recorded. No live model
was run.
