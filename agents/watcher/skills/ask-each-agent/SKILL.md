---
name: ask-each-agent
description: once the watch list is read; at the same time as the platform reads
---

# Ask each agent

Part of watcher. once the watch list is read; at the same time as the platform reads

## When to use this

once the watch list is read; at the same time as the platform reads

## What this needs

- watch list (application/vnd.agentmesh.watch-list+json, required)
- status answers (text, optional)

## What a good result looks like

For each agent, the status question left for the host to send, and its answer recorded when it arrives, with when and what it said; or that it was silent (no answer within the wait), or could not be asked, with why.

## What it produces

- answers (application/vnd.agentmesh.watch-answers+json, per task, working out)

## When it comes back empty

An agent that does not answer within the wait is silent, and silence is a failure. An agent with no agent id to address is reported as not asked, with why, and is not called silent.

## How to do it

`askAll(agents, { dir, thread, at })` in scripts/ask.mjs leaves `agentmesh-worker/v1` and `status`, as two lines, for each agent in `out/outbox.jsonl` (scripts/outbox.mjs), in one thread; the host sends them under this agent's key as the job ends. Each answer arrives as a message of its own and `recordAnswer` in scripts/rounds.mjs keeps it. references/what-the-watcher-reads.md says what an answer proves.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/ask.mjs
- scripts/outbox.mjs
- scripts/rounds.mjs

## References

- references/what-the-watcher-reads.md
