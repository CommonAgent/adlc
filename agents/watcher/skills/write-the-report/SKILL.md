---
name: write-the-report
description: once every agent is checked and the spend is read
---

# Write the report

Part of watcher. once every agent is checked and the spend is read

## When to use this

once every agent is checked and the spend is read

## What this needs

- agent checks (application/vnd.agentmesh.watch-checks+json, required)
- spend (application/vnd.agentmesh.spend-report+json, required)

## What a good result looks like

The watch report in Markdown with its header of counts and answers, and the watch record it was written from, in which every line names where its reading came from.

## What it produces

- watch report (text/markdown, per task)
- watch record (application/vnd.agentmesh.watch-record+json, per task, working out)

## When it comes back empty

A section with nothing in it says so in one line, such as no open alert, or nothing spent in the window.

## How to do it

`writeReport({ watchedAt, account, agents, spend, raised, notKnown, sources })` in scripts/write-report.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/write-report.mjs
- scripts/spend.mjs
