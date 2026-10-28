---
name: review-the-code
description: the third step, once the house rules are checked
---

# Review the code

Part of code-critic. the third step, once the house rules are checked

## When to use this

the third step, once the house rules are checked

## What a good result looks like

The model's findings as it gave them, each with a place, a rule, a claim and a consequence, about what a program could not see; the files it was sent and any left out for room; and the calls made, with the model configured and the model that answered.

## When it comes back empty

With no model configured, or none reachable, no findings come from this step and the job goes on with the house-rule findings, saying so. An answer that cannot be read is asked for once more; then the review stands without it.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

review.mjs hands the configured model (through caller.mjs, which reads TEXT_MODEL or AGENT_MODEL and names no model of its own) every declaration, script and test with its line numbers, changed files first, within one ask's room; the account, the diff and an earlier review when they came; the house rules and the findings the program already made, which it must not repeat; and the person's words as where to look. It asks for findings in blocks and for nothing else: no verdict, no grade, no fix.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/review.mjs
- scripts/caller.mjs
- scripts/house-rules.mjs
- scripts/went-without.mjs

## References

- references/the-house-rules.md
- references/what-a-finding-is.md
