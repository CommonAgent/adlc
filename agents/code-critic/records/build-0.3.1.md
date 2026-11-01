# code-critic 0.3.1: a process document named as itself

Date: 2026-11-01.

Found on dev with 0.3.0: a process document attached to a message reached
the job under the name the host gives an attached file (a hop number and an
id, `0-A23KdF0A-<name>`), and each finding's Place named that. The document is
now named without the prefix, by read-change.mjs's own `plainName`.

## Tests

`test/process-review.test.mjs`: a hopped name reads as the document's own;
written first and committed before the script. The package's suite: 91
tests, 90 pass, 1 skipped.

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.3.0 records.

## On dev

- 0.3.0 installed on dev (dr_Mcn-mLWPpjxpHYOJLYIkDts4) and reviewed the
  planted digest process: 2 findings, the step that posts publicly with no
  person's yes before it (line 19) and the gate that gives no reason (line 15).
