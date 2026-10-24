---
name: check-the-work
description: as often as the writer likes, and it decides when the writer is done
---

# Check the work

Part of code-writer. as often as the writer likes, and it decides when the writer is done

## When to use this

as often as the writer likes, and it decides when the writer is done

## What a good result looks like

One round appended to the record: the suite's numbers and each failing test by name; and on a pass, whether each script blanked in turn is noticed, whether the builder takes the package when the builder is on this host, and whether the fence held.

## When it comes back empty

If the fence was broken, the round names what was touched and nothing else is run until it is put back. If the rounds are used up, the check says so and stops the job. If the builder is not on this host, it says the package-maker will build it rather than saying it built.

## How to do it

Nothing in this folder is run on its own; the offering names the command, and this skill only explains what it does.

check.mjs compares every digest the workspace step recorded and refuses the round when a test, the spec or the prototype changed or anything was written outside scripts/ and the two record files. It runs the suite with node's runner and appends the round to records/<job>/runs.json with each failing test by name. On a pass it blanks each script in turn and runs again, runs the builder over the workspace when the builder is on this host, and writes records/<job>/verdict.json. Exit 0 done, 1 not yet, 3 fence broken, 4 rounds used up. A blanked script the suite did not notice is recorded and said, not held against the writer, because fixing it means writing a test.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/check.mjs
- scripts/workspace.mjs
