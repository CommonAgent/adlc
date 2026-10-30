---
name: write-the-house-rules
description: after the build folder is laid out, before it is packed
---

# Write the house rules

Part of code-writer. after the build folder is laid out, before it is packed

## When to use this

after the build folder is laid out, before it is packed

## What this needs

- the build folder laid out (document, required)

## What a good result looks like

AGENTS.md written from the template with the rules for whoever writes the scripts, CLAUDE.md with one line pointing to it, and build.lock.json holding the digest of every pinned file.

## What it produces

- the build folder with its rules (document, per task)

## When it comes back empty

If the template is missing, no archive is made and the reply says so.

## How to do it

Write AGENTS.md from references/agents-md-template.md: write only under scripts/; never change a test, the agent's files or anything pinned; a new test file under test/ is allowed but changing or removing an existing one sends the work back to the spec and test steps; models are reached only through the shared caller and its four settings MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL; no address written into a script; node 22 with no dependencies outside node; run the check with `node .adlc/check.mjs`. Write CLAUDE.md as one line pointing to AGENTS.md. Write build.lock.json with the digest of every pinned file.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/handoff.mjs

## References

- references/agents-md-template.md
