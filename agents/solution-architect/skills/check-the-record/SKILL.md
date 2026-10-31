---
name: check-the-record
description: once every system is bound or asked, to write the record and hold it to its done-when
---

# Check the record

Part of solution-architect. once every system is bound or asked, to write the record and hold it to its done-when

## When to use this

once every system is bound or asked, to write the record and hold it to its done-when

## What a good result looks like

The record, written once from the facts before it, saying done: yes only when every system is named and bound in each environment, every decision has its reason and no question is open, and carrying no model name, address or credential. In a revision, what changed beside it.

## When it comes back empty

A record that would carry a model name, an address or a credential is not written, and the reply says so as this agent's own fault.

## How to do it

Nothing in this folder is run on its own; the write-the-architecture and revise-the-architecture skills name the commands that do the whole job, and this skill only explains what its command does for this step.

check-record.mjs decides the standing assets with standing.mjs (for each kind of output a person reads, the standing assets that apply and why, or none and why, by the architecture standard's section 10 and references/standing-asset-schemas.json), renders the record with architecture-record.mjs, reads it back, and writes records/<job>/record.md, records/<job>/checks.json with its digest, records/<job>/still-open.md when a question is open, and records/<job>/what-changed.md in a revision.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/standing.mjs
- scripts/check-record.mjs
- scripts/architecture-record.mjs
- scripts/standard.mjs
- scripts/options.mjs
- scripts/no-provider.mjs

## References

- references/architecture-standard.md
- references/standing-asset-schemas.json
