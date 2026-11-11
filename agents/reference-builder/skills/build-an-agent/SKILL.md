---
name: build-an-agent
description: When a person wants an agent built through the ADLC with no one at the keyboard of the coding harness.
---

# Build an agent

Part of reference-builder. When a person wants an agent built through the ADLC with no one at the keyboard of the coding harness.

## When to use this

When a person wants an agent built through the ADLC with no one at the keyboard of the coding harness.

## What this needs

- request (text, required)

## What a good result looks like

A reply that names the build and the stage it is at, and either says every stage has passed or asks the one question that is the person's, so they can answer by naming the build.

## What it produces

- reply (text/markdown, per task)

## When it comes back empty

When the message has no words, it starts nothing and asks the person what the agent should do, in their own words.

## How to do it

Run the job's script with the person's message. It keeps each build under its id, starts the harness with /adlc:start on a new request, resumes it on an answer that names the build, and passes the person's approval through only when they say approve for that build.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/build-an-agent.mjs
