# reverse-engineer 0.3.2: pinned to architecture standard 2.0.0

Date: 2026-11-11.

## Why

The architecture standard changed (2.0.0): the record now describes the
software architecture, with the agent's components and their
responsibilities, the connectors between them, the runtime and deployment
view and the data flow; its limits are drivers the decisions cite; and each
decision about structure is an architecture decision record. This agent pins
the standard, so it is re-pinned and released with it.

## What changed (from 0.3.1)

standards-pins.json pins architecture-standard.md 2.0.0. Nothing this agent
writes changes yet: its as-built architecture keeps the shape it had, and
giving it the record's views (the parts it reads become components) is left
for a change of its own.

72 tests, 71 pass, 1 skipped. Written by the harness (Claude Code) directly;
no model was run.
