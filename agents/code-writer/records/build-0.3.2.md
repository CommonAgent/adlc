# code-writer 0.3.2: the declarations in their canonical form

Date: 2026-10-30.

No change in behaviour. spec-writer's round-trip test (every agent folder read and written again comes back byte for byte) failed in CI on 0.3.1: the hand-off `run`'s members, edited by hand from spec-writer's three edits, were not in the order the writer emits (command, reply, escalate_when, per_file, message_file), and write-the-scripts' SKILL.md said "required unless the build folder came" where the generated "What this needs" line says "optional". Both are now in the writer's form. Because the package's bytes changed, this is a new version, so what runs on dev is the source byte for byte.

All fourteen lifecycle suites pass; code-writer 85 of 86 (1 skipped); the address check finds nothing new.

## Who held the step

The harness (Claude Code), reordering only.
