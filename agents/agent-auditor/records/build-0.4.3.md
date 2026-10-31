# agent-auditor 0.4.3: a heading given to one case is that case's shape

Date: 2026-10-31.

## Why

Technical debt 647. The auditor carries the test writer's delivered-formats
rule, function for function. That rule took every backticked heading in an
output's `about` as fixed, so vowel-counter 0.1.0's "When there was no
sentence, the header is absent and the only content is `## Nothing to count`"
made `## Nothing to count` required in a piece that had counts, which no
script can satisfy beside the spec.

## What changed

- scripts/formats.mjs: conventionOf and formatProblems copied again from
  test-writer 0.6.0's references/delivered-formats.test.mjs. A heading in a
  sentence about one case is that case's (`cases`); a piece carrying every
  heading of a case is held to nothing more, and any other piece to the main
  shape's headings and header.

## Tests

`node --test test/*.test.mjs`: 37 pass. "the delivered-formats copy is the
test writer's, function for function" holds the copy to the new rule.

## On dev

Not installed: the auditor is not a stage of Build an agent, and nothing in
this change is needed for a build to reach Conformance. It goes out with the
next auditor install.

## Who held each step

The harness (Claude Code) made the copy, as the copy is the test writer's
function and the auditor's test checks it against that file.
