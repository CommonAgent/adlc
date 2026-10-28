---
name: agent-change
description: when somebody proposes a change to an agent and needs to know, before anything is built, what depends on the agent and what the change does to each
---

# Report on a change to an agent

Part of impact-analyst. when somebody proposes a change to an agent and needs to know, before anything is built, what depends on the agent and what the change does to each

## When to use this

When a change to an agent is proposed and nothing has been built yet: the person who asked for it needs every dependent named and answered before deciding. This is the Impact stage of the Agent Development Lifecycle.

## What this needs

- running version (application/vnd.agentmesh.agent-descriptor+json, required)
- changed version (application/vnd.agentmesh.agent-descriptor+json, required)
- what depends on it (application/vnd.agentmesh.dependents+json, required)
- dependent solutions (application/vnd.agentmesh.solution+json, optional, one file each)
- agents that may take its outputs (application/vnd.agentmesh.agent-ports+json, optional)
- runtime requirements (application/vnd.agentmesh.agent-runtime-requirements+json, optional, before and after)
- what changed (text, optional)

## What a good result looks like

An impact report in which every dependent the platform's list names, and every one given, appears with where it was found and one answer: compatible, breaking or change of behavior, with the reason. No change a dependent would notice is called compatible; one that could not be told is breaking and says why. Every source of dependents that could not be read is named. One dependency debt is filed in the ledger for each dependent answered breaking or change of behavior, owed to its owner, and none twice. The same files always give the same report. The report and the reply approve nothing.

## What it produces

- impact report (text/markdown, per task)

## When it comes back empty

Without two declarations, or without the list of what depends on the agent, it writes no report and replies with what it needs and how to send it (exit 3). An empty list of dependents is not empty: the report says the change touches no dependent the platform knows of. Asked only whether to go ahead, it says it does not approve changes.

## How to do it

Run `node scripts/analyze.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <message file> [--file <path>::<media type>]...`. It runs the five steps in order and prints one JSON object with a `reply` field. Files are known by what they hold, whatever kind they came under. Of the two declarations, the one with the lower agent_version is the running version. It reaches the ledger only through the host's binding (`LEDGER_TOKEN`, `MESH_API_BASE`); without it, what is owed is listed in the report and not filed. It calls no model. Read rules.md and references/how-each-change-is-answered.md.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/analyze.mjs
- scripts/read-change.mjs
- scripts/kinds.mjs
- scripts/compare.mjs
- scripts/answer.mjs
- scripts/ledger.mjs
- scripts/report.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs
