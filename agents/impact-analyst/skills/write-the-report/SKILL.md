---
name: write-the-report
description: At the end of every job that had what it needs.
---

# Write the report

Part of impact-analyst. At the end of every job that had what it needs.

## When to use this

At the end of every job that had what it needs.

## What a good result looks like

out/impact-report.md: a front matter header (report, subject, running, changed, read_at, verdict, counts, dependents with each one's name, kind, owner, found_by, verdict and reason, approved), then What changed, Each dependent, The agents that read what it hands back, What is owed, What to redo and what to reuse, Cost, Not read and Your decision. The same inputs give the same bytes. pieces.json lists it as the impact report, text/markdown. The reply gives the counts, the first dependents, what was filed under which numbers, what the job went without, and declines any request to approve.

## When it comes back empty

There is always a report once the job had what it needs, even with no dependents.

## How to do it

`writeReport` in scripts/report.mjs, `plan` and `fill` in scripts/pieces.mjs, and the went-without paragraph from scripts/went-without.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/report.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs
- scripts/answer.mjs
- scripts/compare.mjs
- scripts/kinds.mjs
