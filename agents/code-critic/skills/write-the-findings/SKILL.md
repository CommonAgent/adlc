---
name: write-the-findings
description: the last step, once the findings are checked
---

# Write the findings

Part of code-critic. the last step, once the findings are checked

## When to use this

the last step, once the findings are checked

## What a good result looks like

One Markdown document: the header (package, change, findings, open, reviewed_by, reviewed_at), a section per finding with Place, Rule, Claim, Consequence, Found by and Answer, the answers to an earlier review when one came, what was outside the change, what was not reviewed, and how to answer. A reply that leads with the count and the open number and names the first findings by place.

## When it comes back empty

With no findings, the document says there are none and why, and open is 0.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

write-findings.mjs puts the house-rule findings first and the model's after them, carries a reason from an earlier review onto a finding found again, and says for each earlier finding whether it was answered by a reason, by a change, or is still open. pieces.mjs puts the document at out/findings.md and lists it in pieces.json as the findings, text/markdown, made by write-the-findings.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/write-findings.mjs
- scripts/pieces.mjs
- scripts/house-rules.mjs
- scripts/went-without.mjs

## References

- references/a-review-that-works.md
