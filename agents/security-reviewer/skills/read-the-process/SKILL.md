---
name: read-the-process
description: when a review was given a process document and it has to be found among the attachments and read
---

# Read the process

Part of security-reviewer. when a review was given a process document and it has to be found among the attachments and read

## When to use this

when a review was given a process document and it has to be found among the attachments and read

## How to do it

${REVIEW} finds the process document by its content (a PROCESS: line and a phases: part), attached or in the message, and scripts/process-check.mjs reads it the way the process runner does. Nothing is judged here.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/review-process.mjs
- scripts/process-check.mjs
