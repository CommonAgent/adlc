# test-writer 0.7.0: write-test-cases, a process's test cases with every approval and way back exercised

Date: 2026-11-01.

The owner approved "the ADLC builds processes" on 2026-11-01. For a process
the test writer's artifact is a suite of Agent Processes 0.9.0 test cases
(section 21), kept beside the document and pinned to its digest. This version
is that offering.

## What changed

- A third offering, `write-test-cases`, with steps `write-the-cases` (the one
  model call) and `check-the-cases` (no model). The package still names one
  command for a message (the deployment manager places one per package), so
  `scripts/job.mjs` sends a message here by its content: a process document
  (text whose first lines open with PROCESS:, attached or pasted) and no
  agent's files or spec. Its skill, write-a-suite, carries the three new
  scripts for that reason.
- `scripts/test-cases.mjs`: the prompt (the rule and what this document needs
  to keep it), the reading of the model's answer, each case written in code in
  §21's form with the document's id and digest, the check, one more go with
  what is missing and never a third, the pieces and the reply.
- `scripts/check-cases.mjs`: the coverage check, like check-suite.mjs for a
  suite. Every phase a person signs (never or supervised) answered approve,
  changes and reject across the suite; every deviation taken, by a `changes:`
  answer at the phase it leaves (its key in square brackets, else the way
  keyed `changes`, else the only way). It refuses a case for another document
  or digest, an unknown phase, item or way back, a missing required item, an
  answer in another form, and two cases with one name.
- `scripts/process-check.mjs`: standards/process-check.mjs byte for byte.
- Records: `cases.json` and `cases-checked.json`.

## Tests

`test/check-cases.test.mjs` (14) and `test/test-cases.test.mjs` (10), written
first and committed before the scripts. The package's suite: 206 tests, 205
pass, 1 skipped (as before).

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests: the test writer writes a whole suite from a
spec and takes no change to a package that already carries one, and the code
writer's check refuses a change to a few of a package's scripts unless every
script the package names is delivered (as adlc #109 recorded).

## On dev

- Packed by the package maker on the dev fleet host from adlc 73bee86:
  sha256 e0dd9ca834623b346783fc8edf559279281b7789de989d724dede774f3e82b18.
- Installed by the deployment manager from deploy request
  dr_wfceeiGg7zkisVZ1OPs6xIUF, with the settings 0.6.6 ran on.
- Proof, 2026-11-01 07:47 Mountain: the spec writer's document from its own
  proof (competitor-blog-digest, digest sha256:a048e4df...) sent as
  platform@agentmesh.ai. The job command routed it to
  write-test-cases with no harness woken. Four cases:
  draft-summary-changes-then-approve, approve-summary-changes-then-approve,
  draft-summary-reject, approve-summary-reject, each pinned to the digest.
  The coverage check, run here over the delivered files: "The suite of 4
  test cases covers the rule: 2 phases a person signs, each answered
  approve, changes and reject, and 1 way back, each taken."
