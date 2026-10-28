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

## What a good result looks like

For each agent, whether it answered the worker interface's status question within the wait, when, how long it took and what it said; or that it was silent, held at its door, refused, or could not be asked, with why.

## What it produces

- answers (application/vnd.agentmesh.watch-answers+json, per task, working out)

## When it comes back empty

An agent that does not answer is silent, and silence is a failure. When the agentmesh command cannot run, every agent is reported as not asked, with why, and none of them is called silent.

## How to do it

`askAll(handles, { waitSeconds })` in scripts/ask.mjs sends `agentmesh-worker/v1` and `status`, as two lines, with `agentmesh messages send <handle> <text> --wait <seconds> --json`, to every agent at once. references/what-the-watcher-reads.md says what an answer proves.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/ask.mjs
- scripts/send.mjs

## References

- references/what-the-watcher-reads.md
