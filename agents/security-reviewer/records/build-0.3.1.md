# security-reviewer 0.3.1: a process document named as itself

Date: 2026-11-01.

Found on dev with 0.3.0: the review named an attached process document by
the name the host gives an attached file (a hop number and an id,
`0-k8oY7cpg-<name>`). The document is now named without the prefix
(review-process.mjs `plainName`, the rule code-critic's read-change.mjs uses).

## Tests

`test/process-review.test.mjs`: a hopped name reads as the document's own;
written first and committed before the script. The package's suite: 123
tests, 122 pass, 1 skipped.

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.3.0 records.

## On dev

- 0.3.0 installed on dev (dr_v0OsFj9NZgTUR2Y9qM4wiPMi) and refused the
  planted digest process for the step that posts publicly with no person's
  yes before it (line 19), flagging the gate that gives no reason under No
  reason recorded.
- 0.3.1 installed on dev (dr_H6IXZfXDr2lnDxdknuxe3EnR), package a06bf3c44ab63461....
