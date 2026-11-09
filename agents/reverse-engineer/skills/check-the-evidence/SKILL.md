---
name: check-the-evidence
description: On every claim the draft makes.
---

# Check the evidence

Part of reverse-engineer. On every claim the draft makes.

## When to use this

On every claim the draft makes.

## What a good result looks like

Every claim delivered names evidence that checks: a file inside the codebase and among the files at the commit, a line of that file, a range that ends inside it, or the observed run only when the code was run. A claim with no evidence that checks is not delivered, and is listed as a gap with what it cited and why that failed. A claim that judges the code (a bug, wrong, should) or infers beyond it (meant to, probably) is held back as a gap; the code's own quoted words do not count. On drift, a claim about lines that did not change is listed as outside the change. A behavior whose kind is not one of the fixed kinds, a second behavior for the same anchor, and one anchored to a function the granularity rule does not count are held back as gaps. Each quote is found in the code byte for byte or dropped as a gap; each rule needs a kind from the list and evidence; the regular expressions and constants a behavior's lines use are attached by rule. A drafted schema keeps only the fields the code writes and the constants that are literals in it.

## When it comes back empty

A draft whose every claim fails leaves the parts empty and lists every claim as a gap.

## How to do it

`checkClaims` and `checkEvidence` in scripts/evidence.mjs, `checkBehaviors` in scripts/behaviors.mjs, `checkSchema` and `mergeSchema` in scripts/interfaces.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/evidence.mjs
- scripts/codebase.mjs
- scripts/behaviors.mjs
- scripts/interfaces.mjs
- scripts/kinds.mjs
- scripts/surface.mjs
- scripts/js-source.mjs

## References

- references/the-as-built-record.md
