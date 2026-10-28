---
name: raise-the-alarms
description: once the report's readings are in; before the pieces are filed
---

# Raise the alarms

Part of watcher. once the report's readings are in; before the pieces are filed

## When to use this

once the report's readings are in; before the pieces are filed

## What this needs

- agent checks (application/vnd.agentmesh.watch-checks+json, required)

## What a good result looks like

One alarm for each agent seen failing (not alive, not answering, or outside a limit) and not already raised: the message `agent: <handle>` and `time: <ISO time>` and a file of what the watcher saw, left for the host to send to the incident recorder the install names; then the report handed over, and a reply that says first what the job went without.

## What it produces

- alarms (application/x-ndjson, per task)

## When it comes back empty

With no open alert there is no alarm, and an alert already raised and unchanged is not raised again. With no incident recorder named, or one that cannot be addressed, the alarm is handed back with the report and the reply says why.

## How to do it

`alarmFor(agent, { watcher })` in scripts/alarms.mjs, then `leave(dir, { to, text, files })` in scripts/outbox.mjs for the incident recorder, then `fill(jobDir, plan({ reportPath, recordPath, alarms }))` in scripts/pieces.mjs, with `sentence(read(records))` from scripts/went-without.mjs at the head of the reply.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/alarms.mjs
- scripts/outbox.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs
