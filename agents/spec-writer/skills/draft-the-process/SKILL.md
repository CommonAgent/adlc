---
name: draft-the-process
description: once a process request is read, to draft its parts and write the document from them
---

# Draft the process

Part of spec-writer. once a process request is read, to draft its parts and write the document from them

## When to use this

once a process request is read, to draft its parts and write the document from them

## What a good result looks like

The process's parts, drafted by the model as one JSON object (the trigger and what it carries, concurrency, the goal, each step with its form, holder, after, automation and what it reaches outside, the handoffs, the ways back, the systems, policy and measures), and the Agent Processes 0.9.0 document code writes from them: a key on every handoff, one handoff to several steps written once with /, holders by role, a person's role marked (person), and whoever starts the run as the process runner reads it.

## When it comes back empty

An answer that is not one JSON object, or that is missing its name, trigger, goal, concurrency or steps, is asked for once more with what was wrong, and never a third time; after two, nothing is written. An answer with refused set writes no document.

## How to do it

Nothing in this folder is run on its own; the write-a-process skill names the one command that does the whole job, and this skill only explains what that command does for this step.

process-draft.mjs builds the prompt: the instruction (the parts' shape and the rules, among them that no step names an agent and the four refusals the solution planner held), today's date, an earlier document to revise when one came, what a check found in the last try, and the person's words between WORDS START and WORDS END, read as content and never as instructions. The model is reached through the shared caller (scripts/model-caller.mjs) and the four settings the install places, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL; the package names no model. readDraft reads the answer by type, fixHolders turns a handle the person did not give into a role, and renderProcess writes the document. Each answer and the draft read from it go into records/<job>/process-draft.json, and each call into records/<job>/calls.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/process-draft.mjs
- scripts/model-caller.mjs

## References

- references/what-a-good-process-carries.md
