# reverse-engineer 0.3.1: pinned to architecture standard 1.1.0

Date: 2026-11-11.

## Why

The architecture standard changed (1.1.0): a keyless public service the
owner approves is a system of the record, bound to the service itself, and
the record's header gains `cost_limit`. This agent pins the standard, so it
is re-pinned and released with it.

## What changed (from 0.3.0)

standards-pins.json pins architecture-standard.md 1.1.0. Nothing this agent
writes changes: its as-built architecture follows the record's shape, and
the new binding and header field are the architect's to write.

72 tests, 71 pass, 1 skipped. Written by the harness (Claude Code) directly;
no model was run.
