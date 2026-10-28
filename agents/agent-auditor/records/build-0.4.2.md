# agent-auditor 0.4.2: what the conformance verdict says

Date: 2026-10-28.

## Why

stage-record-conformance passes on a verdict that is present, signed and
bound to the package digest, whatever it says, so an agent that breaks its own
declared promises passed the audit.

## What changed

- **A new check, conformance-result** (run-time, fixed by code, level warn),
  registered as `conformance-result` in `scripts/checks.mjs` and added to
  `standards/audit-checklist.md` (pin sha256:29f4d276cd44901e06b57785edebea56c924cee5c91eb828aac3d4287a7e12af). It reads the same verdict:
  - `does-not-conform` is a finding listing each failed case (its id, the
    declaration it came from, what the agent did) and each promised record not
    found;
  - `inconclusive` is a warning at most, whatever the check's level, naming
    each case not judged and each record not observed (`at_most` in the
    result; `scripts/audit.mjs` caps the level);
  - `conforms` passes; a verdict for another version, or none, is not checked.
- stage-record-conformance is unchanged.

## Tests

`node --test test/*.test.mjs`: 37 pass, one of them new.
