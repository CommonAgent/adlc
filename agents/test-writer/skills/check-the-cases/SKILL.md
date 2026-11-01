---
name: check-the-cases
description: once a process's test cases are written, to refuse them unless every approval is answered every way and every way back is taken
---

# Check the cases

Part of test-writer. once a process's test cases are written, to refuse them unless every approval is answered every way and every way back is taken

## When to use this

once a process's test cases are written, to refuse them unless every approval is answered every way and every way back is taken

## What a good result looks like

A verdict on the suite: whether every phase a person signs (automation: never or supervised) is answered approve, changes and reject in at least one case, and every way back taken in at least one, with which case does each, and every case read against the document: written for its id and its digest, naming only its phases, items and ways back, carrying every item the trigger requires, each answer approve, changes: with words, or reject: with a reason.

## When it comes back empty

With no *.test.txt files there is nothing to check, and it says so. A suite short of the rule is refused, naming each answer and each way back no case gives; nothing here writes the missing case.

## How to do it

Nothing in this folder is run on its own; test-cases.mjs runs the check over the cases it writes. By hand: node scripts/check-cases.mjs --process <document> <case file or folder>... It prints one JSON object (ok, covered, missing, problems, reply) and exits 0 when the suite covers the rule and 1 when it is refused; with RECORDS set it keeps the reading as records/<job>/cases-checked.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/check-cases.mjs
- scripts/process-check.mjs
