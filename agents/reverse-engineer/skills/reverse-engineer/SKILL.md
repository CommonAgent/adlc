---
name: reverse-engineer
description: When an existing codebase is taken on, or when its code changed outside the lifecycle: somebody has to say what the code is before anybody decides what to keep. This is the Reverse engineering stage (00) of the Agent Development Lifecycle.
---

# Describe a codebase

Part of reverse-engineer. When an existing codebase is taken on, or when its code changed outside the lifecycle: somebody has to say what the code is before anybody decides what to keep. This is the Reverse engineering stage (00) of the Agent Development Lifecycle.

## When to use this

On adoption, when an existing codebase is taken on at a named commit. On drift, when the code's commit differs from the last one any build knew: give it the last as-built record too, and it covers only what changed since that record's commit. A codebase that lives fully inside the lifecycle does not need it again.

## What this needs

- codebase (application/gzip, required; run as a command, `--codebase <folder>` instead)
- repository (url, required: a `repository:` line)
- commit (identifier, required: a `commit:` line)
- last as-built record (application/vnd.agentmesh.as-built-record+json, optional: makes the job drift)
- last behaviors (application/vnd.agentmesh.as-built-behaviors+json, optional)
- the settings `may_run` (no or yes, default no) and `baseline_seconds` (30 to 600, default 300)

## What a good result looks like

An as-built record tied to the repository, the commit digest and the read mode, in five parts: behaviors, architecture as built, interfaces (with schemas where they can be derived), a CycloneDX bill of materials, and the existing tests and gaps. Every claim names a file and line at the commit, or the observed run, and every one was checked against the code. Nothing judges the code and nothing is inferred beyond the evidence: a drafted claim that did either, or whose evidence did not check, is listed as a gap with the reason. Every gap is marked. On drift, nothing that did not change is described again.

## What it produces

- as-built record (application/vnd.agentmesh.as-built-record+json, per task)
- behaviors (application/vnd.agentmesh.as-built-behaviors+json, per task)
- architecture as built (application/vnd.agentmesh.as-built-architecture+json, per task)
- interfaces (application/vnd.agentmesh.as-built-interfaces+json, per task)
- openapi (application/vnd.oai.openapi+json, per task, when one is found or derived)
- json schema (application/schema+json, per task, when one is found or derived)
- dependencies (application/vnd.cyclonedx+json, per task)
- existing tests and gaps (application/vnd.agentmesh.as-built-tests-and-gaps+json, per task)

## When it comes back empty

Without the repository, the commit or the codebase, it writes nothing and replies with what it needs (exit 3). A checkout at another commit, or with tracked files changed, stops it too: the record would not be the commit's. Without a model, it still writes the parts read by rule (the settings, entry points, bill of materials, test files and the run) and lists the drafted parts as gaps. Asked whether something is a bug, or to write tests, it says no and still writes the record.

## How to do it

Run `node scripts/describe.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <message file> [--codebase <folder>] [--repository <address>] [--commit <digest>] [--may-run yes|no] [--file <path>::<media type>]...`. It runs the six steps in order and prints one JSON object with a `reply` field. The model is reached through the shared caller with the four model settings (MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY, MODEL_PROTOCOL). Read rules.md and references/the-as-built-record.md.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/describe.mjs
- scripts/read-request.mjs
- scripts/run-config.mjs
- scripts/archive.mjs
- scripts/codebase.mjs
- scripts/facts.mjs
- scripts/sbom.mjs
- scripts/baseline.mjs
- scripts/draft.mjs
- scripts/model-caller.mjs
- scripts/evidence.mjs
- scripts/record.mjs
- scripts/pieces.mjs
- scripts/declines.mjs
- scripts/went-without.mjs

## References

- references/the-as-built-record.md
- references/rules.md
- references/architecture-standard.md
