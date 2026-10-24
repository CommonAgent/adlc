---
name: ask-what-is-missing
description: last, to write the reply and put the open questions to the person
---

# Ask what is missing

Part of spec-writer. last, to write the reply and put the open questions to the person

## When to use this

last, to write the reply and put the open questions to the person

## What a good result looks like

A reply that opens with what the draft is, then the open questions on their own lines, then what the builder said, then anything the job went without. A reader who stops after two sentences has read the part that needs them.

## When it comes back empty

If nothing is open, the reply says so plainly rather than leaving a reader looking for a question they were not asked.

## How to do it

Nothing in this folder is run on its own; the write-a-spec skill names the one command that does the whole job, and this skill only explains what that command does for this step.

ask.mjs writes the reply. The draft always goes, even when it is short of something: a spec missing its name is still most of the work, and reading it is what lets somebody answer the question about the name. The questions come second, under one line saying what the draft is, because they are the only part the reader has to act on; everything about checking comes after them. They are asked together and on their own lines, because none of them blocks the others and three messages a day apart to settle a name, a price and an access grant is a week spent on a form. What the job went without rides on the end, read from records/<job>/went-without.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/ask.mjs
- scripts/asked.mjs
- scripts/went-without.mjs
