# test-writer 0.6.2: every job writes its went-without record, and the records check never leaves it out

Date: 2026-10-31.

## Why

Proof build ab_3508d5dec3d4642113 (vowel-meter 0.1.0, test-writer 0.6.1 on
dev) went through Test, Code, Package, Release and Deploy to installed. Its
suite worked 28 values twice and all held, and the reference code writer's
scripts passed it. Conformance said does-not-conform: 5 refusals passed, 0
failed, and "a promised record is missing: what the job did not have and did
anyway, per job". Every job wrote `<records>/<job>/counted.json` (seven jobs,
each in its own folder, which is debt 639's fix working), but no job wrote
`went-without.json`: every case the checker ran handed it a sentence, and the
script wrote the record only when a job lacked something.

The House Stack says a job writes its declared records whether it succeeded
or not, and the conformance check reads every per-job record after whatever
jobs it ran. The suite let the script through: the instruction told the model
to choose two jobs that go without something and to name a record "written
only in some cases" in `except`, and the model ran two ordinary jobs with
`{ except: ["*/went-without.json"] }`.

## What changed

- references/records-per-job.test.mjs: checkRecordsPerJob never leaves out
  went-without.json, whatever `except` names, and its finding says every job
  writes it, with no entries when it lacked nothing.
- write-suite.mjs: the instruction says every job writes went-without.json,
  that a test never asserts it is absent, and to run the two-job check on two
  ordinary jobs that succeed.
- rules.md and the reference say the same.

## Tests

test/went-without-every-job.test.mjs, 4 tests, written first and failing;
test/records-per-job.test.mjs's `except` assertions change to the new rule.
153 tests, 152 pass, 1 skipped.

## Who held each step

The harness (Claude Code) stood in for the test and code steps, the tests
first.

## On dev

- Packed by the package maker on the dev fleet host from adlc 13fadf2: sha256
  b73346991d7d7ec39ce255840d9ccb0b628cc14762c9d975a9e53008e887d72a.
- Installed by the deployment manager from deploy request
  dr_xkWOKRPDWwcE6oEJNW03GGNK, approved by the platform account, same settings.
- Proof: build ab_33e1e3fe53252ceed3 (vowel-gauge). 26 worked values, all
  agreeing; the suite calls checkRecordsPerJob with no except, and the
  reference code writer's script writes `{ went_without: "v1", entries: [] }`
  for a job that lacked nothing. Test and Code done; Package refused on the
  spec writer's `job_seconds: 30` (the builder takes 60 to 7200), technical
  debt 648, so Conformance was not reached.
