---
name: say-what-was-written
description: last, to write the reply
---

# Say what was written

Part of test-writer. last, to write the reply

## When to use this

last, to write the reply

## What a good result looks like

A reply that opens with what was written, then what the check said as written, then what could not be tested and why, then anything the job went without. A reader who stops after two sentences has read the part that decides whether to use it.

## When it comes back empty

If nothing was written the reply says so and why, and still says what the check would have needed.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

reply.mjs reads records/<job>/declared.json, suite.json and checked.json and writes the reply: what was written, the verdict as the check wrote it, each thing no test could be written for with its reason, anything assumed, and what the job went without from records/<job>/went-without.json. The suite always goes, even with a finding that survived the second go, because the finding is said where the person reads it.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/reply.mjs
- scripts/went-without.mjs
