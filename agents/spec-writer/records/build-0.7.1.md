# spec-writer 0.7.1: a supervised step is signed by a person

Date: 2026-11-01.

The proof of 0.7.0 on dev ("each morning, read three competitor blogs and
send me a one-page summary for approval before it goes to the team") came
back conforming and clean, with one step, draft-summary, at supervised and
held by the agent summary-writer. The roster then read "summary-writer signs
draft-summary" and the signs question named the agent, which is wrong: at
supervised an agent does the work and a person approves it (§7.3).

Now the signer of a supervised step an agent holds is drafted as whoever
starts the run, the roster says "whoever starts the run approves what
draft-summary hands on", and the signs question names that person.

test/process-draft.test.mjs gains one test, committed before the fix. 238
tests, 237 pass, 1 skipped. The harness (Claude Code) stood in for the test
and code steps, as for 0.7.0.

## On dev

- Packed by the package maker on the dev fleet host from adlc 160223b:
  sha256 7c6d9f9889ae9fe1296e33dfdb39e79f3cbdba2316fc3d0e41edc91ce6b683c1.
- Installed by the deployment manager from deploy request
  dr_YBOw_NjnrCAFqaoiC6xShr10, with the same settings.
