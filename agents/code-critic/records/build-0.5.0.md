# code-critic 0.5.0: a finding holds only on what it names

Date: 2026-11-11.

## Why

The ADLC One-Builder Plan, step 5: the code critic stays as an independent
check, and it holds a build only on a finding that names the requirement,
declared fact or house rule broken. Before this, every finding the review
kept counted as open, including one that named nothing it broke, so a matter
of taste could hold a build as firmly as a broken requirement.

## What changed (from 0.4.0)

- scripts/review.mjs: each finding block carries `breaks:`, what it breaks by
  name (a requirement or constraint id of the spec, a declared fact, or a
  house rule), or none.
- scripts/check-findings.mjs: `breaksOf` reads it. A house-rule finding names
  its rule. A model finding names a spec id (one the spec has, when the spec
  came with the change) or a declaration file and member. One that names none
  is advisory: kept apart in `advisory`, never counted, never open.
- scripts/write-findings.mjs: each finding says `Breaks:`; advisory findings
  are listed under `## Advisory`, which appears only when there are some, as
  `## Warnings` does. The declared headings are unchanged.
- references/what-a-finding-is.md and README say so.

## Tests

102 pass (`node --test test/*.test.mjs`).
