# What a good test suite carries

Read off the nine packages that already have one, not invented. Every number
here was counted on 2026-09-13 across brand-reader, brief-writer,
explainer-critic, explainer-maker, process-runner, publisher, quiz-maker,
spec-writer and video-watcher: 74 scripts, 51 test files, 589 tests.

This is the reference the writing step works from. It says what a suite that
holds a working package carries, and where the existing nine are thin.

## One file per script, or one per package

51 files for 74 scripts, median 10 tests per file and never more than 45.
publisher covers five scripts in one file of 25 tests; process-runner has
twelve files for eleven scripts. Either is fine. A file is named after the
script or the concern it pins: asked.test.mjs, draft.test.mjs,
publish.test.mjs. It runs with `node --test test/<file>` and nothing else: no
runner, no config, no dependency outside node itself, and `import { test }
from "node:test"` with `assert from "node:assert/strict"`.

## Every file opens by saying what is worth pinning

All 51 begin with a comment block: what the script decides, which of those
decisions are worth pinning and why, what the tests never touch, and the run
line. publisher's opens "Publishing decides on bytes, and says nothing is
published until it has looked at the address," and then lists seven
decisions. A reader who never runs the suite learns from that block what the
script promises. The block ends with what the suite never does: "Nothing here
touches a network: the host and the addresses are functions the test hands
in."

## Tests call the functions, and the script is a thin main

49 of 51 files import named functions from `../scripts/<name>.mjs` and call
them. 68 of the 74 scripts export their working functions for exactly this
reason; the main, under a guard comparing `import.meta.url` to
`process.argv[1]`, reads the variables, calls those functions and prints. So
a test of a decision is a call and an assertion, not a process.

A suite written before the scripts exist is the suite that names those
functions. The imports it writes are the interface the scripts will have to
meet, so they are chosen with care: one function per decision, named for
what it decides (`typeOf`, `carriesASecret`, `nameFor`, `blanksOf`), taking
plain values and returning plain values, with anything that reaches the world
handed in as a function (`fetchImpl`, `call`, `io`).

Nothing in the nine touches a network, a model or a real host. Where a
script would, the test hands in a function: `fetchImpl: async () => ({ ok:
false, status: 403 })`, `call: async () => JSON.stringify({ spec, blanks: []
})`. A test that fails is then a decision that failed, never a host that was
down.

## The process contract is pinned too, once

28 of 51 files also spawn the script as a process, `spawnSync("node",
[script], { env })`, to pin the contract the harness relies on. Called with
a required variable missing, it exits 2 and says which: "JOB_DIR and RECORDS
are required" (48 of 74 scripts do this). On a job with nothing to do it
exits 3 with a reply that names what would be enough (4 scripts). On an error
it exits 1 (41 scripts). What it prints: 14 scripts print one JSON object; 60
print one sentence or nothing at all and write their result to the files the
variables name. So a test of a script's output reads the file it wrote, not
stdout. 27 files assert an exit code and only 5 parse stdout as JSON.

## Temp folders, cleaned whatever happened

29 of 51 files make a folder with `mkdtempSync(join(tmpdir(),
"<package>-"))` and remove it in `finally`. One helper per file does it,
`folders(async (at) => { ... })` or `work()`, and the test body is given the
paths. Nothing is written beside the package and nothing is left behind.

## A test's name is a sentence about the decision

Median 14 words. 586 of 589 start lowercase; none start with "test" or
"should". 248 of 589 say what must not happen: "a credential is refused on its
bytes, whatever the file is called", "a stop files no pieces", "nothing is
altered to make it publishable". The name states the rule and the assertions
are the evidence. An assertion carries its own message where the failure
would otherwise be unreadable: `assert.equal(calls, 0, "it did not even ask
the host for a token")`.

## What is asserted

`assert.match` on reply text, in 44 files: the reply is the product, and the
phrase that matters is pinned with a regex, `/does not publish one whatever it
is called/`. `deepEqual` in 48 files, for records and lists. `assert.throws`
in 30, for refusals the function throws. Exact equality for numbers, codes
and paths. 17 files have async tests, for functions that take a handed-in
async call.

## What a suite pins, in the order it matters

1. Each refusal the spec lists, as a case that tries the thing and is
   refused, with the reply's wording. A refusal with no test is a sentence
   in a file.
2. The empty case: nothing given, or nothing readable, exits 3 with the reply
   the job's `empty` sentence promises; no model is called and no pieces are
   filed.
3. Each record the spec declares is written where it is declared, with the
   shape the script documents, and written whether the job succeeded or not.
4. The good case: the job's `good` sentence, turned into assertions on the
   artifact, clause by clause.
5. The process contract, once per script: the exit-2 line, and the exit-3
   line where the script has one.
6. The declaration itself: publisher's last test reads agent-descriptor.json
   and checks the offering's steps and that each one's `how` is what it
   claims. A package's root holds its agent-descriptor.json, so a suite reads
   it at `../agent-descriptor.json` from test/, and never a spec.json.

## Where the nine are thin

Two files import nothing from the scripts and pin by process alone. Four
packages have no test that reads their own declaration. Nine packages declare
went-without.json and only spec-writer's suite tests that anything writes it.
Do better than that wherever the spec gives the material.

## The suite is run against nothing before it is delivered

A suite written before the scripts exist is run against empty scripts, one
stand-in for every file the spec names. It must fail. A suite that passes
with every function absent has asserted nothing, and that is the check the
writing step is held to. When the scripts do exist, each is blanked in turn
and the suite run again; a script whose absence the suite never notices is a
script nothing tests, and the verdict says so by name.

## The two scripts every package shares, and their fixed exports

Most specs name `scripts/went-without.mjs` and `scripts/pieces.mjs`. They
are the same two files in every package that has them, copied and not
rewritten, so a suite imports their names as they are and does not guess at
others. On 2026-09-14 the first real run imported names these files do not
export, and the tests that did so failed for a reason that was not the
code-writer's.

`scripts/went-without.mjs` exports exactly: `FILE` (the string
`"went-without.json"`), `fileIn(records)` (the path of that file under the
records directory), `note(records, { wanted, did, why })` (appends one
entry and returns it), `read(records)` (the entries, `[]` when the file is
absent), `sentence(entries)` (one sentence over a list of entries, `""` for
none) and `paragraph(records)` (`sentence(read(records))`).

`scripts/pieces.mjs` exports `STEP_OF` (which step each kind of piece comes
from), `aboutOf(text, path)` (the one-line description a piece is filed
with), `plan(...)` (the pieces list for a job, from what the job made; its
named options are the package's own and the spec's scripts say which) and
`fill(jobDir, { entries, copies })` (writes pieces.json under the job folder
and copies each file under out/). Test `plan` through the package's own
scripts that call it rather than by guessing its options.
