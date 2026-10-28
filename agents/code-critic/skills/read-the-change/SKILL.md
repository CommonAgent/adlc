---
name: read-the-change
description: the first step, before anything is judged
---

# Read the change

Part of code-critic. the first step, before anything is judged

## When to use this

the first step, before anything is judged

## What a good result looks like

A record of what was given: every file of the package laid out under its own path, each read as a declaration, a script, a test, a reference or other, with its size and digest; whether the change is a diff or the whole package, and for a diff the lines it adds in each file; and whether the Code stage's account and an earlier findings document came.

## When it comes back empty

If nothing attached is a script or a declaration, the job stops here with a reply saying what a review is given. No model is called.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

read-change.mjs reads what was attached. A tar.gz or tar is unpacked with its paths, and one folder around everything is taken off. Loose files are found by content: the agent's own files the way the builder finds them, a script or a reference put back where plugin.json's build entry names it, a file that imports node:test under test/. A unified diff, the account (Markdown that says it is an account) and an earlier review by this agent (its header names reviewed_by: code-critic) are kept apart. The diff's paths are matched to the package's by their ends. Nothing is judged here.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/read-change.mjs
- scripts/agent-folder.mjs
