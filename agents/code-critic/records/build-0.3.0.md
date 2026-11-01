# code-critic 0.3.0: review-a-process, a process document held to the process rules

Date: 2026-11-01.

The owner approved "the ADLC builds processes" on 2026-11-01: a build whose
artifact is a process carries an Agent Processes document from Requirements
on, and Review holds it to the process rules. This version is the code
critic's part (lane STAGES).

## What changed

- A second offering, `review-a-process`, with steps `read-the-process` and
  `check-the-process-rules`, neither calling a model. The package still names
  one command, so `scripts/job.mjs` (review-a-change's) sends a message here
  by its content: a process document attached or pasted (a PROCESS: line and
  a phases: part). Its skill carries the new scripts for that reason.
- `scripts/process-review.mjs`: finds the document, holds it to the rules,
  and writes the findings in this agent's own format: a header, one section
  per finding with Place (the document's file and line), Rule, Claim,
  Consequence, Found by and Answer, then Signed and acting, Warnings, Answers
  to the earlier review, Outside the change, Not reviewed and How to answer.
  An earlier review sent back is answered against, as for a package.
- `scripts/process-rules.mjs` and `scripts/process-check.mjs`:
  standards/process-rules.mjs and standards/process-check.mjs (0.9.2), byte
  for byte. The rules: the four tests of section 20.1 where a program can
  see them, which phases a person signs and whether the document says why
  (section 7), which phases act in the world and whether a person signs
  before each (section 21.3), no line outside the extensions block (section
  20.3), and conformance.

Reviewing a package is unchanged.

## Tests

`test/process-review.test.mjs` (6), written first and committed before the
scripts, and the agent-files test letting review-a-process call no model.
The package's suite: 91 tests, 90 pass, 1 skipped.

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests: the test writer takes no change to a package
that already carries a suite, and the code writer's check refuses a change
to a few of a package's scripts unless every script the package names is
delivered (as adlc #109 recorded).
