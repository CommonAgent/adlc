# test-writer 0.4.1: a test that touches no script must already pass

Date: 2026-10-30.

## Why

Technical debt 618, and 600 before it. The spec writer delivers the agent's own files in the Common Agent form, and the test writer kept writing a declaration test from the older spec shape it is shown: `desc.name === "word-tally"` and `offering.offered === true`. The Agent Descriptor carries neither. Its core members are format, agent_version, subject, does, offerings[] (id, name, does), interaction and refusals (docs/agent-descriptor-v1.md, "The members"). A descriptor `name` is an optional display name for a person, "carried as authored ... none is derived" (Common Agent 6.13.1, proposed, as the builder's person_members reads it), and the package name is plugin.json's `name`. No script can make such a test pass, so every build stopped at the code step. The spec writer is right to write no name it was not given, and was not changed.

## What changed

- The writer is given the agent's own files whole (agent-descriptor.json, plugin.json, agent-runtime-requirements.json) after the spec, with the word that the spec is a reading of them and not their shape: the name is plugin.json's, the descriptor has no `offered`, `slug` or `jobs`, and an offering is found by its `id`.
- check-suite.mjs runs the suite a second time against nothing: beside the agent's own files, with every script stood in by a module that exports the names the suite imports and does nothing, so every file loads. Each test that fails there and touches no script is named in the verdict, and write-suite.mjs sends it back to the writer once as a finding, with the failure quoted. Touching is read leniently, so a test is never wrongly refused for reaching a script by a route the reading cannot see.
- rules.md, references/what-a-good-suite-carries.md and the write-the-suite and check-the-suite skills say the same.

## Tests

107 of 108 pass, 1 skipped. Added: test/declaration-tests.test.mjs, 9 tests.

## Proof

- On the dev run's suite for word-tally (the spec writer's files and the test writer's suite), the check names exactly one test, the declaration test asserting `name` and `offered`.
- Run over the suites of the fourteen lifecycle agents that have them, it names none.

## Who held each step

The harness (Claude Code) stood in for the spec, test and code steps, held to the builder, the address check and the suite. Not installed on dev or prod.
