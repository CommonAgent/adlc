# test-writer 0.8.0: numbers pinned, async refusals, revisions that change only what was named

Date: 2026-11-09.

## Why

On 2026-11-09 a real agent (a reader of a public news list) was reverse
engineered, rebuilt from its as-built record through the lifecycle, and the
rebuild failed the original's tests 0 of 21. Three of the losses were this
agent's:

- The features said "a 10-second timeout", "up to 20 at a time" and
  "2,000,000 characters". No test of those features asserted the first two,
  so the code written to the suite kept neither.
- One test wrapped a function that reads through an async fetch in
  `assert.throws`. That sees only a throw made before the function returns,
  so no script that keeps the spec could pass it, and the build stopped at
  Code until a person sent the suite back.
- Sent back with "Make that test async and use await assert.rejects. Change
  nothing else.", the answer also rewrote two other tests' assertions and a
  worked constant they used, and dropped another constant.

## What changed (from 0.7.1)

- `scripts/suite-rules.mjs`, new, no model:
  - `pinFindings`: each number (digits, thousands commas, or a number word
    from two to a hundred) and each quoted word or pattern that a feature
    the message lists, or a refusal the spec declares, states and no test of
    it carries. A feature's tests are those named with its id in square
    brackets; what they carry is their own text and each constant of their
    file they name that is a worked value or fits on one line, so sample
    data and stand-ins pin nothing. A time limit may be written in seconds or
    milliseconds. A feature no test is named for is a finding once any test
    is named for one.
  - `asyncThrowsFindings`: each `assert.throws` or `assert.doesNotThrow`
    whose callback is async, awaits, or names a function the file or a file
    the change depends on declares async, or hands an async stand-in, by
    file and line.
  - `namedTestsIn` and `restoreUnnamed`: in a revision, the tests the
    person's words name (by name, by a cited line, or by a phrase quoted from
    that test alone; the whole file when none is named), and the file with
    every other test put back byte for byte, an added test taken out and a
    shared constant kept as it was.
- `scripts/write-suite.mjs`: the instruction says to pin every number and
  rule a feature states and to test an async function with
  `await assert.rejects`. Both checks run in the static check, so their
  findings go back to the model once; the pin check holds a whole new suite
  (and a suite in parts once all its parts are in), never one being added to
  or revised. A revision's answer has every test the words did not name put
  back before anything is checked (`keepUnnamed`); a file that comes out the
  same was not revised and is asked for again; the line checks read only the
  answer's own lines; and the revise instruction lists the named tests.
  `suite.json` records what was put back under `restored`.
- `scripts/reply.mjs`: the reply says what a revision put back.
- rules.md, the reference, README and the write-a-suite and write-the-suite
  skills say the same.

## What stays

Its name, price, offerings, inputs, outputs, refusals and records. A suite
being added to is checked as before.

## Tests

`test/suite-rules.test.mjs`, 12 tests on small made-up suites, model-free.
The round trip's revision, run through `keepUnnamed` by hand, comes out the
suite before it with the one named line changed. The package's suite: 219
tests, 218 pass, 1 skipped (as before).

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.7.0 recorded.
