---
name: check-the-limits
description: once each agent has been asked and its storefront, run record and AgentDoc read
---

# Check the limits

Part of watcher. once each agent has been asked and its storefront, run record and AgentDoc read

## When to use this

once each agent has been asked and its storefront, run record and AgentDoc read

## What this needs

- watch list (application/vnd.agentmesh.watch-list+json, required)
- answers (application/vnd.agentmesh.watch-answers+json, required)

## What a good result looks like

For each agent: alive from the registry's presence, answering from its answer, and inside its limits from each declared ceiling held against what the platform recorded (the time a job may take against the platform's average and the job running now, the money its owner allowed against the spend report), each with where both sides were read; and an open alert naming every reason one is due.

## What it produces

- agent checks (application/vnd.agentmesh.watch-checks+json, per task, working out)

## When it comes back empty

A limit with no reading to hold it against is said to be not measured, never inside. An agent with no declared limit is said to declare none.

## How to do it

`checkAgent({ named, card, record, agentdoc, asked, spendAgent, spendRead })` in scripts/checks.mjs, from the reads in scripts/platform.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/checks.mjs
- scripts/platform.mjs
- scripts/ask.mjs
- scripts/send.mjs
- scripts/spend.mjs

## References

- references/what-the-watcher-reads.md
