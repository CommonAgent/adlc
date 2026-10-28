---
name: read-the-request
description: first, on every job
---

# Read the request

Part of planner. first, on every job

## When to use this

first, on every job

## What this needs

- request (application/vnd.agentmesh.build-request+json, any one of the what to plan group)
- what you want done (text, any one of the what to plan group)

## What a good result looks like

The description, and the earlier plan and change when given, read from the request file or from the plain message. Length is checked, and a stop notice is recognised.

## What it produces

- the reading (application/vnd.agentmesh.build-request-reading+json, per task)

## When it comes back empty

If the first line of the message is the process runner's stop notice, nothing is read or asked, and the reply is one sentence naming the run and the phase. If the description is empty or over 2000 characters, or the file is not JSON, the reply opens "I cannot" and says which.

## How to do it

Find the request file by a file name containing "request" or by its shape. A plain message with no file is the description itself. Check that the description is 1 to 2000 characters and that change is at most 500. If the first line matches `run <run id> phase <phase>: stop that`, stop and answer with one sentence.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/request.mjs
