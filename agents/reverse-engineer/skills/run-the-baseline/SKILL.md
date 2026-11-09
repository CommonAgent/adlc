---
name: run-the-baseline
description: When `may_run` is yes and package.json names a test script that is not npm's placeholder.
---

# Run the baseline

Part of reverse-engineer. When `may_run` is yes and package.json names a test script that is not npm's placeholder.

## When to use this

When `may_run` is yes and package.json names a test script that is not npm's placeholder.

## What a good result looks like

One run of the project's own test command, through the shell, in the codebase's folder, in a child process with a time limit, its whole process tree stopped when the limit passes. The child is handed only the variables it needs, by exact name, and a home and temporary folder of its own, so no credential of this agent reaches the code. Where the host can (unshare, on Linux) the run has no network; where it cannot, the record says the network was not cut off. The results: the exit code, whether it was stopped, the time, and the counts read from the runner's summary, with the last part of what it printed and its local paths written as `.`.

## When it comes back empty

Not allowed to run, or no test command: the record says why the run did not happen, and what the code does when it runs is a gap.

## How to do it

`runBaseline` in scripts/baseline.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/baseline.mjs
