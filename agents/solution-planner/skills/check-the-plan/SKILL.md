---
name: check-the-plan
description: after the model has answered with JSON
---

# Check the plan

Part of planner. after the model has answered with JSON

## When to use this

after the model has answered with JSON

## What this needs

- draft plan (application/json, required)

## What a good result looks like

Every step marked new with no agent and no offering, and an agent or offering the model wrote anyway removed and recorded. Every step's needs read: its takes and gives each named once with a kind from the fixed list. Every input line checked against the step's takes, the Start fields and the earlier steps' gives. The schedule validated. The estimate filled in by code.

## What it produces

- checked plan (application/json, per task)
- what the checks changed (application/json, per task)

## When it comes back empty

If nothing in the plan survives the checks, the plan is still written with its problems in missing. No step leaves this check naming an agent.

## How to do it

Mark every step new. Remove any agent or offering the model wrote and record it with the step. Give each step a new_agent of a short lower-case hyphenated name and one line. Read its needs: the takes and gives each named once, a kind from the fixed list (an unknown kind becomes text, and the change is recorded). Make the outputs the gives. Drop input lines whose name is not one of the step's takes, or whose source is not a Start field or an earlier step's give, and add a sentence to missing. List required takes with no line in missing. Validate the schedule. Set to_build_usd to 0 and ready_minutes to 1, and new_agent_usd to NEW_AGENT_USD (default 1.50): the platform counts what is to build after Source. Clamp per_run_usd to 0..5 and run_minutes to 1..120.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/check.mjs
