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

Read every program the package carries as text with scripts/trace-programs.mjs, every address in it counted, comments included, and a test left out only when nothing traced loads it, for each address it writes down, each call to an address the program is handed, each environment variable that holds a credential, each command it starts, and whether a browser it drives routes its requests. Match each address by evidence only: the platform's own address for a system the package declares, the architecture record's egress (scripts/architecture.mjs reads the record), or a system whose reason names it. Name what nothing matches as undeclared. Separately, and the same way on every run, list every address literal a script carries (Common Agent 12.10: a scheme of http, https, ws or wss and ://, or an address in 169.254.0.0/16, comments included, outside the seven excepted identifier prefixes) and the metadata server's host name, each with its file and line, as a warning; a model service's own address is listed like any other. A declared system of kind model, reached through MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, is a declared reach, and those four are its settings and never an undeclared credential. Run nothing: an address built at run time from parts it computes is not seen, and the review says so. Write <records>/<job id>/traced.json.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/trace-programs.mjs
- scripts/architecture.mjs

## References

- references/what-the-platform-holds-it-to.md
