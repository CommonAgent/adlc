# code-writer 0.3.6: the local check takes the revised tests' new lock

Date: 2026-10-31.

Technical debt 636, found in its own proof. When a build goes back to Test,
the revised tests come back to the hand-off branch as one commit that also
moves build.lock.json to their digests. A coding agent that had run
`node .adlc/check.mjs` before then held a record of the old lock under
records/, and the check compared the clone against that record, so it called
the revised tests changed. In acronym-maker's round on dev
(ab_6494822a9f81a1fb90, AgentMesh-Dev-Test/handoff-proof#6) Claude Code, the
customer's coding agent, had to move the record aside by hand before the
check would run the suite.

- scripts/check.mjs: recordFromLock builds the record from a build folder's
  lock (what the main block did inline), and recordIsStale says when a record
  taken from a lock is of a lock other than the one on disk. The check then
  takes the new lock as its baseline. A record laid out by workspace.mjs is
  left alone, and a pinned file the coding agent changes still breaks the
  fence. The fence that counts is the gate's, which moves its own digests when
  it writes the revised tests.

## Tests

test/check-revised-lock.test.mjs, 2 tests, written first and failing (its
fixture was corrected once, in a test-step commit, to pin .adlc/ as every
hand-off's lock does). 108 tests, 107 pass, 1 skipped.

## Who held the step

The harness (Claude Code), tests first, then the script.
