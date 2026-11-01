---
name: review-a-process
description: when a process document is ready for review before it is wired, tested or installed, and somebody wants to know whether its approvals are where they belong and nothing it does to the world goes without a person's yes
---

# Review a process

Part of security-reviewer. when a process document is ready for review before it is wired, tested or installed, and somebody wants to know whether its approvals are where they belong and nothing it does to the world goes without a person's yes

## When to use this

when a process document is ready for review before it is wired, tested or installed, and somebody wants to know whether its approvals are where they belong and nothing it does to the world goes without a person's yes

## What this needs

- the process document (text/vnd.agentprocesses.process, required)

## What a good result looks like

It writes one security review in this agent's format, security-review-v1: front matter with the process, its shape digest, the verdict, what it reaches, what it must never do, what has no recorded reason and what refused it, then the same headings as a package's review, and it refuses a process in which a step acts in the world with no person's yes before it. Each problem is placed at its line of the document: a phase that sends, posts, publishes, pays or signs with no person's yes before it; a gate whose document says no reason; a line outside the extensions block; an extension line that changes the work; and every section 17.1 item the document fails. No grade and no fix.

## What it produces

- security review (text/markdown, per task)

## When it comes back empty

A document with nothing against the process rules says so. Nothing here calls a model, so the review never goes without one.

## How to do it

The job command (review-a-package's) finds a process document among what was attached, or in the message, by its content, and reviews it here instead of as a package: scripts/review-process.mjs reads it, scripts/process-rules.mjs (standards/process-rules.mjs byte for byte, on top of scripts/process-check.mjs) holds it to the rules, and the findings are filed as the one piece. Never change the document.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/review-process.mjs
- scripts/process-rules.mjs
- scripts/process-check.mjs
