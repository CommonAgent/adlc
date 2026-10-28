---
name: compare-the-declarations
description: after the change is read, to list every difference between the two versions with what it is to a dependent
---

# Compare the declarations

Part of impact-analyst. after the change is read, to list every difference between the two versions with what it is to a dependent

## When to use this

Once the two declarations are known, and the runtime requirements when both came.

## What this needs

- the running version and the changed version
- the runtime requirements before and after, when given

## What a good result looks like

Every difference, in a fixed order, each marked compatible, breaking, change of behavior, words only, or (an output's kind) answered for each reader: offerings removed, added or done differently; inputs and outputs removed, added, made required or optional, given another kind, limit or timing; refusals, systems, records and escalations; the price, the job limit, the ceilings, the settings (the model's above all) and what it is installed with. A difference the rules do not name is breaking because it could not be told. A new version with nothing else changed is a change of behavior.

## What it produces

- the differences, each with its effect and one sentence

## When it comes back empty

Two identical declarations, with the same version and no change given in words, have no differences, and every dependent is answered compatible because nothing it uses changed.

## How to do it

`compareDeclarations`, `compareRuntimes` and `unseenChange` in scripts/compare.mjs. The answers are in references/how-each-change-is-answered.md.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/compare.mjs
- scripts/kinds.mjs
