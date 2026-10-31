---
name: check-the-suite
description: once a suite exists, to run it against nothing and, when the scripts exist, against them
---

# Check the suite

Part of test-writer. once a suite exists, to run it against nothing and, when the scripts exist, against them

## When to use this

once a suite exists, to run it against nothing and, when the scripts exist, against them

## What a good result looks like

The stand-in run's numbers and, when a package was named, the real run's and one run per blanked script, with a verdict in words that names any script the suite did not notice going missing.

## When it comes back empty

If there is no test file under the folder named, nothing is run and the reply says so. A run that does not finish in two minutes is recorded as a fault in the suite, not waited on.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

check-suite.mjs stands in an empty file for every script the spec names, places the suite beside them and runs it with node --test; it must fail. It runs the suite again beside the agent's own files with every script stood in by a module that exports the names the suite imports and does nothing, and names each test that touches no script and still fails there: no script can ever make such a test pass. Given AGAINST, a package folder with scripts, it copies the package without its own test folder, places the suite, runs it, and then blanks each script in turn and runs again; a script whose absence the suite never notices is named. The record is records/<job>/checked.json and the verdict is written in words for the reply. Nothing here edits a test.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/check-suite.mjs
- scripts/agent-folder.mjs
