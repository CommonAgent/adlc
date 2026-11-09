---
name: draft-from-the-code
description: On adoption, in bounded passes over the codebase. On drift, in one pass with the changed files, the diff and the last record's behaviors.
---

# Draft from the code

Part of reverse-engineer. On adoption, in bounded passes over the codebase. On drift, in one pass with the changed files, the diff and the last record's behaviors.

## When to use this

On adoption, in bounded passes over the codebase. On drift, in one pass with the changed files, the diff and the last record's behaviors.

## What a good result looks like

One JSON object from each pass, merged: on adoption a pass for the architecture, the interfaces and the gaps, behavior passes of a few source files each, and a pass for what each test covers, each shown the facts read by rule and recorded in calls.json. Behaviors in the feature list's shape, one per anchor, each with a kind from the fixed list, the patterns and words other code depends on quoted exactly, and its order, limit, header and default rules, the architecture as built in the architecture record's shape, the interfaces with schemas only where the code shows the shape field by field, what each test covers, and the gaps (unreachable code, behavior seen only at run time, anything unclear). Every claim names a file and line from the numbered code it was shown. It is a draft: nothing in it is delivered before check-the-evidence.

## When it comes back empty

With a model setting missing, or no usable answer after two calls, the record is written with the parts read by rule and the drafted parts listed as gaps, and the reply says so.

## How to do it

`draftInPasses` (adoption), `promptOf` and `draftRecord` (drift) in scripts/draft.mjs, with the kinds and the granularity rule in scripts/kinds.mjs, through the shared caller (scripts/model-caller.mjs) and the four model settings. Files over the reading budget are not shown and are listed as gaps.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/draft.mjs
- scripts/model-caller.mjs
- scripts/codebase.mjs
- scripts/kinds.mjs

## References

- references/the-as-built-record.md
- references/architecture-standard.md
