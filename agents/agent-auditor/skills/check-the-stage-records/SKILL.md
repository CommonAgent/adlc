---
name: check-the-stage-records
description: Once the agent and its records are read, before the checklist runs.
---

# Check the stage records

Part of agent-auditor. Once the agent and its records are read, before the checklist runs.

## When to use this

Once the agent and its records are read, before the checklist runs.

## What a good result looks like

One line per stage, in the lifecycle's order: present, signed (by whoever made it) and bound to the package digest, or missing, unsigned or stale, with where it was found and why.

## When it comes back empty

A stage with no record is a line that says missing and where it was looked for.

## How to do it

`stageLines` in scripts/stages.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/stages.mjs
- scripts/keys.mjs

## References

- references/stage-holders.json
- references/how-each-stage-and-check-is-read.md
