# agent-auditor 0.4.1: an empty can_use is a statement

Date: 2026-10-28.

## Why

When the package maker cannot run (an agent with no package on record), the
auditor reads the Descriptor itself for person-facing-declares-library. It
read `can_use: []` as "no can_use entry" and failed it. Common Agent 6.14.4
says an empty list states that the agent reads no standing asset, and the
package maker already honors that.

## What changed

- `scripts/checks.mjs`, can-use-declared's fallback for
  person-facing-declares-library: a declared empty `can_use` passes and says
  so; a Descriptor with no `can_use` member at all still fails.

## Tests

`node --test test/*.test.mjs`: 36 pass, one of them new.
