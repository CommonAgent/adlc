---
name: place-the-files
description: after the files are read and none was refused
---

# Place the files

Part of publisher. after the files are read and none was refused

## When to use this

after the files are read and none was refused

## What this needs

- the reading (application/json, required)

## What a good result looks like

Every file placed under the bound folder, under the settled name, with a short cache life so a republish shows within a minute.

## What it produces

- what was placed (application/json, per task)

## When it comes back empty

If the host will not take a file, the job stops and says which one and why. Files already placed stay placed and are named in the reply.

## How to do it

All files of one publish go into one folder named after the settled name of the first file (without its extension), so a page and the files it links to stay together. Ask the broker for each file and PUT it. When the agent is stopped the broker refuses, nothing more is placed, and the reply says so.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/place.mjs
