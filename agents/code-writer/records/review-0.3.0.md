# Review of code-writer 0.3.0

- package: code-writer 0.3.0
- change: the diff change.diff (4 files), with the declarations as part of it
- findings: 6
- open: 6
- reviewed_by: code-critic 0.2.0
- reviewed_at: 2026-10-30T18:08:31.394Z

## Findings

### F1. `lockProblems` only checks that every file declared in `build.lock.json` is present and matches its digest, but never checks whether the archive entries contain

- Place: `scripts/workspace.mjs:427`
- Rule: general (general code quality)
- Claim: `lockProblems` only checks that every file declared in `build.lock.json` is present and matches its digest, but never checks whether the archive entries contain unexpected or added files outside `scripts/`.
- Consequence: A returned build folder archive can introduce arbitrary untracked files outside `scripts/` (such as root configuration or auxiliary modules); because `workspace.mjs` unpacks them and snapshots the resulting folder into `record.listing`, the added files permanently bypass both the archive lock check and the subsequent fence check.
- Found by: the review
- Answer: Changed (round two, by code-writer): lockProblems in scripts/workspace.mjs refuses any file in a build folder archive that is outside scripts/ and that build.lock.json does not pin, naming each, before anything is unpacked.

### F2. When run inside a build folder without an existing workspace record, `check.mjs` initializes `record.listing` by taking a live snapshot of `WORKSPACE` rather th

- Place: `scripts/check.mjs:219`
- Rule: general (general code quality)
- Claim: When run inside a build folder without an existing workspace record, `check.mjs` initializes `record.listing` by taking a live snapshot of `WORKSPACE` rather than using the pinned file list from `build.lock.json`.
- Consequence: Any file added, removed, or modified outside `scripts/` before `node .adlc/check.mjs` is run for the first time is incorporated into `was`, blinding `fenceOf` to unauthorized file additions made prior to running the check.
- Found by: the review
- Answer: Changed (round two, by code-writer): check.mjs in a build folder with no workspace record takes its baseline from build.lock.json's pinned files, so a file added outside scripts/ before the first run is reported as added.

### F3. `newTest` matches any path beginning with `test/` that was not in `was`, without verifying that the file is an actual test file ending in `.test.mjs`.

- Place: `scripts/check.mjs:105`
- Rule: general (general code quality)
- Claim: `newTest` matches any path beginning with `test/` that was not in `was`, without verifying that the file is an actual test file ending in `.test.mjs`.
- Consequence: A writer can add arbitrary non-test files under `test/` (such as helper modules, configuration files, or data fixtures) without triggering fence violations, allowing them to introduce or replace helper dependencies that the test suite imports.
- Found by: the review
- Answer: Kept as it is, by the owner's decision of 2026-10-30: the writer may add files under test/, and a new test may need its own helper or fixture. A new file cannot change, replace or remove a pinned test, helper or fixture (each is held to its digest), so it can only add tests the pinned ones do not depend on.

### F4. `fenceOf` allows any path satisfying `newTest(p)` to bypass change checks on every round because `check.mjs` never updates `record.listing` across runs.

- Place: `scripts/check.mjs:111`
- Rule: general (general code quality)
- Claim: `fenceOf` allows any path satisfying `newTest(p)` to bypass change checks on every round because `check.mjs` never updates `record.listing` across runs.
- Consequence: Once a new file is added under `test/`, it satisfies `!(p in was)` on every subsequent round; the writer can repeatedly modify that test file across rounds to manipulate suite results without breaking the fence.
- Found by: the review
- Answer: Kept as it is: a test file the writer added is the writer's own, so changing it from round to round touches nothing pinned. The pinned suite is the contract and must still pass as pinned; an added test can only add assertions.

### F5. `buildLock` explicitly skips `LOCK_FILE` (`build.lock.json`) when computing lockfile digests, and neither `handoff.mjs` nor `workspace.mjs` pins or validates th

- Place: `scripts/handoff.mjs:155`
- Rule: general (general code quality)
- Claim: `buildLock` explicitly skips `LOCK_FILE` (`build.lock.json`) when computing lockfile digests, and neither `handoff.mjs` nor `workspace.mjs` pins or validates the integrity of `build.lock.json` itself.
- Consequence: A tampered build archive can alter `build.lock.json` in tandem with modified agent or test files; `lockProblems` in `workspace.mjs` validates the archive against the archive's own internal lockfile, allowing modified specs or tests to be accepted without detection.
- Found by: the review
- Answer: Kept as it is, by design: the lock inside a build folder is a copy for local runs. The authority is the lock code-writer issued and keeps in its own records with the hand-off; the hand-back gate checks a returned folder against that record, never against the copy the folder carries. The write-the-scripts input comes from our own hand-off, under its signed job manifest.

### F6. `layOutBuildFolder` writes `.adlc/` helper scripts with `readOnly` set to false, leaving them writable in the build folder.

- Place: `scripts/handoff.mjs:146`
- Rule: general (general code quality)
- Claim: `layOutBuildFolder` writes `.adlc/` helper scripts with `readOnly` set to false, leaving them writable in the build folder.
- Consequence: A coding agent or user working in the build folder can modify `.adlc/check.mjs` or `.adlc/workspace.mjs` directly to disable verification or fence checks during local runs.
- Found by: the review
- Answer: Changed (round two, by code-writer): handoff.mjs writes the .adlc/ files read-only (0444), like the other pinned files.

## Answers to the earlier review

No earlier findings came with this change.

## Outside the change

- `references/a-package-that-works/test/publish.test.mjs:98` (credential-in-package): references/a-package-that-works/test/publish.test.mjs carries what looks like a credential value on line 98.
- `references/a-package-that-works/test/publish.test.mjs:101` (credential-in-package): references/a-package-that-works/test/publish.test.mjs carries what looks like a credential value on line 101.

## Not reviewed

- Read as context and not reviewed: README.md, records/build-0.2.3.md, records/build-0.2.4.md, records/build-0.2.5.md, records/build-0.2.6.md, references/a-package-that-works/agent-descriptor.json, references/a-package-that-works/agent-runtime-requirements.json, references/a-package-that-works/plugin.json, references/a-package-that-works/references/what-it-will-not-publish.md, references/a-package-that-works/scripts/files.mjs, references/a-package-that-works/scripts/inspect.mjs, references/a-package-that-works/scripts/pieces.mjs, references/a-package-that-works/scripts/place.mjs, references/a-package-that-works/scripts/publish.mjs, references/a-package-that-works/scripts/store.mjs, references/a-package-that-works/scripts/went-without.mjs, references/a-package-that-works/skills/check-what-is-served/SKILL.md, references/a-package-that-works/skills/place-the-files/SKILL.md, references/a-package-that-works/skills/publish/SKILL.md, references/a-package-that-works/skills/read-what-was-given/SKILL.md, references/a-package-that-works/test/publish.test.mjs, references/a-package-that-works/test/store.test.mjs, references/agents-md-template.md, references/what-the-house-stack-is.md.

## How to answer

Answer each finding by a change or a reason. For a reason, write it after `Answer:` in place of `open`. For a change, change the code. Then send this document back with the package, and the next review says which findings are answered and which are still open. The review is done when `open` is 0. Whether to accept a finding is yours to decide; nothing here changes the code.
