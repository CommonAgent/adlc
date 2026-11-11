# spec-writer 0.12.0: one Requirements check, shared with the ADLC plugin

Date: 2026-11-11.

## Why

On the Product Factory cloud machine (ADLC One-Builder Plan, step 6) this
agent called the Hacker News digest's spec ready, the person approved it, and
the build folder's own Requirements check held it: no empty case and no
failure case. The two had different rules. The person sent it back with words
saying what to add, and the revision returned the spec byte for byte, because
the words named no id in it.

## What changed (from 0.11.0)

- scripts/spec-check.mjs: `coverageProblems` (every feature requirement is
  checked by a scenario; a refusal, the empty case and the failure case are
  each stated), part of `specProblems`. The plugin's kit runs it from here and
  keeps no copy.
- scripts/spec.mjs: a revision whose spec still leaves one of those unsaid
  opens the features to the model, with the person's words as what to add;
  an added requirement the model repeats on its second go is added once.
- Tests: the as-built fixture's fill states the empty case, as the model is
  now asked to; the pieces fixture states its refusal, empty and failure
  cases; one new revision test (words that name nothing still add the empty
  case).

328 tests, 327 pass, 1 skipped. Written by the harness (Claude Code) directly; no model was run.
