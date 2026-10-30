---
name: review-a-change
description: when a change to an agent package (its scripts, tests or declarations) is ready for review, and somebody wants findings they can answer before it is packaged
---

# Review a change

Part of code-critic. when a change to an agent package (its scripts, tests or declarations) is ready for review, and somebody wants findings they can answer before it is packaged

## When to use this

when a change to an agent package (its scripts, tests or declarations) is ready for review, and somebody wants findings they can answer before it is packaged

## What this needs

- the programs (document, required)
- the tests (text/javascript, optional)
- the Code stage's account (text/markdown, optional)
- the change (text/x-diff, optional)
- the earlier findings (text/markdown, optional)
- where to look (text, optional)

## What a good result looks like

One Markdown findings document with a header saying what was reviewed, how many findings there are and how many are open; one section per finding, each naming a file and a line of the package, a claim that can be checked and a consequence for somebody, with an Answer line that starts as open; what was not reviewed and why; and, when earlier findings came back, which were answered by a change, which by a reason and which are still open. No grade, no verdict, no fix.

## What it produces

- the findings (text/markdown, per task)

## When it comes back empty

If nothing attached is a script or a declaration, nothing is reviewed and no model is called: the reply says what a review is given and asks for it. If no model is configured, or it cannot be reached, the house-rule findings are still delivered and the reply says the review went without the model.

## How to do it

This job runs as one command, job.mjs, which the package names as the job's command: it reads what was attached, runs the five steps in order, files the findings and prints the reply. No harness runs it and nothing is left to work out by hand. What follows says what that command does, so a reader can see it did the right thing.

The package is installed at ~/code-critic, so the command is always node ~/code-critic/skills/review-a-change/scripts/job.mjs --job <job folder> --records <records directory> --work <work directory> --text-file <job folder>/message.txt, with one --file <path>::<media type> per attached file.

1. Read the change (read-change.mjs). A tar.gz of the package folder is unpacked with its paths; loose files are put back where the package's plugin.json says they live, and the agent's own files are found by content. A unified diff, the Code stage's account and an earlier findings document are found by content too. Everything is laid out under records/<job>/package and described in records/<job>/read.json.
2. Check the house rules (house-rules.mjs), with no model: no model named in code, no address where a bound system belongs, every piece its declared kind, no undeclared output, records, credentials and how claims that match the code, and with a diff any access a declaration adds.
3. Review the code (review.mjs, through model-caller.mjs): one call to the model the install placed with every file line-numbered and the house-rule findings already made; a second only when the first answer could not be read.
4. Check the findings (check-findings.mjs): each model finding without a real file and line, a claim and a consequence, or that grades the work, writes a fix or repeats another, is dropped with its reason.
5. Write the findings (write-findings.mjs, then pieces.mjs): the document, the reply and pieces.json.

The last line job.mjs prints is one JSON object; its `reply` field is the whole answer. Print it and nothing else.

Never change a file of the package under review, never run it, and never write a fix: the findings are the whole of what this agent hands back.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/job.mjs
- scripts/declines.mjs
- scripts/read-change.mjs
- scripts/house-rules.mjs
- scripts/review.mjs
- scripts/model-caller.mjs
- scripts/check-findings.mjs
- scripts/write-findings.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs
- scripts/agent-folder.mjs

## References

- references/the-house-rules.md
- references/what-a-finding-is.md
- references/a-review-that-works.md
- references/rules.md
