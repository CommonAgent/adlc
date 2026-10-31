# spec-writer 0.6.1: job_seconds is always one the package maker takes

Date: 2026-10-31.

## Why

Technical debt 648. In Build an agent on dev, build ab_33e1e3fe53252ceed3
(vowel-gauge), the model drafted `"job_seconds": 30` for a small script job.
check-spec named it, the second go kept it, and the draft stood with the
finding. The finding never reached the person: the reply carries the
builder's problems, and the builder is not in this agent's container. Test
and Code finished, and Package refused it: "job_seconds is the longest one
job may take, a whole number of seconds from 60 to 7200; bad: 30". It had
happened once before, to the ping-pong smoke test on 2026-10-03.

## What changed

- The range is the package maker's, named once: build.py now holds
  `JOB_SECONDS_MIN = 60` and `JOB_SECONDS_MAX = 7200`, and both of its checks
  read them (no literal range is left there; its behaviour and words are
  unchanged). scripts/job-seconds.mjs carries the same two numbers, and
  test/job-seconds.test.mjs reads them out of build.py, so they cannot drift
  apart unseen.
- draft.mjs sets a drafted job_seconds outside the range to the nearest bound
  (a fraction rounded, a value that is not a number taken out so the package
  maker's default holds) on every go, before the check, and the note goes into
  the reply. It is the cap on one job, a host fact and not one of the person's
  questions, so it is set rather than asked for, and said.
- check-spec's finding is the package maker's own words, and says the value
  is set in agent-runtime-requirements.json.
- builds.mjs, where the builder is not on the host, refuses a spec that still
  carries an out-of-range job_seconds, in those words, and keeps no files. This
  is the check before Package for a spec from anywhere: it stops before the
  person approves the spec, with words they can act on.
- plugin.json and the SKILL.md files of write-a-spec, draft-the-spec and
  check-it-builds list scripts/job-seconds.mjs; rules.md says the same.

## Tests

test/job-seconds.test.mjs, 6 tests, written first and failing. 202 tests, 201
pass, 1 skipped.

## Who held each step

The harness (Claude Code) stood in for the test and code steps, the tests
first.

## On dev

- Packed by the package maker on the dev fleet host from adlc 9fb4b00: sha256
  0ddfe4283d19dfb17952e10da9e1c73c2091fd2d455fe9ace443b3db420a5360.
- Installed by the deployment manager from deploy request
  dr_2PhbXDIkEYQLEydyfU4yAW90, approved by the platform account, with the
  settings 0.6.0 ran on (MODEL_PROTOCOL gemini, MODEL_NAME gemini-3.8-flash).
- Proof: build ab_481ac696b24d8cf8fd (vowel-scale 0.1.0) came through Requirements
  with job_seconds 60 in agent-runtime-requirements.json. It stopped at Code on
  a test-writer defect (a count pinned as a bare number), fixed in test-writer
  0.6.3, so Package was not reached in this build.
- The package maker installed on the fleet host is unchanged: build.py's change
  names its range and keeps its behaviour and words.
- Proof: build ab_5854e151f6000365ac (vowel-ledger 0.1.0) carried job_seconds
  60, Package took it, and Conformance said conforms. Debt 648 resolved on it.
