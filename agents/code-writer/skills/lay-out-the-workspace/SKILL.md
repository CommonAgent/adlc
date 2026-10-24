---
name: lay-out-the-workspace
description: first, before anything is written
---

# Lay out the workspace

Part of code-writer. first, before anything is written

## When to use this

first, before anything is written

## What a good result looks like

A folder holding the agent's own files (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and skills/<slug>/SKILL.md, or a spec.json where those did not come) and the suite as they arrived, a starting file for every script the spec names, stubbed with the functions the suite imports, the prototype under prototype/ to be read, and a record of every digest the check will hold the folder to.

## When it comes back empty

If no suite arrived, nothing is laid out and the job stops: the scripts are written to the suite, so without one there is nothing to write to. No model is woken.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that starts the job, and this skill only explains what that command does for this step.

workspace.mjs makes the workspace: the agent's own files (or a spec.json, still read for one transition, where they did not come) and every test file written as they arrived and their digests recorded; for each script the spec names, the prototype's own file when the prototype is already in the house stack and has a file at that path, otherwise a stub exporting every function the suite imports from it, each throwing until written; a named script that is not a module (a package.json, a data file) is the prototype's own bytes or left empty, never a JavaScript stub; everything else the prototype held under prototype/, read-only. Given FILES, the attached files, it sorts them itself by what is in them and reads each by its bytes, so nothing is copied on the job folder's mount. It writes records/<job>/workspace.json with the digests, the listing and the rounds ceiling, which is what the check compares against on every round.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/workspace.mjs
- scripts/agent-folder.mjs
