# code-writer 0.2.6: its copy of agent-folder.mjs carries protocols

Date: 2026-10-29.

## Why

agent-folder.mjs reads an agent's own files the way the builder does. It is kept once, in the spec writer, and copied byte for byte into each agent that reads an agent's files; package-maker's test_folder holds every copy to it. The builder now carries a model system's `protocols` from agent-runtime-requirements.json into the spec it builds (adlc #69), and spec-writer 0.6.0's master does the same.

## What changed

Only scripts/agent-folder.mjs, now the master's bytes, and the version.

## Tests

38 of 38 pass; package-maker's test_folder passes.

## Who held each step

The owner approved this release with the six model-system agents. The harness (Claude Code) laid the copy from spec-writer's master, which went through the lifecycle with spec-writer 0.6.0.
