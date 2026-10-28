---
name: read-records
description: first, on every incident recording job
---

# Read records

Part of incident-recorder. first, on every incident recording job

## When to use this

first, on every incident recording job

## What this needs

- agent handle (identifier, required)
- failure time (text, required)
- records (document, optional)

## What a good result looks like

All platform activity records and agent records for the failure window read, hashed, and indexed by timestamp and source.

## What it produces

- record inventory (application/vnd.agentmesh.record-inventory+json, per task)

## When it comes back empty

If records are missing or unreadable, the job notes the missing records and passes whatever valid records exist to the timeline builder.

## How to do it

Collect and parse activity records for the platform and the target agent within the window around the failure timestamp. Record the SHA-256 digest and origin of every record file. Note any unreadable or corrupted files in went-without.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/read-records.mjs
- scripts/went-without.mjs
