---
name: write-the-record
description: Last in every job that has what it needs.
---

# Write the record

Part of reverse-engineer. Last in every job that has what it needs.

## When to use this

Last in every job that has what it needs.

## What a good result looks like

out/as-built/record.json, tying the parts to the repository, the commit digest, whether the commit was checked, and the read mode (`read` or `read and run`), with each part's digest. Beside it: behaviors.json, architecture.json, interfaces.json, sbom.cdx.json and tests-and-gaps.json, and the schemas found and derived under schemas/. Then pieces.json, and the reply, which opens by declining any request to judge the code, write tests or change it, and says what was found, what the run gave and how many gaps are marked.

## When it comes back empty

It writes nothing when the job stopped earlier.

## How to do it

`buildRecord` in scripts/record.mjs (with `buildInterfaces` in scripts/interfaces.mjs and `checkBehaviors` in scripts/behaviors.mjs), `plan` and `fill` in scripts/pieces.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/record.mjs
- scripts/pieces.mjs
- scripts/evidence.mjs
- scripts/codebase.mjs
- scripts/behaviors.mjs
- scripts/interfaces.mjs
- scripts/kinds.mjs
- scripts/facts.mjs
- scripts/surface.mjs
- scripts/js-source.mjs
- scripts/declines.mjs
- scripts/went-without.mjs
