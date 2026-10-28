---
name: check-the-descriptor
description: Once the Descriptor is read, before any offering is run.
---

# Check the Descriptor

Part of usability-tester. Once the Descriptor is read, before any offering is run.

## When to use this

Once the Descriptor is read, before any offering is run.

## What a good result looks like

Each of the five checks (summary, example, inputs-to-controls, options-settings, presentation) answered pass or fail with its evidence, and each finding labelled descriptor, with design as the stage that fixes it.

## When it comes back empty

An agent no person starts has nothing to check beyond its summary, and the report says so.

## How to do it

`descriptorChecks` in scripts/descriptor-checks.mjs. Read references/what-a-person-meets.md.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/descriptor-checks.mjs

## References

- references/what-a-person-meets.md
