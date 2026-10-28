---
name: hand-it-over
description: once the check has passed
---

# Hand it over

Part of doc-writer. once the check has passed

## When to use this

once the check has passed

## What this needs

- documentation (text/markdown, required)
- trace (application/vnd.agentmesh.doc-trace+json, required)

## What a good result looks like

The documentation and its trace in the job's out/ folder with pieces.json listing both by the step that made them, and a reply that says first what the job went without, then what was documented from how many sources, how many lines were traced and how many silences are listed.

## What it produces

- documentation (text/markdown, per task)
- trace (application/vnd.agentmesh.doc-trace+json, per task, working)

## When it comes back empty

Nothing is handed over when either file is missing; the reply says which.

## How to do it

`fill(jobDir, plan({docPath, tracePath}))` in scripts/pieces.mjs, then the reply, with `sentence(read(records))` from scripts/went-without.mjs at its head.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/pieces.mjs
- scripts/went-without.mjs
