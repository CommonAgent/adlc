---
name: read-the-spec
description: the first step, before anything is written
---

# Read the spec

Part of test-writer. the first step, before anything is written

## When to use this

the first step, before anything is written

## What a good result looks like

A record of what the spec declares that a suite can hold the scripts to: per job the four sentences, what it takes and produces, the scripts it names and the command lines the harness runs with their variables; for the package the records, the refusals and the systems with their variables.

## When it comes back empty

If what arrived is not a spec, this step stops the job with a reply saying what a spec carries. No model is woken.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

declared.mjs writes records/<job>/declared.json: per job the four sentences, inputs and outputs, the scripts named and the command lines read out of the instructions with the variables set before node and the flags after; for the package every script once, the records, the refusals, the systems and their variables. It decides nothing about what is worth testing, because that is a judgment and it belongs to the writing step.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/declared.mjs
