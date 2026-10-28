---
name: run-the-checks
description: Once the stage lines are written.
---

# Run the checks

Part of agent-auditor. Once the stage lines are written.

## When to use this

Once the stage lines are written.

## What a good result looks like

Every checklist entry answered pass or fail with its evidence, or not checked with the reason, and each finding at the level it has for this agent.

## When it comes back empty

An entry whose test is not registered is not checked, never skipped.

## How to do it

`runCheck` in scripts/checks.mjs for each entry of `readChecklist` (scripts/checklist.mjs), at `levelFor` its applies dates.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/checks.mjs
- scripts/checklist.mjs
- scripts/models.mjs
- scripts/formats.mjs
- scripts/package-maker.mjs
- scripts/keys.mjs
- scripts/gather.mjs

## References

- references/audit-checklist.md
- references/standing-asset-schemas.json
- references/how-each-stage-and-check-is-read.md
