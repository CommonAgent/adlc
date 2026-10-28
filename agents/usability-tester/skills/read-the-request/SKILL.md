---
name: read-the-request
description: First, before anything is checked or run.
---

# Read the request

Part of usability-tester. First, before anything is checked or run.

## When to use this

First, before anything is checked or run.

## What a good result looks like

The agent's handle, the offering and change when the message names them, a person's judgment when one is given, the examples and files attached, and the agent's Descriptor as the platform serves it, with its digest.

## When it comes back empty

No agent named, no agent answering to the handle, or no Descriptor served: the job stops and the reply says what is needed.

## How to do it

`fromText` and `readFiles` in scripts/read-request.mjs, then `storefront` and `descriptor` in scripts/platform.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/read-request.mjs
- scripts/platform.mjs
- scripts/retry.mjs
- scripts/tar.mjs
