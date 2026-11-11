# security-reviewer 0.3.3: the record's limits are its drivers

Date: 2026-11-11.

## Why

Architecture standard 2.0.0 turns the record's limits into drivers: the
`## Limits` heading is now `## Drivers`, and a spending limit is never a
decision. This agent read the owner's spending limit from the record's
Limits section, so with a 2.0.0 record it found none and refused the
package for want of one, though the record carried it.

## What changed (from 0.3.2)

- scripts/architecture.mjs: the limits are read under a heading that says
  drivers as well as limits, cost or spend, and the header's `cost_limit`,
  the limit in the words it was set in, is read first.
- test/parts.test.mjs: one test on a 2.0.0 record's drivers and header.

126 tests, 125 pass, 1 skipped. Written by the harness (Claude Code)
directly; no model was run.
