# agent-auditor 0.3.0: waits out a 429, closes a replaced package's findings, reads descriptor.json

Date: 2026-10-28.

## Why

The fix pass (D:\scratch\lifecycle-plan\FIXPASS.md, platform part): the fleet
sweep showed gaps that made agents fail checks however well they were built.
Three of them were the auditor's own.

## What changed

- **A 429 is waited out.** Every call to the platform (the reads, the
  ledger, filing the report) that is answered 429, 502 or 503 is asked again
  (`scripts/retry.mjs`): for as long as the platform asks (Retry-After, else
  `retry_after_ms` plus half a second), else 2, 4, 8 seconds and on, at most a
  minute at a time and eight times in all. A busy minute was being read as a
  missing Descriptor or deploy queue. A read that still fails is said as
  failed. Filing a new debt is asked again after a 429 only, so a 502 that came
  after the write landed never files it twice.
- **A replaced package's findings are closed.** When the audited package is
  the one dev serves now, the auditor's still-owed debts (open or
  acknowledged) against the agent that name another package, or no package,
  are moved: resolved where this audit passes the check, dropped as superseded
  where it still fails (the evidence names the debt it is owed as on the new
  package), dropped as superseded where this audit holds no finding for it.
  Debts for this digest, debts it did not file, and debts owed to someone
  else are never touched. The reply and `records/<job>/filed.json` say what
  was closed.
- **descriptor.json.** The package's draft Descriptor is the file
  `plugin.json` points at, else `agent-descriptor.json`, else
  `descriptor.json`, the way the deployment manager and the conformance
  checker read it. Nineteen dev agents failed descriptor-matches-package only
  because their package was built before Common Agent 0.30.0-draft renamed the
  file. `shape`, which the deployment manager's binding takes out of every
  draft, is set aside in that comparison.
- **Deployment records signed after the fact.** A deployment record for act
  `reconfigure` or `attest` counts, and so does one of a request's
  `later_records` (records the deployment manager files after the request's
  result: a backfilled attest record).
- **The conformance line** says the verdict, or whether the agent conforms
  when the record names no verdict, with its case counts.
- The tests cover each: 33 tests in the auditor.
