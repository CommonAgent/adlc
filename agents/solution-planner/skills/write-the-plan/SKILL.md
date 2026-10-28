---
name: write-the-plan
description: last, after the plan is checked or refused
---

# Write the plan

Part of planner. last, after the plan is checked or refused

## When to use this

last, after the plan is checked or refused

## What this needs

- checked plan (application/vnd.agentmesh.build-plan+json, required)

## What a good result looks like

out/plan.json written in build-plan-v1 with the checked and model counts filled in. pieces.json lists the plan. The reply names the title and each step with what it takes and hands back, in under 3500 characters. Every record is written, including when the job stopped early.

## What it produces

- plan (application/vnd.agentmesh.build-plan+json, per task)

## When it comes back empty

If there is no plan to write, no plan.json is written. The reply opens "I cannot" and is under 600 characters, and the records are still written. A plan with refused set is still written, and the reply opens "I cannot plan this:" with the sentence.

## How to do it

Write out/plan.json and pieces.json, then build the reply. Then run scripts/went-without.mjs to write went-without.json into the records folder for this job. It records each thing that was missing (an agent name removed, a dropped input line, an unknown kind, a failed try) and what was done instead. It runs whether the job succeeded or stopped.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/pieces.mjs
- scripts/went-without.mjs
