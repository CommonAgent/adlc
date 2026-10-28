---
name: write-the-documentation
description: once what was given is read, to write the documentation from it
---

# Write the documentation

Part of doc-writer. once what was given is read, to write the documentation from it

## When to use this

once what was given is read, to write the documentation from it

## What this needs

- what was given (application/vnd.agentmesh.doc-sources+json, required)

## What a good result looks like

Every line one template from templates.mjs filled from one place in one source and ending with that place's mark, in the fixed sections, with every silence gathered under Not documented and every source listed with its digest under Sources.

## What it produces

- documentation (text/markdown, per task)

## When it comes back empty

A section with nothing in it is left out, and what it would have said is a silence under Not documented. A job with no record of it says it has no example.

## How to do it

`writeDocs({sources, leftOut, unreadable})` in scripts/write-docs.mjs. The declaration is the descriptor, or the AgentDoc's copy of its words when no descriptor was given. Never write a line by hand or edit the documentation after it is written: add a template to templates.mjs instead, so the check can hold it.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/write-docs.mjs
- scripts/given.mjs
- scripts/templates.mjs

## References

- references/how-a-line-is-traced.md
