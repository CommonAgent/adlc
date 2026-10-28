---
name: write-the-review
description: the last step of a review, applying the role's rules and writing the review with its structured header
---

# Write the review

Part of security-reviewer, the last step of Review a package.

## What it does

Applies the role's rules to what was read and traced (`scripts/assess.mjs`). Each of these refuses the package and is named: an access with no recorded reason, a program that reaches a system the declaration does not name, a credential no system declares, no spending limit from the owner, something that looks like a credential in the files, and two halves that name different systems. Every permission with no recorded reason is flagged. Each bound says what holds it (`scripts/platform.mjs`), and where only the package's own code does, it says so. It writes the review (`scripts/write-review.mjs`) to `<records>/<job id>/security-review.md` with `assessment.json` beside it, adds the review to `<records>/reviews.json`, and files it as the job's one piece (`scripts/pieces.mjs`).

## Scripts

- scripts/assess.mjs
- scripts/platform.mjs
- scripts/write-review.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs
