---
name: write-the-report
description: Last, once every offering has been run and asked for a change.
---

# Write the report

Part of usability-tester. Last, once every offering has been run and asked for a change.

## When to use this

Last, once every offering has been run and asked for a change.

## What a good result looks like

The usability report with its header, the four answers for each offering, the descriptor checks, the findings labelled descriptor or agent, a person's judgment where one was given, and what was not checked; and the reply.

## When it comes back empty

A change to a report that only adds a person's judgment writes it into the earlier report, and nothing is run again.

## How to do it

`writeReport` in scripts/report.mjs, then `plan` and `fill` in scripts/pieces.mjs. A change to a report uses scripts/revision.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/report.mjs
- scripts/pieces.mjs
- scripts/revision.mjs
- scripts/read-request.mjs
- scripts/tar.mjs
- scripts/went-without.mjs
