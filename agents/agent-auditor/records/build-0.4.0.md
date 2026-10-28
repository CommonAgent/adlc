# agent-auditor 0.4.0: the Usability stage and the App walk

Date: 2026-10-28.

## Why

The owner added a Usability stage to the lifecycle, in the Prove phase after
Conformance, with a reference agent for it (agents/usability-tester) and our
App walk as an add-on. The audit checklist gains two checks, and the auditor
registers both: `usable-in-app` (run-time, refuse), fed by the App walk, and
`usability-report` (stage-record, info), which checks that a usability report
exists for the audited package digest. An organization may raise the second
in its own checklist.

## What changed

- `standards/audit-checklist.md` has the two checks; `standards-pins.json`
  pins its new digest, and the checklist reads as 29 checks.
- A new stage line, Usability, between Conformance and Docs. It reads an
  attached usability report (front matter `usability_report: v1`) and the
  delivery manifest it came under: present when the report names the audited
  package digest and a verified manifest that is not the tested agent's own
  lists the report's bytes. Any tester counts; the usability tester is named
  as the stage's usual holder in `references/stage-holders.json`. Such a
  manifest is never reported as a stray.
- A new registered check, `app-walk`: the App walk's attached record for the
  agent (`app_walk: v1`), bound to this package or the audited version.
  `ready` passes, `rough` and `broken` fail, and a record for another version,
  or none, is reported as not checked.
- The Descriptor lists the two new kinds of attachment.

## Tests

35 pass: a usability report bound and signed, stale, signed only by the
tested agent and signed by a stranger; the App walk ready, broken (refusing a
new agent) and for another version; and an agent that came through every
stage now passes the Usability line and `usable-in-app` too.

## Who held each step

The harness (Claude Code) wrote the change and the tests on the owner's
instruction of 2026-10-28.
