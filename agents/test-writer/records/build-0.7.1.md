# test-writer 0.7.1: test cases pinned to the process shape

Date: 2026-11-01.

Agent Processes 0.9.2 pins a test case to the digest of the document's
SHAPE (section 21.1): the SHA-256 of its text with the `bindings:` block left
out, so swapping or upgrading the agent that holds a role leaves a suite
standing. AgentMesh debt 682 brings the lifecycle to 0.9.2; this version is
the test writer's part.

## What changed

- `scripts/process-check.mjs`: standards/process-check.mjs 0.9.2, byte for
  byte (the shape digest, `shapeOf` and `shapeDigestOf`, and a deviation's
  `limit: <n>`).
- `scripts/test-cases.mjs`: every case `write-test-cases` writes is pinned to
  the document's shape digest.
- `scripts/check-cases.mjs`: the coverage check reads the shape digest, and a
  case pinned to anything else (the text's own digest included) is refused,
  saying the document's shape digest.

Nothing else in what the offering writes or refuses changed.

## Tests

`test/check-cases.test.mjs` gained one test (a case pinned to the text's own
digest is refused, and a document whose roster changed takes the same
cases), and the digest assertions of both test files and the fixture suite
moved to the shape digest; written first and committed before the scripts.
The package's suite: 207 tests, 206 pass, 1 skipped (as before).

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.7.0 recorded: the test
writer takes no change to a package that already carries a suite, and the
code writer's check refuses a change to a few of a package's scripts unless
every script the package names is delivered.
