# spec-writer 0.11.0: a system says what the scripts need to reach it

Date: 2026-11-11.

## Why

In the ADLC One-Builder Plan's step 3, the release-notes agent
(AgentMesh-Dev-Test/adlc-plugin-proof#2) reaches GitHub and Slack, each with
a token and an address. A spec system had a name, a reach, an address and a
why, and nowhere to say a credential or a value the host supplies; a spec
setting of kind credential was dropped by the Design. So the agent's files
declared both services with neither, and its scripts read eight variables no
file declared: it passed every check and could not have been installed.

## What changed (from 0.10.2)

- standards/spec.schema.json 1.3.0 (additive): a system may carry
  `credential` (the credential's name and the environment variable the
  scripts read it from, or "none") and `settings` (each non-secret value the
  host supplies, such as its address, by variable and purpose, never a
  value). standards-pins.json re-pins it.
- scripts/structure.mjs: the Design places a system's credential and
  settings on the draft's system, so files.mjs writes `credential` and `env`
  on the service entry and each setting by `env` and `purpose` (Common Agent
  Section 12.4, item 3).
- references/what-a-good-spec-carries.md: a system is named in plain system
  words, and says its credential and settings.
- test/structure.test.mjs: one test, a code host and a team chat with their
  tokens and an address, and a keyless public feed, through to the runtime
  requirements.

327 tests, 326 pass, 1 skipped. Written by the harness (Claude Code) directly; no model was run.
