---
name: document-a-package
description: when somebody has to use or maintain an agent and needs its documentation, written from what the agent declares and what its records say
---

# Document a package

Part of doc-writer. when somebody has to use or maintain an agent and needs its documentation, written from what the agent declares and what its records say

## When to use this

when somebody has to use or maintain an agent and needs its documentation, written from what the agent declares and what its records say

## What this needs

- agent descriptor (application/vnd.agentmesh.agent-descriptor+json, any one of the declaration group)
- AgentDoc (application/vnd.agentmesh.agentdoc+json, any one of the declaration group)
- runtime requirements (application/vnd.agentmesh.agent-runtime-requirements+json, optional)
- verdicts (application/vnd.agentmesh.eval-record+json, optional)
- records (document, optional)

## What a good result looks like

Markdown documentation a stranger can use: what the agent does, where to send it work, each job with what to give it, what comes back, how it is done, its steps and an example from a real record, what it will not do, reaches, costs and leaves behind, and the verdicts about it. Every line ends with the place in a named source it came from, and everything the sources are silent on is listed under Not documented.

## What it produces

- documentation (text/markdown, per task)
- trace (application/vnd.agentmesh.doc-trace+json, per task, working out)

## When it comes back empty

With neither an agent descriptor nor an AgentDoc nothing is written, and the reply asks for one of them by name. With either, the documentation is written from what there is, and every missing source and every job with no record to show is said under Not documented.

## How to do it

Run `node scripts/document.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <job folder>/message.txt [--file <path>::<media type>]...`. The attached files are what it documents from, each told apart by what is in it; the message's words are not read for anything. It runs the four steps in order, keeps what was given, the documentation and the check in `<records folder>/<job id>/`, files the documentation and its trace as the job's pieces, and prints one JSON object with a `reply` field. When the check finds anything it delivers nothing, stops with exit 3 and the reply names the findings. It calls no model and reaches no network.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/document.mjs
- scripts/given.mjs
- scripts/templates.mjs
- scripts/write-docs.mjs
- scripts/check-docs.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs

## References

- references/how-a-line-is-traced.md
- references/rules.md
