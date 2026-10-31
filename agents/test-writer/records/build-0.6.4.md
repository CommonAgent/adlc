# test-writer 0.6.4: a suite the code step sent back is revised, only in the files named

Date: 2026-10-31.

## Why

Technical debt 636. A build had no way back from Code to Test when the code
writer, or a person's own coding agent on a pull request, found a test that
cannot pass without breaking what the spec says. The code writer stops on a
conflict as its rules say, the build ended "refused at Code", and nothing
could move it on: acronym-maker (ab_6494822a9f81a1fb90, a pull request
hand-off), vowel-counter (ab_fa800bf8ce54a325ee), vowel-tally
(ab_6d0a79ba51025b1beb) and vowel-scale (ab_481ac696b24d8cf8fd) stopped
there on dev. Build an agent now offers "Send back to Test" at Code, which
asks this agent to revise the suite.

## What changed

- job.mjs: a message whose first line begins "Revise the suite" is a
  revision. It needs the suite attached, and is refused in words without
  one; otherwise the writing step is handed REVISE=1 beside EXISTING and
  ASKED_TEXT.
- write-suite.mjs: namedForRevision finds the files the message names, by
  file name or by the name of a test in them, never the three standard
  checks. A revision that names none is refused in words before the model is
  asked. reviseInstruction tells the model the spec governs and names the
  files to rewrite whole; the rest of the suite goes to it whole and is kept
  byte for byte. staticFindings lets a named file come back under its own
  name, still refuses a kept one, and names an answer that rewrites none of
  them; reach and count are over the suite as it will stand. suite.json
  records `revised`.
- reply.mjs: "Revised N test files the code step sent back ... The other M
  files were kept exactly as they were and are not sent back."
- rules.md, the write-a-suite skill and the descriptor (a new optional input,
  what the code step sent back) say the same.

## Tests

test/revision.test.mjs, 8 tests, written first and failing. 166 tests, 165
pass, 1 skipped.

## Who held each step

The harness (Claude Code) stood in for the test and code steps, the tests
first.
