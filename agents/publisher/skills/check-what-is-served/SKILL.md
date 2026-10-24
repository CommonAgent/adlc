---
name: check-what-is-served
description: after the files are placed, before any address is given out
---

# Check what is served

Part of publisher. after the files are placed, before any address is given out

## When to use this

after the files are placed, before any address is given out

## What this needs

- what was placed (application/json, required)

## What a good result looks like

Each address fetched back and the bytes hashed, and every digest equal to the one recorded when the file went up.

## What it produces

- address (url, per task)
- publication record (application/json, per task)

## When it comes back empty

If an address does not resolve, or serves something with a different digest, the reply says so and does not present the address as good.

## How to do it

Fetch each address. Hash what comes back. Compare it with the digest recorded at placement. An address is only given out when the two match. This step is the difference between saying a thing is published and knowing it.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/place.mjs
