---
name: name-the-systems
description: once the request is recorded, to say what the agent stands on
---

# Name the systems

Part of solution-architect. once the request is recorded, to say what the agent stands on

## When to use this

once the request is recorded, to say what the agent stands on

## What a good result looks like

The systems in plain system words, each with its access and the words of the statement that call for it, a model system stated by capability, the kind, the dependencies, the limits, the egress, the formats at the agent's edge, the settings with their defaults, and every decision with its reason, checked against the architecture standard.

## When it comes back empty

If the service will not answer, or answers with something that is not an architecture, nothing is written and the job stops with the reason. An answer that still carries findings after a second go goes on with the findings named.

## How to do it

Nothing in this folder is run on its own; the write-the-architecture and revise-the-architecture skills name the commands that do the whole job, and this skill only explains what its command does for this step.

name.mjs sends one request to the text-reasoning service as the model TEXT_MODEL names: the instruction, the statement, the reserved system names, in a revision the record with the answers and the change, the architecture standard, and an example record. It checks the answer with standard.mjs and asks once more with the findings, never a third time. Then code takes out every model name, address and credential, renames a system named by its product, and turns each commitment the answer filled in (a spending limit, a destination beyond the derived set, a system the statement does not call for) into a question. It writes records/<job>/named.json and records/<job>/calls.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/name.mjs
- scripts/caller.mjs
- scripts/standard.mjs
- scripts/options.mjs
- scripts/architecture-record.mjs

## References

- references/architecture-standard.md
- references/a-record-that-works.md
