---
name: draft-from-the-code
description: After the codebase is read, to draft the behaviors, the architecture as built and the interfaces.
---

# Draft from the code

Part of reverse-engineer. After the codebase is read, to draft the behaviors, the architecture as built and the interfaces.

## When to use this

On adoption, with the whole codebase. On drift, with the changed files, the diff and the last record's behaviors.

## What a good result looks like

One JSON object from the model: behaviors in the feature list's shape, the architecture as built in the architecture record's shape, the interfaces with schemas only where the code shows the shape field by field, what each test covers, and the gaps (unreachable code, behavior seen only at run time, anything unclear). Every claim names a file and line from the numbered code it was shown. It is a draft: nothing in it is delivered before check-the-evidence.

## When it comes back empty

With a model setting missing, or no usable answer after two calls, the record is written with the parts read by rule and the drafted parts listed as gaps, and the reply says so.

## How to do it

`chooseFiles`, `promptOf` and `draftRecord` in scripts/draft.mjs, through the shared caller (scripts/model-caller.mjs) and the four model settings. Files over the reading budget are not shown and are listed as gaps.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/draft.mjs
- scripts/model-caller.mjs
- scripts/codebase.mjs

## References

- references/the-as-built-record.md
- references/architecture-standard.md
