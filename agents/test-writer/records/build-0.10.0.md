# test-writer 0.10.0: the original's own tests are in the gate

Date: 2026-11-09.

## Why

In a round trip on a real agent (a reader of a public news list), the
original had 21 tests. The rebuild passed its own 90-test gate while passing
only 6 of the original's 21, because the original's tests were never in the
gate: the reverse engineer's write-up listed them by name and nothing carried
them. The original's own tests are the strongest check a rebuild meets, so
they are carried forward unchanged, and code checks that every test can load.
Round trip 3 also had two tests that threw a ReferenceError (`__dirname` in an
ES module) before reaching any script.

The reverse engineer 0.3.0 adds to its write-up folder each original test at
`tests/<path in the codebase>`, each file a test imports from outside the
codebase folder, with the whole closure of what those import, at
`support/<path from the repository's top>`, and a `carried` list in
tests-and-gaps.json: `[{file, at, imports: [{from, support}]}]`. Its
interfaces.json gains interfaces of kind `constant` and `declaration`, which
the spec writer carries into the spec (standards/spec.schema.json 1.1.0) as
kept interfaces.

## What changed (from 0.9.0)

- `scripts/carried.mjs`, new, no model:
  - `carriedAmong`: the carried manifest (`carried_tests: "v1"` with `tests`)
    or the record a suite carries (`carried_tests: "v1"` with `placed`), by
    content, under any name; the record governs when both came.
  - `placeCarried`: each attached file matched to its entry by its SHA-256
    (by its file name only where no digest is given and one file has it);
    each test placed at `test/<its file name>` ending `.test.mjs`, a name
    already taken getting the folders it sat in; only the import specifiers
    the manifest lists rewritten, to `./support/<path from the repository's
    top>`; each support file at `test/support/<the same path>`, byte for
    byte; the record, `test/carried-tests.json`. What did not come, a
    specifier the test does not have, and a test that sat deeper in the
    codebase with relative imports of its own are gaps in words.
  - `changedBeyondImports`: the check the other way round: each rewritten
    specifier put back, the result must be the original byte for byte, or
    the test is not carried.
  - `dropsAsked`: "drop the original test <name>" (or "carried test") in the
    person's words; the drop is recorded in the record with its time.
  - `loadProblems`, `loadFindings`: `node --check` over the file, and, for an
    ES module, each of `__dirname`, `__filename` and `require` used and not
    declared (a comment, a string, a member or a key is not a use; a
    `const __dirname = ...` or createRequire's `const require` declares it).
- `scripts/job.mjs`: finds the manifest or the record before anything else
  reads the attachments, places the carried tests by code in
  `<work>.carried/` and passes it to the writing step as `CARRIED`. None of
  those files is read as a suite to add to, a dependency or a spec. In a
  revision, an original sent again beside the record, and a manifest, are
  taken too.
- `scripts/write-suite.mjs`: the carried tests go to the model whole under
  `--- THE ORIGINAL'S OWN TESTS ---` (`CARRIED_INSTRUCTION`). An answer under
  a carried name is a finding and is never delivered. Every file the model
  wrote is checked to load, and a failure is a finding for the second go;
  every carried and kept file is checked the same way, and a failure is said
  in the reply (`load_gaps` in suite.json), never edited. A standard check or
  a carried test that fails against the agent's files is not sent to the
  model as one it can mend. The carried tests, support files and record go
  into the work folder; suite.json lists them under `carried` (each test's
  name in the suite, its path in the codebase and the tests it names, the
  support files, what is delivered, the drops). A revision that names only a
  carried test is refused in words; one that only drops a carried test asks
  no model and delivers the record alone.
- `scripts/check-suite.mjs`: `placeSuite` places `test/support/**` and
  `test/carried-tests.json` beside the tests and runs only
  `test/<name>.test.mjs`; `supportFiles` reads them, so the check and the
  proving runs see the suite as it stands. A file under `test/support/` is
  never a test, whatever its name.
- `scripts/pieces.mjs`: delivers the carried files at `out/<their path>`, the
  support files keeping their layout, the record as
  `application/vnd.agentmesh.carried-tests+json`.
- `scripts/reply.mjs`: says what was carried, each drop, and each test kept
  as it is that will not load.
- `scripts/kept-interfaces.mjs` and the master copy
  `references/kept-interfaces.test.mjs`: a kept constant gets a test that it
  is exported from its module with exactly the value the spec keeps (a
  regular expression by its written form or source, anything else as JSON);
  a kept declaration, that the agent's file carries exactly its value at
  `declared_in` (members, `[n]`, `["name"]` and `[id=x]`). One with no value,
  no module, or a place in a file that is not JSON is said beside the suite.
- The descriptor: a new input, the original's own tests, and a new output,
  the record of the original's own tests. README, rules.md, the reference and
  the write-a-suite and write-the-suite skills say the same.

## The manifest

```json
{ "carried_tests": "v1",
  "tests": [{ "file": "test/x.test.mjs", "at": "tests/test/x.test.mjs", "sha256": "<hex>",
              "imports": [{ "from": "../../lib/a.mjs", "support": "support/lib/a.mjs" }] }],
  "support": [{ "path": "support/lib/a.mjs", "sha256": "<hex>" }] }
```

`tests` is the write-up's `carried` list with each test's digest added;
`support` is every file under the write-up's `support/` folder.

## What stays

Its name, price, offerings, refusals and records. A build with no manifest is
written as 0.9.0 wrote it.

## Tests

Model-free, on a made-up write-up (`test/fixtures/carried/`: an echo agent's
own test importing a matcher at its repository's top, which imports a plan,
which imports agreements, which import a table):

- `test/carried.test.mjs`, 9 tests: found by content and digest under hop
  names; the listed specifier rewritten and nothing else; the placed suite
  with its three-deep closure runs and passes against the agent's script and
  fails against an empty one; the reverse check finds a change; name
  matching and gaps; names in use and nested tests; the record in a
  revision; drops; the load check; support files placed and never run.
- `test/carried-suite.test.mjs`, 3 tests: the job hands the carried tests
  over as CARRIED and as nothing else; against a stand-in model server on
  this machine, an answer taking a carried name and using `__dirname` goes
  back, the carried test keeps its name and bytes, and the pieces deliver
  the support files in their layout; in a revision a carried test named
  alone is refused, and a drop asks no model and delivers the record.
- `test/kept-interfaces.test.mjs`, 2 more: the plan for constants and
  declarations, and the generated file run in a package passing when the
  values are kept and failing, naming the interface, when they are not.

The package's suite: 260 tests, 259 pass, 1 skipped (as before).

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.7.0 recorded. No live model
was run.
