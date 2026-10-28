---
name: trace-the-programs
description: second, once the declaration is read: to see what the programs reach that the declaration may not name
---

# Trace the programs

Part of security-reviewer. second, once the declaration is read: to see what the programs reach that the declaration may not name

## When to use this

second, once the declaration is read: to see what the programs reach that the declaration may not name

## What a good result looks like

Every address a program reaches, every call to an address it is handed, every credential variable it reads and every command it starts, each matched to a declared system by evidence or named as undeclared.

## When it comes back empty

A package with no programs is a harness reading skills: the review says what it reaches is what the harness's tools reach, and that the egress allow-list is what bounds it.

## How to do it

Read every program the package carries as text with scripts/trace-programs.mjs, comments, patterns and tests left out, for each address written where it is fetched or called, each call to an address the program is handed, each environment variable that holds a credential, each command it starts, and whether a browser it drives routes its requests. Match each address by evidence only: the platform's own address for a system the package declares, the architecture record's egress (scripts/architecture.mjs reads the record), or a system whose reason names it. Name what nothing matches as undeclared. Run nothing: an address built at run time from parts it computes is not seen, and the review says so. Write <records>/<job id>/traced.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/trace-programs.mjs
- scripts/architecture.mjs

## References

- references/what-the-platform-holds-it-to.md
