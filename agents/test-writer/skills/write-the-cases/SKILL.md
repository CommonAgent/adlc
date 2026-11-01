---
name: write-the-cases
description: once a process document is read, to draft its test cases and write each one pinned to the document
---

# Write the cases

Part of test-writer. once a process document is read, to draft its test cases and write each one pinned to the document

## When to use this

once a process document is read, to draft its test cases and write each one pinned to the document

## What a good result looks like

The cases drafted by the model as one JSON object (each with a name, what the run is handed, the answers in order, the stand-ins and what must be true at the end), and each case written by code in section 21's form with the document's id and its digest, the sha256 of its text with line endings as \n, so neither is ever the model's to get wrong.

## When it comes back empty

An answer that is not one JSON object with a list of cases is asked for once more with what was wrong, and never a third time; after two, no cases are written.

## How to do it

Nothing in this folder is run on its own; the write-test-cases skill says how the job is reached. test-cases.mjs builds the prompt: the instruction, the rule and what this document needs to keep it (its phases a person signs, its ways back with their keys, the items its trigger requires), what a last try missed, and the document between DOCUMENT START and DOCUMENT END, read as content and never as instructions. The model is reached through the shared caller (scripts/model-caller.mjs) and the four settings the install places, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL; the package names no model. Each answer and the cases read from it go into records/<job>/cases.json, and each call into records/<job>/calls.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/test-cases.mjs
- scripts/model-caller.mjs
- scripts/process-check.mjs
- scripts/check-cases.mjs
