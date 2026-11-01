---
name: check-the-process
description: once a process document is written, to check it against Agent Processes 0.9.0 before it is handed back
---

# Check the process

Part of spec-writer. once a process document is written, to check it against Agent Processes 0.9.0 before it is handed back

## When to use this

once a process document is written, to check it against Agent Processes 0.9.0 before it is handed back

## What a good result looks like

The process check's reading of the document: every §17.1 conformance item it fails, by section, and its findings against the four tests of §20.1 (a line the specification does not define outside extensions:, the trigger's items with one name twice, a handoff naming a phase that does not exist, a gate with nobody to sign it), with the document's digest. A document that conforms and has no findings goes on; one that does not goes back to the model once with what was found.

## When it comes back empty

What is still wrong after the second go is not hidden: the reply says it, and it is asked as an open question under `conformance` or `findings` in what is still open.

## How to do it

Nothing in this folder is run on its own; the write-a-process skill names the one command that does the whole job. scripts/process-check.mjs is standards/process-check.mjs from this repository, byte for byte (test/process-job.test.mjs holds the copy to it). It can also be run by hand over any document: node scripts/process-check.mjs <document> [--json]. The last reading is records/<job>/process-check.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/process-check.mjs
