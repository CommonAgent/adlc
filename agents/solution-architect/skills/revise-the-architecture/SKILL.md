---
name: revise-the-architecture
description: when an architecture record comes back with answers to its questions, or with something to change
---

# Revise the architecture

Part of solution-architect. when an architecture record comes back with answers to its questions, or with something to change

## When to use this

when an architecture record comes back with answers to its questions, or with something to change

## What this needs

- the record to revise (text/markdown, optional)
- what to change (text, optional)
- answers to its questions (text, optional)
- the organization's stack (application/vnd.agentmesh.stack+json, optional)
- the platform's defaults (application/vnd.agentmesh.stack-vocabulary+json, optional)

## What a good result looks like

The record again, with what was asked changed and everything else kept, and beside it what changed: each line that is new or gone, and the reason for each decision that changed. An answer settles the question under its key. A change that needs a system the statement never called for, such as a design step reaching something new, is asked as a question and the system is not added on the designer's word.

## What it produces

- the architecture record (text/markdown, per task)
- what changed (text/markdown, per task)
- what is still open (text/markdown, per task)

## When it comes back empty

If no record came with the message and this agent has written none, nothing is revised and no model is woken: the reply asks for the record.

## How to do it

A revision runs the same five commands as writing one, with the same variables, from this skill's own folder: ~/solution-architect/skills/revise-the-architecture/scripts/. The first command finds the record among FILES (or takes this agent's newest earlier record), reads each `key: answer` line under a key the record asked as an answer, and reads everything else as the change.

1. JOB_DIR=<job folder> RECORDS=<records folder> TEXT_FILE=<the message text written to a file> FILES=<each attached path, with ::media_type, comma separated> node ~/solution-architect/skills/revise-the-architecture/scripts/asked.mjs

2. ASKED=<records folder>/asked.json RECORDS=<records folder> node ~/solution-architect/skills/revise-the-architecture/scripts/name.mjs

3. NAMED=<records folder>/named.json ASKED=<records folder>/asked.json RECORDS=<records folder> node ~/solution-architect/skills/revise-the-architecture/scripts/bind.mjs

4. ASKED=<records folder>/asked.json NAMED=<records folder>/named.json BOUND=<records folder>/bound.json RECORDS=<records folder> node ~/solution-architect/skills/revise-the-architecture/scripts/check-record.mjs

5. RECORDS=<records folder> node ~/solution-architect/skills/revise-the-architecture/scripts/reply.mjs

Then JOB_DIR=<job folder> RECORDS=<records folder> node ~/solution-architect/skills/revise-the-architecture/scripts/pieces.mjs to file the pieces.

The last script's `reply` is your whole answer; print it and nothing else. When any of them exits 3, print its `reply` and stop.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/asked.mjs
- scripts/name.mjs
- scripts/caller.mjs
- scripts/standard.mjs
- scripts/bind.mjs
- scripts/architecture-record.mjs
- scripts/standing.mjs
- scripts/check-record.mjs
- scripts/reply.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs

## References

- references/architecture-standard.md
- references/house-stack.json
- references/a-record-that-works.md
- references/rules.md
- references/standing-asset-schemas.json
