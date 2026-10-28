---
name: run-the-examples
description: Once the Descriptor is checked, for each offering.
---

# Run the examples

Part of usability-tester. Once the Descriptor is checked, for each offering.

## When to use this

Once the Descriptor is checked, for each offering.

## What a good result looks like

The form filled from the example as a page fills it, the run sent through the page's own call, the job followed to its result, and each piece that came back read against its declared kind and presentation.

## When it comes back empty

An offering with no example is not run. A form that cannot be filled is not sent. A run that delivers nothing within the wait is reported as delivering nothing.

## How to do it

`fillForm` in scripts/form.mjs, then `runOffering` in scripts/trial.mjs, which judges each piece with scripts/readable.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/form.mjs
- scripts/trial.mjs
- scripts/readable.mjs
- scripts/platform.mjs
- scripts/retry.mjs
- scripts/descriptor-checks.mjs

## References

- references/what-a-person-meets.md
