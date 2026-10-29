---
name: check-the-house-rules
description: the second step, before any model reads the change
---

# Check the house rules

Part of code-critic. the second step, before any model reads the change

## When to use this

the second step, before any model reads the change

## What a good result looks like

Findings for each house rule the package breaks where a program can see it, each with a file, a line, a claim and a consequence, split into those inside the change and those outside it when a diff came.

## When it comes back empty

A package that breaks no house rule gives an empty list, which is a result and not a failure.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

house-rules.mjs reads the laid-out files as text and never runs them. It runs before the model is asked, and gives the same answer every run. It looks for a model's name in a code line of a script, a skill or a declaration, a model reached except through the four model settings and the shared caller, and a model system that names a credential, a variable or settings of its own; every address literal a script carries (Common Agent 12.10, comments included, outside the seven excepted identifier prefixes) and the metadata server's host name, each listed as a warning with its file and line, a model service's own address like any other, in a section of its own that a reason does not close and that does not count among the open findings; a bare application/json, a piece sent as another kind than declared or filed under the wrong extension; a piece no output declares; a declared record nothing writes, a record written and not declared, a credential no system binds, a how the scripts do not bear out; and, with a diff, an access a declaration adds. references/the-house-rules.md says why each one matters.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/house-rules.mjs

## References

- references/the-house-rules.md
