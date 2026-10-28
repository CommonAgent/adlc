---
name: write-the-review
description: last, on every review: to apply the role's rules and write the statement or the refusal
---

# Write the review

Part of security-reviewer. last, on every review: to apply the role's rules and write the statement or the refusal

## When to use this

last, on every review: to apply the role's rules and write the statement or the refusal

## What a good result looks like

The security review with its structured header: each reach, spend ceiling and never-do with its reason, each permission with no recorded reason flagged, the verdict, and what stopped the package when it was refused.

## When it comes back empty

A package that asks for nothing still gets a review, which says it reaches nothing and lists what it must never do.

## How to do it

Apply the role's rules to what was read and traced with scripts/assess.mjs. Each of these refuses the package and is named: an access with no recorded reason, a program that reaches a system the declaration does not name, a credential no system declares, no spending limit from the owner, something that looks like a credential in the files, and two halves that name different systems. Flag every permission with no recorded reason. Say what holds each bound (scripts/platform.mjs), and where only the package's own code does, say so. Write the review with scripts/write-review.mjs to <records>/<job id>/security-review.md with assessment.json beside it, add it to <records>/reviews.json, and file it as the job's one piece with scripts/pieces.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/assess.mjs
- scripts/platform.mjs
- scripts/write-review.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs

## References

- references/what-a-review-holds.md
- references/what-the-platform-holds-it-to.md
