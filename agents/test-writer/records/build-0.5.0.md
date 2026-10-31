# test-writer 0.5.0: every suite holds each job to its own records

Date: 2026-10-31.

## Why

Technical debt 639. The conformance checker, fixed in #96, found word-reverser, palindrome-judge and tally-words 0.1.0 (built on dev) passing every refusal and still not conforming for one defect: each wrote its went-without record straight into the records folder, so each job overwrote the last, while the descriptor promises one per job at `*/went-without.json`. The host hands every job of an agent one records folder, the agent's own (`{records}`, `/mesh/state/<agent>/records` for a container agent), and a declared `file` pattern is read relative to it (Common Agent 12.4, records[].file; the checker's audit_records globs it there). Their suites handed each job a folder of its own as the records folder (`records: join(at, "records", "job1")`, copied from the worked example, publisher's suite), so a script that wrote straight into what it was handed passed, and no test ran two jobs.

## What changed

- references/records-per-job.test.mjs: the standard records check, copied whole into every suite beside the format check. `checkRecordsPerJob(records, jobDirs, { except })` reads the package's declaration, takes each record whose `file` starts with `*/` and is not standing, and names one written straight into the records folder and each job that left none under a folder named after its job folder.
- write-suite.mjs adds it to every suite (refreshed in a suite being added to); tells the model the records folder is the agent's own, to hand every job the same one, to run two jobs and call the check, and not to copy the worked example's records/job1; and sends back, once, a suite for a declaration with a per-job record whose tests never call it (over the whole suite when it is written in parts).
- rules.md, references/what-a-good-suite-carries.md, README and the write-a-suite and write-the-suite skills say the same.

## Tests

test/records-per-job.test.mjs, 16 tests, written first and failing; 121 of 122 pass, 1 skipped. The check bites: against a script that writes the record straight into the records folder the suite fails, and against one that writes under `join(records, basename(job))` it passes.

## On dev

- Packed by the package maker on the dev fleet host from adlc 5362251: sha256 2755bb9a26d3503ca0d24b3d14918ed6b3b1198d9d0b9db06fea3aec28cd6407.
- Installed by the deployment manager from deploy request dr_ZtJR7jWDNrZ5MoLuEh-4mVTR, approved by the platform account, with the settings 0.4.1 ran on (MODEL_PROTOCOL gemini, MODEL_NAME gemini-3.8-flash). No security review was run for this version: the change is a reference test file and words.
- Proof: Build an agent on dev, build ab_fa800bf8ce54a325ee (vowel-counter 0.1.0, platform@agentmesh.ai, reference code writer). The spec declared `*/went-without.json` per task. The suite came back as test/count-vowels.test.mjs, test/delivered-formats.test.mjs and test/records-per-job.test.mjs; it hands every job one records folder, reads the record at `join(records, basename(job))`, and runs "two jobs sharing the records directory each keep their own went-without record", ending in `checkRecordsPerJob(dirs.records, [dirs.job1, dirs.job2])`.

## Who held each step

The harness (Claude Code) stood in for the spec, test and code steps, as for 0.4.1: the tests first, then the code inside them, held to the builder and the address check.
