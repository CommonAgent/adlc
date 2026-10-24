---
name: report-the-work
description: last, whether anything is delivered or not
---

# Report the work

Part of code-writer. last, whether anything is delivered or not

## When to use this

last, whether anything is delivered or not

## What a good result looks like

A reply that says first whether scripts are delivered and why, then the check's words as written, then the writer's account, then what the job went without; and, when the verdict says done, every script filed as a piece with a sentence on each, the account and the run record beside them.

## When it comes back empty

If the job stopped at the ceiling, at the fence or on a conflict, the reply says which and nothing is filed: no pieces list exists, so nothing downstream can mistake the folder for a delivery.

## How to do it

Nothing in this folder is run on its own; the offering names the commands, and this skill only explains what they do.

report.mjs reads records/<job>/workspace.json, runs.json, verdict.json, account.md and conflict.md and writes the reply. pieces.mjs files every script under out/, with the account and the run record, and writes pieces.json, which the adapter signs; it refuses to file anything unless the verdict says done. That signed list is what the package-maker's door checks: only a script listed in a manifest under the code-writer's key is packed.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/report.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs
