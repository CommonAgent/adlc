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

## On dev

- Packed by the package maker on the dev fleet host from adlc 5ea1488:
  sha256 020e50dc1d992e538da49270abc90d0e7836c4e4727447fde2c23702a664267e.
- Installed by the deployment manager from deploy request
  dr_rTEydPUt6k5WRGNGRtMJ26dm, approved by the platform account, same
  settings as 0.6.3.

## Proof

All three sent back from the ADLC console, as a person would.

- vowel-scale (ab_481ac696b24d8cf8fd): the person named count.test.mjs and the
  test "accented letters and non-plain characters are disregarded rather than
  counted". The first ask ended on the host's model gateway (debt 651, Headers
  Timeout); the second revised count.test.mjs alone: "Café façade rôle naïve"
  now works a = 4, e = 3, total = 7 with worked(), and the other three files
  were kept. The code writer then passed the suite and the sandbox passed it.
  The package maker refused the spec's run.reply (debt 652, a spec-writer
  matter), so this build stops at Package.
- vowel-tally (ab_6d0a79ba51025b1beb): the person named count.test.mjs and its
  indexOf order test. The test writer revised it (and brought the standard
  records check current); the code writer passed it; packed, installed and
  Conformance "conforms" (4 passed, 0 failed, 1 flagged for a person).
- acronym-maker (ab_6494822a9f81a1fb90, a pull request hand-off): revised from
  the coding agent's records/conflict.md alone; test/acronym.test.mjs now works
  "HTP" for "hypertext transfer protocol".
