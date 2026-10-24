---
name: check-it-builds
description: once a draft exists, to find out whether the builder will take it
---

# Check it builds

Part of spec-writer. once a draft exists, to find out whether the builder will take it

## When to use this

once a draft exists, to find out whether the builder will take it

## What a good result looks like

The builder's own verdict on the draft, in the builder's own words, with the caveat that what was checked is the declaration and not the package, because the files the spec names do not exist yet.

## When it comes back empty

If the builder is not on this host, the reply says that nothing checked whether the spec builds, and says it as unknown rather than as passed. The draft still goes.

## How to do it

Nothing in this folder is run on its own; the write-a-spec skill names the one command that does the whole job, and this skill only explains what that command does for this step.

builds.mjs writes the draft to a folder of its own and stands in an empty file for every member the spec names, because the builder copies every named member into the package before it validates a single declaration, and a spec with no files beside it would fail at the copy and never reach the checks that matter. The stand-ins are empty on purpose: plausible content would make a package that looks built and runs nothing. Which files were stood in for is recorded and said in the reply every time, so nothing here ever claims the package builds. A member whose path would climb out of the package folder is refused before anything is written. The record is records/<job>/builds.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/builds.mjs
