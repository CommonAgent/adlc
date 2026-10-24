---
name: prove-a-suite
description: when a package has both its scripts and its suite and somebody wants to know whether the suite would notice the scripts being wrong
---

# Prove a suite

Part of test-writer. when a package has both its scripts and its suite and somebody wants to know whether the suite would notice the scripts being wrong

## When to use this

when a package has both its scripts and its suite and somebody wants to know whether the suite would notice the scripts being wrong

## What this needs

- the package folder on this host (text, required)

## What a good result looks like

A verdict in words: whether the suite passes against the package's own scripts, and, with each script blanked in turn, which ones the suite noticed going missing and which it did not, by name.

## What it produces

- the verdict (text/plain, per task)

## When it comes back empty

If the folder named has no test files or no scripts, nothing is run and the reply says which is missing. Whatever fails, no test is edited to make a run pass; a failure against real scripts belongs to whoever owns the scripts.

## How to do it

Nothing in this package runs on its own. The message names a folder on this host on a `package folder: <absolute path>` line; it holds spec.json, scripts/ and test/. RECORDS is the records directory this agent was installed with, with this job's own folder under it.

1. SPEC=<folder>/spec.json RECORDS=<records folder> node ~/test-writer/skills/prove-a-suite/scripts/declared.mjs

2. SUITE=<folder> SPEC=<folder>/spec.json AGAINST=<folder> RECORDS=<records folder> node ~/test-writer/skills/prove-a-suite/scripts/check-suite.mjs

3. RECORDS=<records folder> node ~/test-writer/skills/prove-a-suite/scripts/reply.mjs

The last one's `reply` field is your whole answer; print it and nothing else. When the second exits 3 there is no suite under the folder; say so. No pieces are filed for this job: the verdict is the reply, and the record is records/<job>/checked.json.

Never edit a test or a script in the folder, whatever the run says.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/declared.mjs
- scripts/check-suite.mjs
- scripts/reply.mjs
- scripts/went-without.mjs

## References

- references/rules.md
