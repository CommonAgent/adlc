# solution-architect 0.5.0: the record describes the software architecture

Date: 2026-11-11.

## Why

Jeff Schneider read the console's Architecture view for an agent and said
its limits (spend, speed, data, trust, network) are not architectural
decisions. The record held the systems, the bindings, the dependencies, the
kind, the limits, the decisions and the egress, and said it designed
nothing. It said nothing about what the agent is made of: its components
and what each is responsible for, how they are joined, how it runs, and how
its data moves. Architecture standard 2.0.0 adds those views, makes the
limits drivers the decisions cite, and makes each decision about structure
an architecture decision record.

## What changed (from 0.4.0)

- scripts/views.mjs (new): draws the components (the carrier from the kind,
  a skill per offering, a script per skill, the parts of each script, the
  outside systems), the connectors (from the systems and their bindings),
  the runtime and deployment view and the data flow, builds the drivers
  (cost, speed, data and trust first, then the spec's constraints, then any
  other the statement states), and holds them to the standard's sections 12
  to 17: every component has a responsibility, every connector names both
  ends, the flow has steps, every decision about structure has its drivers,
  an alternative and its consequences, and no limit is a decision.
- scripts/name.mjs: the model is asked for the skills, the parts with their
  responsibilities, the data flow, any further drivers, and each decision
  about structure with its context, drivers, alternatives and consequences.
  It is told the rulings are written for it and a limit is never a decision.
  A spec's offerings and constraints are in the request where a spec came.
- scripts/standard.mjs: the findings cover the views. A decision that only
  states a limit is a finding, and code takes it out. A spending limit set
  in an answer is the cost driver, not a decision. The cost an earlier round
  settled is read from the header's `cost_limit` first.
- scripts/settled.mjs, scripts/bind.mjs and the grants in standard.mjs and
  name.mjs: each decision they write is a ruling. A settled spending limit
  is the cost driver.
- scripts/architecture-record.mjs: the body gains `## Components`,
  `## Connectors`, `## Runtime and deployment` and `## Data flow`, and
  `## Drivers` takes the place of `## Limits`, each driver saying which
  decisions cite it. Decisions about structure come first, in the manner of
  an architecture decision record; the rulings follow in their earlier form.
  The header is unchanged. The spec writer's copy is the same file.
- scripts/check-record.mjs: draws the views, holds the record to them, and
  says in what changed which drivers changed.
- scripts/asked.mjs: an attached spec (spec-v1) is read for its offerings
  and its constraints.
- The descriptor, plugin.json, the skills, rules.md, README.md and the
  reference record name the new sections. standards-pins.json pins
  architecture-standard.md 2.0.0.
- test/views.test.mjs (new) and test/hn-digest.test.mjs: the hn-digest case,
  with the model's answer replayed, carries the components, connectors,
  runtime, flow, drivers and four decisions about structure the standard
  gives as its worked example. The finished record is the spec writer's
  test fixture, byte for byte.

146 tests, 145 pass, 1 skipped. Written by the harness (Claude Code)
directly; no model was run.
