# test-writer 0.6.0: every computed expected value is worked twice, and a heading given to one case is that case's

Date: 2026-10-31.

## Why

Technical debt 646. Two of the last three proof builds on dev stopped at Code
because the suite contradicted the spec. acronym-maker (ab_6494822a9f81a1fb90)
expected "HTTP" for "hypertext transfer protocol" where the spec takes one
letter per word ("HTP"); vowel-counter (ab_fa800bf8ce54a325ee) pinned vowel
counts a hand count does not give ("Education provides curious insights."
holds 14, not 16). The model worked the values out in its head, and nothing
checked them: a suite that fails against empty stand-ins fails whatever its
literals say. The code writer stopped on a conflict both times, rightly.

Technical debt 647. The format check took every backticked heading in an
output's `about` as fixed, so vowel-counter's "When there was no sentence, ...
the only content is `## Nothing to count`" made that heading required in a
piece that had counts, which no script can satisfy beside the spec.

## Why this approach

Deterministic, and in the suite rather than in a second model pass. Each
value a rule decides is written twice: the literal the model expects, and a
computation in the test over the same input that follows the spec's rule.
Code that follows a rule is far more reliable than a count done in the head,
and a computation also catches the value remembered instead of derived
("HTTP"). Keeping the literal beside it makes two derivations that must agree;
when they do not, the model is sent back with both values to settle which the
spec means. The check runs in the run that already loads every file beside
the agent's own files, so it costs no extra model call when the values agree.
A second model reviewing each expectation would cost a call per suite and can
miscount the same way; a recompute inside check-suite cannot know the rule.

## What changed

- references/worked-values.test.mjs, the third standard file copied whole
  into every suite: `worked(value, () => computation, what)` returns the
  literal and checks it against its computation; the first call in a file adds
  one test that fails naming each value that disagrees, or a computation that
  throws (one that calls a script, for one).
- check-suite.mjs: the declaration run reads each disagreement
  (`wrong_values`), keeps it out of the unpassable list, and the verdict says
  it.
- write-suite.mjs: the instruction says to work every value a rule decides as
  a constant at the top of the file; findings for a disagreement, a suite that
  works no value (unless the notes say "No worked values:" and why), a worked
  value inside a test, and a computation that is only a literal; the file is
  added to every suite and refreshed in one being added to.
- references/delivered-formats.test.mjs (and the copy in test/): conventionOf
  reads a heading in a sentence about one case as one of `cases`;
  formatProblems holds a piece carrying a case's headings to nothing more.
  agent-auditor 0.4.3 carries the same functions.
- rules.md, the reference, README and the write-a-suite and write-the-suite
  skills say the same.

## Tests

test/worked-values.test.mjs (16) and test/case-headings.test.mjs (7), written
first and failing; test/formats.test.mjs's conventionOf assertion gains
`cases: []`. 145 tests, 144 pass, 1 skipped.

## On dev

- Packed by the package maker on the dev fleet host from adlc fa5a8af: sha256
  9e26ee6825f50bcc2f5c8f747551863fa29e1b0492ac46e24a9b5e3ba5621e44.
- Installed by the deployment manager from deploy request
  dr_MwWo-47gB44sTRb36hAWQp_2, approved by the platform account, with the
  settings 0.5.0 ran on (MODEL_PROTOCOL gemini, MODEL_NAME gemini-3.8-flash).

## Who held each step

The harness (Claude Code) stood in for the test and code steps, the tests
first and the code inside them, as for 0.4.1 and 0.5.0.
