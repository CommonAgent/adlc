---
name: write-the-reply
description: once the record is written, to say what it is and what is still open
---

# Write the reply

Part of solution-architect. once the record is written, to say what it is and what is still open

## When to use this

once the record is written, to say what it is and what is still open

## What a good result looks like

A reply that says what the record names and where each binding came from, puts the open questions on their own lines with their keys, says whether the record is finished, and says what the job went without; and the pieces filed under the outputs they are.

## When it comes back empty

There is always a record by this step; a record with questions open is delivered and says it is not finished.

## How to do it

Nothing in this folder is run on its own; the write-the-architecture and revise-the-architecture skills name the commands that do the whole job, and this skill only explains what its command does for this step.

reply.mjs reads the record, its checks and what the job went without, and prints the reply. pieces.mjs copies the record, what is still open and what changed under out/ and writes pieces.json, and refuses to deliver a record changed after check-record.mjs wrote it.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/reply.mjs
- scripts/pieces.mjs
- scripts/architecture-record.mjs
- scripts/went-without.mjs
- scripts/no-provider.mjs
