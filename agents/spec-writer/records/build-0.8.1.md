# spec-writer 0.8.1: a job that runs scripts names them

Date: 2026-11-09.

## Why

The second round trip on hn-reader started Product Factory from the as-built
record (reverse engineer 0.2.0). Every draft of the spec ran
`scripts/read-top-stories.mjs` in its job's command but named no scripts, so
the build folder's lock listed nothing to write and Code refused before a pull
request opened. Asked twice in words, once with Send back to Requirements, the
model still named none, and no check here asked for them.

## What changed (from 0.8.0)

- scripts/check-spec.mjs: a job whose command runs a script under `scripts/`
  names that script in `scripts`, or the check says so while the model still
  has the draft.
- scripts/given.mjs: the given's as-built record lists its script modules
  (each function's module and each command under `scripts/`, nothing outside
  it). After the last go, a job that runs scripts and names none is given its
  command's scripts, and when it is the only such job, every module the record
  lists. The note says what was added.
- test/scripts-named.test.mjs: four tests. On the round trip's own fourth
  draft the fit names the five scripts the original agent has.

Nothing else changed. 266 tests, 265 pass, 1 skipped.

Written by the harness (Claude Code) directly; no model was run.
