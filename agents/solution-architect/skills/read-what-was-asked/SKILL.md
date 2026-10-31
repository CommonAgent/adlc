---
name: read-what-was-asked
description: the first step of an architecture job, before anything is decided
---

# Read what was asked

Part of solution-architect. the first step of an architecture job, before anything is decided

## When to use this

the first step of an architecture job, before anything is decided

## What a good result looks like

A record of the request as it arrived: the statement, the organization's stack and the platform's defaults told apart by what is in them, any earlier record, and the answers to its questions, with what the job goes without written down.

## When it comes back empty

If no statement arrived, or the message asks for the statement, the design or the agent that does a step, this step stops the job with a reply that says so, and no model is woken. A revision with no record to revise stops the same way.

## How to do it

Nothing in this folder is run on its own; the write-the-architecture and revise-the-architecture skills name the commands that do the whole job, and this skill only explains what its command does for this step.

asked.mjs writes records/<job>/asked.json. Where the host gives the inbox entry itself (MESH_MESSAGE_FILE, as every container agent is given), the words and files are read from it exactly as sent, and TEXT_FILE and FILES fill only what it lacks. A stack is JSON with bindings; the platform's defaults are JSON whose systems each carry the House Stack's product; the build's settled answers are JSON with `settled_answers` and a list of answers, each with where it came from; an earlier record opens with the record's own header; anything else that reads as text is more of the statement. A message with a record, or one that opens by revising or answering, is a revision: each `key: answer` line under a key the record asked is an answer, and the rest is the change. Without a stack it notes that every binding will be a default; without the platform's defaults it takes the copy this package carries and notes its date.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/asked.mjs
- scripts/architecture-record.mjs
- scripts/bind.mjs
- scripts/went-without.mjs
- scripts/settled.mjs
- scripts/no-provider.mjs

## References

- references/house-stack.json
