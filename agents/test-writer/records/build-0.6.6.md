# test-writer 0.6.6: a revision the process runner sends, changed in place

Date: 2026-11-01.

AgentMesh technical debt 665. Under the process runner (new-agent v3), Send
back to Test is the deviation wrong-test, and the test writer's work message
opens "run <id> phase write-the-suite: here is work" and ends with "why this
phase runs again: deviation [wrong-test]: <the code step's words and the
person's>", with the suite it delivered before attached (process-runner
0.30.0). 0.6.5 read a revision only from a first line "Revise the suite", so
on dev (build ab_f1dd30a94724129ad5, run r-20261101-991b) it took the message
as an ordinary ask, wrote a new test/reply.test.mjs and left the test the
conflict named, test/count-words.test.mjs, as it was.

What changed:

- job.mjs: `isRevision` also takes the runner's line, at the start of a line.
  `revisionAsked` gives "Revise the suite." and the line's words to the end of
  the message, and runJob passes that, written beside the work folder, as
  ASKED_TEXT. The work message's own lines list the inputs by name and would
  otherwise name every file of the suite.
- write-suite.mjs: in a revision, a file answered under a new name is a
  finding ("is a new file, and a revision changes only the files it was sent
  back for, in place"), so the model is asked once more. `revisionDelivery`
  keeps only the named files and the standard checks; anything else is dropped
  and named in the findings, and an answer that changed no named file is
  refused in words.
- rules.md and skills/write-a-suite/SKILL.md say both.

Tests: test/runner-revision.test.mjs, 7, written first (the test step's commit
before the code step's). The package's suite: 182, 181 pass, 1 skipped.

Who did what: the harness (Claude Code) stood in for the test step and the
code step, inside this package's own tests. test-writer.platform writes a
whole suite from a spec and takes no change to its own package, and
code-writer.platform's check refuses a change to a few of a package's scripts
(AgentMesh docs/sdlc-agent-findings.md, 2026-10-31). Packaging, the deploy
request and the install go through the agent builder, the platform account's
deploy queue on dev and the deployment manager.
