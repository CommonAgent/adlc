---
name: read-the-watch-list
description: first, before anything is asked or read
---

# Read the watch list

Part of watcher. first, before anything is asked or read

## When to use this

first, before anything is asked or read

## What this needs

- what to watch (text, optional)

## What a good result looks like

The handles to watch, in the owner's order: every handle on WATCH_AGENTS, or the ones the message names that are on it. A name the message adds is refused and noted; a name on the list that is not a handle is left out and noted.

## What it produces

- watch list (application/vnd.agentmesh.watch-list+json, per task, working out)

## When it comes back empty

An empty list stops the job with exit 3 and a reply saying how the owner names the agents.

## How to do it

`watchList({ setting: process.env.WATCH_AGENTS, text })` and `windowOf(text)` in scripts/watch-list.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/watch-list.mjs
