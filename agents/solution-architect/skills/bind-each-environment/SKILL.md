---
name: bind-each-environment
description: once the systems are named, to put a product behind each in each environment
---

# Bind each environment

Part of solution-architect. once the systems are named, to put a product behind each in each environment

## When to use this

once the systems are named, to put a product behind each in each environment

## What a good result looks like

Each system bound in dev, test and production to a product, the organization's choice wherever it made one and the House Stack's product only where it left the system open, each binding saying where it came from, and one decision per system with its reason.

## When it comes back empty

A system that neither the organization's stack nor the House Stack can stand behind in an environment is a question naming the system and the environment, and is never filled in.

## How to do it

Nothing in this folder is run on its own; the write-the-architecture and revise-the-architecture skills name the commands that do the whole job, and this skill only explains what its command does for this step.

bind.mjs walks the role's rule in the order the deploy's own resolver uses: the organization's binding for that environment, its production binding where it lets production stand in, the House Stack's product where the House Stack covers the system, and otherwise a question. A default beside the organization's own product in another environment says, in its decision, that the AgentMesh deploy refuses that environment until the organization binds it too. It copies no credential, address, setting or key store from the stack. It writes records/<job>/bound.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/bind.mjs
- scripts/architecture-record.mjs

## References

- references/house-stack.json
