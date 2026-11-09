---
name: read-the-codebase
description: At the start of every job, before anything is drafted.
---

# Read the codebase

Part of reverse-engineer. At the start of every job, before anything is drafted.

## When to use this

At the start of every job, before anything is drafted.

## What a good result looks like

The codebase opened at the named commit. In a git checkout, the commit is the one checked out and no tracked file has changed, and the files read are the ones git tracks. A folder with no history is read whole, leaving out installed and built folders, and the commit is marked as taken as given. Read off by rule, each with its file and line: the environment variables the code reads (by name, never by value, and marked as credentials by their names), the entry points and how the code starts (package.json, a Dockerfile, a Procfile), the test files and their cases, the project's own test command (node --test over its node:test files when package.json names none), the OpenAPI and JSON Schema documents it carries, the run-config settings an Agent Package declares, and the surface of its JavaScript: each module's exports and who imports them, the commands and their flags, each file written and the shape of each JSON one, the regular expressions as written, the literal constants, and each import that leaves the codebase's folder.

## When it comes back empty

Without the repository, the commit or the codebase, or with a checkout at another commit or with changes, the job stops and the reply says what is needed.

## How to do it

`readRequest` in scripts/read-request.mjs, `openCodebase` in scripts/codebase.mjs, `readFacts` in scripts/facts.mjs, which calls `readSurface` in scripts/surface.mjs. It judges nothing and changes nothing.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/read-request.mjs
- scripts/run-config.mjs
- scripts/archive.mjs
- scripts/codebase.mjs
- scripts/facts.mjs
- scripts/surface.mjs
- scripts/js-source.mjs
