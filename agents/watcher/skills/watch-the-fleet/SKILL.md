---
name: watch-the-fleet
description: when the owner wants to know which of the agents they named are alive, answering and inside their limits, and what each spent against what was allowed
---

# Watch the fleet

Part of watcher. when the owner wants to know which of the agents they named are alive, answering and inside their limits, and what each spent against what was allowed

## When to use this

when the owner wants to know which of the agents they named are alive, answering and inside their limits, and what each spent against what was allowed

## What this needs

- what to watch (text, optional)

## What a good result looks like

A Markdown watch report a person can act on: a header of counts and the two Cost answers, then each agent alive, answering and inside its limits or an open alert with its reason, the spend per job, per agent, per owner and in total against what was allowed, reconciled or not, what is not known, and every source read. Each open alert has gone to the incident recorder, or the report says why not.

## What it produces

- watch report (text/markdown, per task)
- watch record (application/vnd.agentmesh.watch-record+json, per task, working out)
- alarms (application/x-ndjson, per task)

## When it comes back empty

With no agent named to watch nothing is watched, and the reply says how the owner names them in WATCH_AGENTS. With agents named, the report is always written: an agent that could not be read or asked is reported as not known, with why, and keeps an open alert.

## How to do it

Run `node scripts/watch.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <job folder>/message.txt`. The install's settings say what is watched and where it is read (WATCH_AGENTS, MESH_API_BASE, WATCH_TOKEN, INCIDENT_RECORDER, ANSWER_SECONDS); the message may only narrow the watch and name the spend window. It runs the steps in order, keeps the record, the report, the alarms and what became of them in `<records folder>/<job id>/`, files the report, the record and the alarms as the job's pieces, and prints one JSON object with a `reply` field. An open alert is a finding, not a failure: the job still delivers. It calls no model and spends nothing.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/watch.mjs
- scripts/watch-list.mjs
- scripts/ask.mjs
- scripts/send.mjs
- scripts/platform.mjs
- scripts/checks.mjs
- scripts/spend.mjs
- scripts/write-report.mjs
- scripts/alarms.mjs
- scripts/raise.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs

## References

- references/what-the-watcher-reads.md
- references/rules.md
