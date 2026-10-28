---
name: write-incident-record
description: after the timeline is constructed and gaps are identified
---

# Write incident record

Part of incident-recorder. after the timeline is constructed and gaps are identified

## When to use this

after the timeline is constructed and gaps are identified

## What this needs

- timeline (application/vnd.agentmesh.incident-timeline+json, required)
- record inventory (application/vnd.agentmesh.record-inventory+json, required)

## What a good result looks like

The incident record and timeline written to the job folder as files, with every fact tied to its source byte digest and every gap named.

## What it produces

- incident record (application/vnd.agentmesh.incident-record+json, per task)
- timeline (application/vnd.agentmesh.incident-timeline+json, per task)

## When it comes back empty

If the timeline contains no events, writes an incident record declaring that no facts could be verified from the supplied records.

## How to do it

Produce incident.json and timeline.json under the job directory. Ensure every fact lists its source digest and no section suggests root causes or remedies.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/write-incident.mjs
- scripts/went-without.mjs
