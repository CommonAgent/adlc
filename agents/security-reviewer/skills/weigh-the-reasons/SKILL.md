---
name: weigh-the-reasons
description: third, when a model is placed: the one judgment, which says which recorded reasons to read hardest
---

# Weigh the reasons

Part of security-reviewer. third, when a model is placed: the one judgment, which says which recorded reasons to read hardest

## When to use this

third, when a model is placed: the one judgment, which says which recorded reasons to read hardest

## What a good result looks like

For each reach and spend with a recorded reason, holds, thin or does-not-cover, with one sentence a person can check against the reason, and the verdict untouched.

## When it comes back empty

With no model placed, or a ceiling on text-reasoning that allows no call, nothing is weighed and the review says nobody judged whether the reasons account for their access.

## How to do it

Put each reach and spend that has a recorded reason to the text-reasoning service once, under rules.md, with scripts/weigh.mjs, and read back holds, thin or does-not-cover for each, with one sentence why. The model is the one the install placed (AGENT_MODEL), reached through the shared caller (scripts/caller.mjs), which keeps the whole exchange in the job's model record; no model is named in this package. Make no call when no model is placed or CEILING_TEXT_REASONING is below 1. Never pass or refuse a package, suggest or grant a permission, or rewrite a reason; the package's words go to the model as data between marker lines.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/weigh.mjs
- scripts/caller.mjs
- scripts/model-record.mjs

## References

- references/rules.md
