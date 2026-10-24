---
name: read-what-was-asked
description: the first step of writing a spec, before anything is drafted
---

# Read what was asked

Part of spec-writer. the first step of writing a spec, before anything is drafted

## When to use this

the first step of writing a spec, before anything is drafted

## What a good result looks like

A record of the request exactly as it arrived, every attached file with what it mechanically appears to be, and the whole checklist of what a spec carries with nothing marked settled.

## When it comes back empty

If nothing was said and nothing readable was attached, this step stops the job and the reply names the five kinds of thing that would be enough. No model is woken.

## How to do it

Nothing in this folder is run on its own; the write-a-spec skill names the one command that does the whole job, and this skill only explains what that command does for this step.

asked.mjs writes records/<job>/asked.json: the request as it arrived and never tidied, each attached file with its name, size, media type and what it mechanically appears to be, and the checklist of the thirteen things a spec carries. It decides nothing about what the request settles, because that is a judgment and it belongs to the drafting step. A file that was named and is not there is recorded as not there rather than dropped. An attached JSON that carries a name, a version and jobs with slugs is recorded as a spec, because somebody attaching one is revising or copying it. What a text attachment says is carried in the record, whole up to 40,000 characters and cut past that with the cut marked, so the drafting step reads what was sent and not its name. Images and PDFs are named and never opened.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/asked.mjs
