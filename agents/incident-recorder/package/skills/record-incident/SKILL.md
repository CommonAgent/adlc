---
name: record-incident
description: when an agent on the fleet goes quiet or a job fails and an incident must be recorded from records around the failure
---

# Record incident

Part of incident-recorder. when an agent on the fleet goes quiet or a job fails and an incident must be recorded from records around the failure

## When to use this

when an agent on the fleet goes quiet or a job fails and an incident must be recorded from records around the failure

## What this needs

- agent handle (identifier, required)
- failure time (text, required)
- records (document, optional)

## What a good result looks like

An incident record and a strict timeline delivered as files, naming the exact source of every recorded fact and stating plainly every gap where records are missing, without guessing causes or fixes.

## What it produces

- incident record (application/json, per task)
- timeline (application/json, per task)

## When it comes back empty

If no records are provided for the agent and time window, the incident record notes the complete absence of records and delivers the empty timeline without guessing what occurred.

## How to do it

Run `node skills/record-incident/scripts/record-incident.mjs --job {job_dir} --records {records} --work {work} --agent <handle> --time <timestamp>`. It executes the three recording steps in sequence and writes the incident record and timeline files without consulting any AI model.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/record-incident.mjs
- scripts/read-records.mjs
- scripts/build-timeline.mjs
- scripts/write-incident.mjs
- scripts/went-without.mjs
