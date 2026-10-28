---
name: check-every-line
description: after the documentation is written and before anything is delivered
---

# Check every line

Part of doc-writer. after the documentation is written and before anything is delivered

## When to use this

after the documentation is written and before anything is delivered

## What this needs

- documentation (text/markdown, required)
- what was given (application/vnd.agentmesh.doc-sources+json, required)

## What a good result looks like

A trace with one entry per line that says something, naming its source, its place and the template that gives it, and no findings: every job documented, every input and output listed, every refusal shown, every verdict and every not-stated item carried, and every job with an example or a line saying it has none.

## What it produces

- trace (application/vnd.agentmesh.doc-trace+json, per task, working)

## When it comes back empty

Any finding stops the delivery. The draft and the findings are kept in the job's records, and nothing is changed to make the documentation pass.

## How to do it

`checkDocs({markdown, sources, leftOut, unreadable})` in scripts/check-docs.mjs. It reads the documentation as text and re-derives each line from the place its mark names; it does not take the writer's word for any of it.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/check-docs.mjs
- scripts/write-docs.mjs
- scripts/given.mjs
- scripts/templates.mjs

## References

- references/how-a-line-is-traced.md
