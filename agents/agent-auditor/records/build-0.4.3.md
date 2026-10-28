# agent-auditor 0.4.3: every agent is held to each check's level

Date: 2026-10-28.

## Why

There are no production customers, so there is no cutover date (Jeff,
2026-10-28). Every agent is treated like a new one: the refusals that were
warnings for an agent first released before a check's date are refusals for
every agent, and the checklist no longer keeps a second date for existing
agents.

## What changed

- **The checklist.** `standards/audit-checklist.md` gives every check
  `applies: every agent`; the explanation of `applies` says so. The pin in
  `standards-pins.json` is the new checklist's digest
  (sha256:f3d4227bf9c1332f081e7c24e6c66ee803efd54cd32c270b13fe7a390534d13d).
- **The level.** `levelFor` gives a check that applies to `every agent` its
  own level for every agent, whenever it was first released. A checklist that
  still gives the two dates (an organization's own) is read as before.
- **conformance-result is refuse:** a verdict that says does-not-conform holds an agent back like any other refusal; inconclusive stays a warning at most.
- `rules.md` says both.

## Tests

`node --test test/*.test.mjs`: 39 pass, two of them new (every agent refused
alike; the pinned checklist has no check with a later date for existing
agents). The standards tests check that every check applies to every agent.
