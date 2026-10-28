---
name: weigh-the-reasons
description: the third step of a review, the one judgment, which says which recorded reasons to read hardest and never changes the verdict
---

# Weigh the reasons

Part of security-reviewer, the third step of Review a package.

## What it does

Puts each reach and spend that has a recorded reason to the text-reasoning service, once, under `rules.md`, and reads back for each one `holds`, `thin` or `does-not-cover`, with one sentence why (`scripts/weigh.mjs`). The model is the one the install placed (`AGENT_MODEL`), reached through the shared caller (`scripts/caller.mjs`), which keeps the whole exchange in the job's model record; no model is named in this package. It makes no call when no model is placed, or when the ceiling on text-reasoning (`CEILING_TEXT_REASONING`) allows none, and the review then says nobody weighed the reasons.

## What it never does

It never passes or refuses a package, never suggests or grants a permission, and never rewrites a reason. The package's words go to the model as data, between marker lines.

## Scripts

- scripts/weigh.mjs
- scripts/caller.mjs
- scripts/model-record.mjs
