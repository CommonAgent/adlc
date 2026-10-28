---
name: read-the-spend
description: once the watch list is read; at the same time as the questions
---

# Read the spend

Part of watcher. once the watch list is read; at the same time as the questions

## When to use this

once the watch list is read; at the same time as the questions

## What this needs

- watch list (application/vnd.agentmesh.watch-list+json, required)

## What a good result looks like

The platform's spend report for the agents watched, per job, per day, per agent, per owner and in total, against each registered allowance's ceilings, with whether every spend traces to a job and whether the totals reconcile, both as the platform answered and as the watcher found by adding the job lines up again.

## What it produces

- spend (application/vnd.agentmesh.spend-report+json, per task, working out)

## When it comes back empty

Without a platform address or a read key the spend is not read, and the report says so in its spend section and under Not known. An agent the platform says is not the key's account's is taken out of the spend read and named.

## How to do it

`platform({ base, token }).tokenInfo()` then `.spendReport(account, handles, window)` in scripts/platform.mjs, and `readSpend(body)` in scripts/spend.mjs. The key is the install's WATCH_TOKEN and carries the credits:read scope only.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/spend.mjs
- scripts/platform.mjs

## References

- references/what-the-watcher-reads.md
