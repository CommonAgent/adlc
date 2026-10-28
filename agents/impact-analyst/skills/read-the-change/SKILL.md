---
name: read-the-change
description: first, to sort the attached files into what the analysis takes
---

# Read the change

Part of impact-analyst. first, to sort the attached files into what the analysis takes

## When to use this

At the start of every job, before anything is compared.

## What this needs

- the attached files, each with the kind it came under

## What a good result looks like

Each file known by what it holds: a descriptor by `format: agent-descriptor-v1`, runtime requirements by `format: agent-runtime-requirements-v1`, a dependents list by its `subject` and `dependents`, a solution by its `nodes` and `connections`, an agent's ports by its `agent` and `offerings`. A file sent under another kind is read by what it holds and the report says so. A file that is not JSON, or is none of these, is named and goes in went-without.json. The running version is the declaration with the lower agent_version, else the first attached, and the report says which and why.

## What it produces

- the reading: the two declarations, the dependents list, the solutions, the agents' ports and the runtime requirements, in the order attached

## When it comes back empty

With fewer or more than two declarations, or no dependents list, the job stops and the reply says what is needed.

## How to do it

`readChange(files)` in scripts/read-change.mjs reads and sorts; `pairDescriptors` and `pairRuntimes` say which is which. It judges nothing.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/read-change.mjs
- scripts/kinds.mjs
