---
name: read-the-process
description: the first step of reviewing a process, before anything is judged
---

# Read the process

Part of code-critic. the first step of reviewing a process, before anything is judged

## When to use this

the first step of reviewing a process, before anything is judged

## What a good result looks like

The process document found among what was given, by its content, and read the way the process runner reads it: its phases, handoffs, ways back, bindings and extensions, each with its line.

## When it comes back empty

If nothing given is a process document, this is not a process review: the job reviews what was given as a package instead.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

scripts/process-review.mjs finds the process document by its content (a PROCESS: line and a phases: part), attached or in the message, and scripts/process-check.mjs reads it the way the process runner does. Nothing is judged here.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/process-review.mjs
- scripts/process-check.mjs
