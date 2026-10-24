---
name: publish
description: when a piece of work is finished and somebody needs an address they can open, or send to somebody else
---

# Publish

Part of publisher. when a piece of work is finished and somebody needs an address they can open, or send to somebody else

## When to use this

when a piece of work is finished and somebody needs an address they can open, or send to somebody else

## What this needs

- the files (document, required)
- name (identifier, optional)
- notes (text, optional)

## What a good result looks like

An address that opens, serving exactly the bytes that were handed over, with the digest of each file recorded beside the address so anybody can check later that what is served is what was published.

## What it produces

- address (url, per task)
- publication record (application/json, per task)

## When it comes back empty

If a file was not handed over, it is not published: this job does not go and fetch one. If what is served does not match what was handed over, the address is not given as good, and the reply says what differs.

## How to do it

Run `NAME=<slug> node scripts/publish.mjs --job <job folder> --records <records folder> --file <path>::<media type> ...`. It runs the three steps in order and prints one JSON object with a `reply` field. It calls no model: every step is a written procedure and this is the program that runs it.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/publish.mjs
- scripts/place.mjs
- scripts/inspect.mjs
- scripts/pieces.mjs

## References

- references/what-it-will-not-publish.md
