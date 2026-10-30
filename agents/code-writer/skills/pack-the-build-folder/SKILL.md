---
name: pack-the-build-folder
description: last, once the house rules are written
---

# Pack the build folder

Part of code-writer. last, once the house rules are written

## When to use this

last, once the house rules are written

## What this needs

- the build folder with its rules (document, required)

## What a good result looks like

One gzip tar archive of the whole build folder, written in node alone, that unpacks to exactly what was laid out, each file with the bytes it was given.

## What it produces

- the build folder (application/gzip, per task)

## When it comes back empty

If anything failed before this step, no archive is made and nothing is filed.

## How to do it

Pack the folder with archive.mjs, with no tar binary, and file the archive as the piece.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/archive.mjs
- scripts/handoff.mjs
