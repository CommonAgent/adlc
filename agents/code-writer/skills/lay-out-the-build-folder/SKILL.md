---
name: lay-out-the-build-folder
description: first, on every hand-off
---

# Lay out the build folder

Part of code-writer. first, on every hand-off

## When to use this

first, on every hand-off

## What this needs

- the agent's files (document, required)
- the suite (document, required)
- the released package, as the prototype (document, optional)

## What a good result looks like

A folder holding the agent's files as they came, the suite under test/ byte for byte, every named script seeded from the released package or stubbed, every other released-package file at its own path read-only, and .adlc/ with the check and the scripts it needs.

## What it produces

- the build folder laid out (document, per task)

## When it comes back empty

If the agent's files or the suite did not arrive, nothing is laid out and the job stops saying which.

## How to do it

Read and write every file as bytes. Seed each script the spec names from the prototype when it carries one at that path, otherwise stub what the suite imports. Place every other prototype file outside scripts/ at its own path, read-only. Copy the check and the scripts it needs into .adlc/.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/handoff.mjs
- scripts/workspace.mjs
- scripts/agent-folder.mjs
- scripts/check.mjs
- scripts/archive.mjs
