---
name: reverse-engineer
description: When an existing codebase is taken on, or its code changed outside the lifecycle: somebody has to say what the code is before anybody decides what to keep. This is the Reverse engineering stage (00) of the Agent Development Lifecycle. On drift, give it the last as-built record too, and it covers only what changed since that record's commit.
---

# Describe a codebase

Part of reverse-engineer. When an existing codebase is taken on, or its code changed outside the lifecycle: somebody has to say what the code is before anybody decides what to keep. This is the Reverse engineering stage (00) of the Agent Development Lifecycle. On drift, give it the last as-built record too, and it covers only what changed since that record's commit.

## When to use this

When an existing codebase is taken on, or its code changed outside the lifecycle: somebody has to say what the code is before anybody decides what to keep. This is the Reverse engineering stage (00) of the Agent Development Lifecycle. On drift, give it the last as-built record too, and it covers only what changed since that record's commit.

## What this needs

- codebase (application/gzip, required)
- repository (url, required)
- commit (identifier, required)
- last as-built record (application/vnd.agentmesh.as-built-record+json, optional)
- last behaviors (application/vnd.agentmesh.as-built-behaviors+json, optional)

## What a good result looks like

An as-built record tied to the repository, the commit digest and the read mode, in six parts: behaviors (one per anchor, each with a kind from the fixed list, its exact quotes and its rules), architecture as built, interfaces (the files written with their schemas and the allowed values of their fields, the exported functions, the commands with their flags and the flags they cannot run without, the exported constants with their values, and what the agent declares in its own files, read by rule, with the model's descriptions), a CycloneDX bill of materials, the existing tests and gaps, and strings.json, every string a person reads, every key (such as citation_title, dc.title, @graph) and every pattern in the scripts exactly as written. The original tests are carried byte for byte under tests/, with the files they import from outside the codebase under support/. A completeness check by code says, in record.json, that the record holds every export, file written, command's required flags, declaration and string, and lists anything missing as a gap. Every claim names a file and line at the commit, or the observed run, and every one was checked against the code. Nothing judges the code and nothing is inferred beyond the evidence: a drafted claim that did either, or whose evidence did not check, is listed as a gap with the reason. Every gap is marked. On drift, nothing that did not change is described again.

## What it produces

- as-built record (application/vnd.agentmesh.as-built-record+json, per task)
- behaviors (application/vnd.agentmesh.as-built-behaviors+json, per task)
- architecture as built (application/vnd.agentmesh.as-built-architecture+json, per task)
- interfaces (application/vnd.agentmesh.as-built-interfaces+json, per task)
- openapi (application/vnd.oai.openapi+json, per task)
- json schema (application/schema+json, per task)
- dependencies (application/vnd.cyclonedx+json, per task)
- existing tests and gaps (application/vnd.agentmesh.as-built-tests-and-gaps+json, per task)
- strings (application/vnd.agentmesh.as-built-strings+json, per task)
- carried test (application/octet-stream, per task)
- carried support file (application/octet-stream, per task)

## When it comes back empty

Without the repository, the commit or the codebase, it writes nothing and replies with what it needs (exit 3). A checkout at another commit, or with tracked files changed, stops it too: the record would not be the commit's. Without a model, it still writes the parts read by rule (the settings, entry points, bill of materials, test files and the run) and lists the drafted parts as gaps. Asked whether something is a bug, or to write tests, it says no and still writes the record.

## How to do it

Run `node scripts/describe.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <message file> [--codebase <folder>] [--repository <address>] [--commit <digest>] [--may-run yes|no] [--repository-root <folder>] [--file <path>::<media type>]...`. It runs the six steps in order and prints one JSON object with a `reply` field. On a host, the codebase comes as an attached gzip tar with its .git folder, and `repository:` and `commit:` come as lines in the message. The settings `may_run` (no or yes, default no) and `baseline_seconds` (30 to 600, default 300) say whether the tests run once, and for how long. `--repository-root` names the top of the repository the codebase sits in, where the files its tests import from outside it are read; without it, the top of the codebase's git checkout is used. The model is reached through the shared caller with the four model settings (MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY, MODEL_PROTOCOL). Read rules.md and references/the-as-built-record.md.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/describe.mjs
- scripts/read-request.mjs
- scripts/run-config.mjs
- scripts/archive.mjs
- scripts/codebase.mjs
- scripts/facts.mjs
- scripts/surface.mjs
- scripts/js-source.mjs
- scripts/declarations.mjs
- scripts/flags.mjs
- scripts/carried.mjs
- scripts/sbom.mjs
- scripts/baseline.mjs
- scripts/draft.mjs
- scripts/kinds.mjs
- scripts/model-caller.mjs
- scripts/evidence.mjs
- scripts/behaviors.mjs
- scripts/interfaces.mjs
- scripts/record.mjs
- scripts/pieces.mjs
- scripts/declines.mjs
- scripts/went-without.mjs

## References

- references/the-as-built-record.md
- references/rules.md
- references/architecture-standard.md
