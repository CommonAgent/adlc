---
name: read-what-was-given
description: first, on every job
---

# Read what was given

Part of publisher. first, on every job

## When to use this

first, on every job

## What this needs

- the files (document, required)

## What a good result looks like

Every file read into memory once, hashed, and its real type taken from its bytes rather than from its name, with the name it will be published under settled.

## What it produces

- the reading (application/vnd.agentmesh.publish-reading+json, per task)

## When it comes back empty

If nothing was attached, the job stops and says what this agent takes.

## How to do it

Read each file once. Hash it. Decide its media type from its first bytes and not from its extension, and refuse the file where the two disagree. Refuse a file that carries a private key or a service-account key, whatever it is called. Settle the name each file will be published under: the name given, or the file's own name reduced to a slug.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/inspect.mjs

## References

- references/what-it-will-not-publish.md
