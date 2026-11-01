# spec-writer 0.7.2: the process check is Agent Processes 0.9.2's

Date: 2026-11-01.

AgentMesh debt 682 brings the lifecycle to Agent Processes 0.9.2. The
spec writer checks every process document it writes before it goes, with the
checker it carries.

## What changed

- `scripts/process-check.mjs`: standards/process-check.mjs 0.9.2, byte for
  byte. The digest it reports is the document's shape digest (section 21.1:
  the text with the `bindings:` block left out), the one a test case is
  pinned to, and a deviation may end with `limit: <n>` (section 6.7.1).
- `scripts/process.mjs`: the reply's check line names the version the checker
  holds the document to, from the checker itself, so it says 0.9.2.

What `write-a-process` writes, asks and refuses is unchanged.

## Tests

`test/process-job.test.mjs`: the reply's check line names 0.9.2; written
first and committed before the scripts, with the byte-for-byte test of the
checker already there. The package's suite: 238 tests, 237 pass, 1 skipped.

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.7.0 recorded: the test
writer takes no change to a package that already carries a suite, and the
code writer's check refuses a change to a few of a package's scripts unless
every script the package names is delivered.
