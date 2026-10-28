---
name: read-what-was-given
description: first, on every documentation job
---

# Read what was given

Part of doc-writer. first, on every documentation job

## When to use this

first, on every documentation job

## What this needs

- agent descriptor (application/vnd.agentmesh.agent-descriptor+json, one of declaration)
- AgentDoc (application/vnd.agentmesh.agentdoc+json, one of declaration)
- runtime requirements (application/vnd.agentmesh.agent-runtime-requirements+json, optional)
- verdicts (application/vnd.agentmesh.eval-record+json, optional)
- records (document, optional)

## What a good result looks like

Every attached file named as one of the five things it can be, by what is in it, numbered as a source in a fixed order, with its digest, and every file that could not be read or was a second declaration named with the reason.

## What it produces

- what was given (application/vnd.agentmesh.doc-sources+json, per task, working)

## When it comes back empty

A file that cannot be read is named and left out, and the job goes on with the rest. A second descriptor, runtime requirements or AgentDoc is left out and said, because two declarations of one agent cannot both be what it declares.

## How to do it

`gather(paths)` reads the files by their bytes and takes each digest; `sortGiven(files)` tells them apart by their content (`format`, `agentdoc`, `record` and `act`), numbers them S1, S2 and on, and names what it left out; `inventoryOf` is what goes in `given.json`. Nothing here judges a file.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/given.mjs
