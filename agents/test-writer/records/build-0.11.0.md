# test-writer 0.11.0: one feature's tests alone

Date: 2026-11-10.

## Why

Product Factory moved a build through the lifecycle as one unit, so an
approved feature that was ready waited for the slowest. It now makes each
feature of a version in a run of its own once the spec is approved: the
feature's tests, its code and the person's OK, at the same time as the other
features, each with its own pull request (lifecycle API 0.4.10). Each run asks
this agent for that feature's tests, to be added to the tests of the features
already accepted.

0.10.0 could add to a suite, but could not be told to write one feature's
tests. The spec rules held the whole suite to every acceptance scenario of the
spec, so a run for F2, written at the same time as the run for F1, came back
with a finding for each of F1's scenarios and went to the model again to write
them. And two runs could both name their file `test/count.test.mjs`, so one
feature's tests would overwrite the other's when the two were merged.

## What changed (from 0.10.0)

- `scripts/write-suite.mjs`:
  - `featureAsked`: the feature a message names on a line of its own,
    `feature: F2`; a revision names none.
  - `specForFeature`: the spec with that feature alone among its features,
    and every interface, constraint, system and setting kept. The model is
    given it, and the spec rules hold the suite to it, so the scenarios and
    exact entries it is held to are that feature's. A feature the spec does
    not hold yet (approved after it) keeps the spec as it came, is described
    in the message, and asks for no scenario.
  - `featureInstruction`: what the model is told, under ONE FEATURE after the
    spec: that feature's tests and nothing else, each new file named
    `test/<id in lower case>-<what it checks>.test.mjs`.
  - `featureFileName`: each new file renamed so by code when the model names
    it otherwise; one named for the feature already, and the standard checks,
    keep their names. The kept-interfaces file is made from the spec's
    interfaces as before, so it is the same bytes in every feature's suite.
- README and the write-the-suite skill say the same.

## What stays

Its name, price, offerings, refusals, inputs, outputs and records. A message
that names no feature is asked exactly as 0.10.0 asked it.

## Tests

Model-free, on the made-up points-reader spec:

- `test/one-feature.test.mjs`, 5 tests: the feature read from a line of its
  own and from nothing else; the spec for one feature keeps it alone with
  every interface and constraint, and holds a suite to its scenarios and no
  other's; new files named for the feature, the standard checks not; the ONE
  FEATURE section after the spec, and none without a feature; a feature the
  spec does not hold yet is never sent back for the spec's scenarios.

The package's suite: 265 tests, 264 pass, 1 skipped (as before).

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.7.0 recorded. No live model
was run.
