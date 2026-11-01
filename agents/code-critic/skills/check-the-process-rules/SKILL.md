---
name: check-the-process-rules
description: when a process document has been read and has to be held to the process rules
---

# Check the process rules

Part of code-critic. when a process document has been read and has to be held to the process rules

## When to use this

when a process document has been read and has to be held to the process rules

## How to do it

scripts/process-rules.mjs holds the document to the four tests of section 20.1, the approval levels of section 7, the acts in the world of section 21.3 and the extensions rule of section 20.3, and conformance; scripts/process-review.mjs writes each finding at its line in this agent's own format.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/process-review.mjs
- scripts/process-rules.mjs
- scripts/process-check.mjs
