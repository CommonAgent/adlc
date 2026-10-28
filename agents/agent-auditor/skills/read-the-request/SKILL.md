---
name: read-the-request
description: First: before any record is judged, work out which agent and which package are being audited and read everything about them.
---

# Read the request

Part of agent-auditor. First: before any record is judged, work out which agent and which package are being audited and read everything about them.

## When to use this

First: before any record is judged, work out which agent and which package are being audited and read everything about them.

## What a good result looks like

The agent's handle, the audited version and package digest and how they were chosen, the agent as dev and prod serve it, the deploy queue's records for it, the package's files, the attached records sorted by what they hold, and each stage holder's keys. Every read that failed is kept with its reason.

## When it comes back empty

With no agent named, nothing is read. A read that fails is noted in went-without.json and the audit goes on with what was read.

## How to do it

`fromText` and `readFiles` in scripts/read-request.mjs, then `gather` in scripts/gather.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/read-request.mjs
- scripts/gather.mjs
- scripts/platform.mjs
- scripts/tar.mjs
- scripts/keys.mjs

## References

- references/stage-holders.json
