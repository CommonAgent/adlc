# security-reviewer 0.3.0: review-a-process, a process document held to the process rules

Date: 2026-11-01.

The owner approved "the ADLC builds processes" on 2026-11-01: a build whose
artifact is a process carries an Agent Processes document from Requirements
on, and Security holds it to the process rules before it is wired, tested or
installed. This version is the security reviewer's part (lane STAGES).

## What changed

- A second offering, `review-a-process`, with steps `read-the-process` and
  `check-the-process-rules`, neither calling a model. The package still names
  one command, so `scripts/review-package.mjs` (review-a-package's) sends a
  message here by its content: a process document attached or pasted (a
  PROCESS: line and a phases: part). Its skill carries the new scripts.
- `scripts/review-process.mjs`: the assessment and the review in this
  agent's own format, security-review-v1: the same front matter (the process
  as the package, its shape digest, the verdict, reaches from its systems:
  line, spends from the steps that pay, never-dos from its policy, no reason
  recorded, refused for) and the same headings. It refuses a process in which
  a step sends to somebody outside, posts, publishes, pays or signs with no
  person's yes before it (sections 21.3 and 7.1), and one whose extension
  lines change the work (sections 20.1 and 20.3). A gate whose document gives
  no reason is flagged under No reason recorded and refuses nothing.
- `scripts/process-rules.mjs` and `scripts/process-check.mjs`:
  standards/process-rules.mjs and standards/process-check.mjs (0.9.2), byte
  for byte.

Reviewing a package is unchanged.

## Tests

`test/process-review.test.mjs` (6), written first and committed before the
scripts. The package's suite: 123 tests, 122 pass, 1 skipped.

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests: the test writer takes no change to a package
that already carries a suite, and the code writer's check refuses a change
to a few of a package's scripts unless every script the package names is
delivered (as adlc #109 recorded).
