---
name: check-the-findings
description: the fourth step, after the model has answered
---

# Check the findings

Part of code-critic. the fourth step, after the model has answered

## When to use this

the fourth step, after the model has answered

## What a good result looks like

Every finding the model gave either kept, with its place resolved to a file of the package and a line it has, or dropped with the reason; with a diff, the kept ones about lines the diff did not touch set apart as outside the change.

## When it comes back empty

When the model gave no findings, there is nothing to check and nothing is dropped.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

check-findings.mjs drops a finding that names no file of the package, names a line the file does not have, makes no claim, says no consequence, grades or praises the work, writes the fix in code, or repeats a house-rule finding or another of its own. Every dropped finding is kept in records/<job>/checked.json with why.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/check-findings.mjs
- scripts/house-rules.mjs

## References

- references/what-a-finding-is.md
