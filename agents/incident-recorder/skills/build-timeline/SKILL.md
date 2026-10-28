---
name: build-timeline
description: after the records for the window are read and indexed
---

# Build timeline

Part of incident-recorder. after the records for the window are read and indexed

## When to use this

after the records for the window are read and indexed

## What this needs

- record inventory (application/vnd.agentmesh.record-inventory+json, required)

## What a good result looks like

A strict chronological sequence of known events with source attributions and explicit gap entries identifying intervals where records are missing.

## What it produces

- timeline (application/vnd.agentmesh.incident-timeline+json, per task)

## When it comes back empty

If no valid events are found in the window, produces a timeline containing only the start, end, and an unrecorded gap.

## How to do it

Sort verified events strictly chronologically. Attach the source record identifier and byte offset to each event. Where time intervals between records exceed the expected cadence or records are absent, insert an explicit gap entry without guessing what transpired.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/build-timeline.mjs
- scripts/went-without.mjs
