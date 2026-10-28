---
name: trace-the-programs
description: the second step of a review, reading every program for what it reaches and matching it to what the package declares
---

# Trace the programs

Part of security-reviewer, the second step of Review a package.

## What it does

Reads every program the package carries as text (`scripts/trace-programs.mjs`), with comments and tests left out, for each address written where it is fetched or called, each call to an address the program is handed, each environment variable that holds a credential, each command it starts, and whether a browser it drives routes its requests. Each address is matched to a declared system by evidence only: the platform's own address for a system the package declares, a system whose reason names it, or the architecture record's egress (`scripts/architecture.mjs` reads the record). What nothing matches is named as undeclared. It writes `<records>/<job id>/traced.json`.

## What it cannot see

It runs nothing. An address a program builds at run time from parts it computes is not seen, and the review says so.

## Scripts

- scripts/trace-programs.mjs
- scripts/architecture.mjs
