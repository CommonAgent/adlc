# spec-writer 0.5.5: the agent files carry a setting's range and an offering's example

Date: 2026-10-28.

## Why

The package maker now carries an offering's `example` (Common Agent 6.13.8,
proposed), and it already carried a numeric setting's `range` (6.13.4). The
agent files this agent writes from a draft (scripts/files.mjs) are the
builder's own bytes, and they left both out, so a folder that states them did
not come back as itself. The usability tester's folder, the first to state
both, found it.

## What changed

- scripts/files.mjs writes a setting's `range` as written, and an offering's
  `example` (`inputs` and `good_result`), in the places build.py writes them.

## Tests

The spec writer's suite passes, with every agent folder in the repository,
the usability tester's included, coming back as itself.

## Who held each step

The harness (Claude Code) wrote the change on the owner's instruction of
2026-10-28, as part of the Usability stage. This version is not released to
dev with that change.
