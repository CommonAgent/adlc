---
name: test-usability
description: When an agent has passed Conformance and someone needs to know whether a person can actually use it, or when a sweep tests every agent. This is the usability tester role of the Usability stage, in the Prove phase of the Agent Development Lifecycle.
---

# Test an agent's usability

Part of usability-tester. When an agent has passed Conformance and someone needs to know whether a person can actually use it, or when a sweep tests every agent. This is the usability tester role of the Usability stage, in the Prove phase of the Agent Development Lifecycle.

## When to use this

When an agent has passed Conformance and someone needs to know whether a person can actually use it, or when a sweep tests every agent. This is the usability tester role of the Usability stage, in the Prove phase of the Agent Development Lifecycle.

## What this needs

- agent (text, required)
- judgment (text, optional)
- examples (application/vnd.agentmesh.usability-examples+json, optional)
- example files (document, optional)
- run-context (application/vnd.agentmesh.run-context+json, optional)

## What a good result looks like

One usability report with the YAML header an auditor reads, then for each offering whether its form could be filled from the Descriptor, whether a real run delivered in its declared form, whether the result can be read and whether a change came back, the descriptor checks, each finding labelled descriptor or agent with the stage that fixes it, a person's judgment when one was given, and what was not checked and why.

## What it produces

- usability report (text/markdown, per task)

## When it comes back empty

Without an agent named it writes no report and replies with how to ask (exit 3). An agent nobody answers to, or one that serves no Descriptor, is not tested, and the reply says so. An offering with no example, in the Descriptor or with the request, is reported as not run; the tester never makes up inputs.

## How to do it

Run `node scripts/test-usability.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <message file> [--file <path>::<media type>]...`. It runs the five steps in order and prints one JSON object with a `reply` field. It reads and runs the agent at MESH_API_BASE, as the install's account (TESTER_SESSION and TESTER_ACCOUNT) or a fresh test account made with TEST_ACCOUNT_KEY. It calls no model. Read rules.md and references/what-a-person-meets.md.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/test-usability.mjs
- scripts/read-request.mjs
- scripts/descriptor-checks.mjs
- scripts/form.mjs
- scripts/platform.mjs
- scripts/retry.mjs
- scripts/trial.mjs
- scripts/readable.mjs
- scripts/report.mjs
- scripts/revision.mjs
- scripts/run-config.mjs
- scripts/pieces.mjs
- scripts/tar.mjs
- scripts/went-without.mjs

## References

- references/what-a-person-meets.md
- references/rules.md
