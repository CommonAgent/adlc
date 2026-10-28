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

- incident record (application/vnd.agentmesh.incident-record+json, per task)
- timeline (application/vnd.agentmesh.incident-timeline+json, per task)

## When it comes back empty

If no records are provided for the agent and time window, the incident record notes the complete absence of records and delivers the empty timeline without guessing what occurred.

## How to do it

Run `node scripts/record-incident.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <job folder>/message.txt [--file <path>::<media type>]...`. The message names the agent and the failure time as lines of their own, `agent: <handle>` and `time: <ISO time with its zone>`, and may name a folder of records with `records: <folder>`; `--agent` and `--time` win over the message when given. The records read are the attached files and the regular files directly inside that folder, which is read only when it lies inside a folder the host lists in `INCIDENT_RECORDS_ROOTS`. It runs the three recording steps in order, writes the incident record and timeline to the job's records folder (`<records folder>/<job id>/`), files them as the job's pieces, and prints one JSON object with a `reply` field. When the agent or the time is missing it stops with exit 3 and a reply saying what it needs. It calls no model.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/record-incident.mjs
- scripts/read-records.mjs
- scripts/build-timeline.mjs
- scripts/write-incident.mjs
- scripts/went-without.mjs
- scripts/pieces.mjs
