# agent-auditor 0.2.0: required artifacts and checks, not our stages

Date: 2026-10-28.

## Why

Jeff's change to the lifecycle plan (TERMS.md, "require artifacts and checks,
not our stages"): the audit requires outcomes and the artifacts the lifecycle
marks required, and accepts the optional pre-package artifacts as evidence,
whoever made them.

## What changed

- **`level: info`.** A check at level info is shown in the report, under Rule
  checks, as on file or not on file. It never counts toward the verdict and is
  never filed as a debt. Levels are now info, warn and refuse.
- **Any signer counts.** A stage record is signed when a signature verifies,
  whoever made it. The line still names the stage's usual holder when that
  was the signer. A delivery manifest signed by anyone else is read as a
  stage's record when the message names it for that stage
  (`<stage>: <file name>`).
- The tests cover both: 26 tests.
