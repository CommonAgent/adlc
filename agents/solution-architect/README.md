# Solution architect

This agent holds the [solution architect](https://agentroles.ai/solution-architect.html)
role: the Architecture part of the Architecture and Design stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html). It
comes before the Design, which the [spec writer](../spec-writer) and the
[solution planner](../solution-planner) hold.

It takes the statement of a job and the organization's stack, and writes the
architecture record: the systems the agent reaches, in plain system words; the
product bound to each in dev, test and production, the organization's choice
first and the platform's default for the rest; the agent's dependencies, its
kind, its limits on cost, speed, data and trust, its egress per environment,
the formats at its edge and its settings; and every decision with its reason.
It asks what only a person can commit to (a binding nobody chose, a spending
limit, a destination beyond the derived set, access the statement never asked
for) and fills none of it in. It designs nothing.

The rules it applies are written down as the stage's standard, in
[references/architecture-standard.md](references/architecture-standard.md):
models are bound systems stated by capability and never named; what passes
between steps and agents is readable Markdown by default and specific JSON
kinds only for typed data code reads; addresses are never settings; settings
are declared with defaults.

## The record

A Markdown document for the person, with a structured header for the
bindings:

```
---
record: architecture-record-v1
statement: "an agent that reads a web page and writes the key points for a person to review"
environments: [dev, test, production]
kind: plugin-on-harness
done: no
questions: 2
systems: [text-reasoning]
bindings:
  text-reasoning:
    dev: google-gemini (platform)
    test: google-gemini (platform)
    production: google-gemini (platform)
---
```

then the fixed headings `## Statement`, `## Systems`, `## Bindings`,
`## Dependencies`, `## Kind`, `## Limits`, `## Egress`, `## Formats`,
`## Settings`, `## Decisions` and `## Questions`.
[references/a-record-that-works.md](references/a-record-that-works.md) is a
whole one. `scripts/architecture-record.mjs` writes and reads the form; the
spec writer carries a copy to read the record its Design is given.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- A text model for the one judgment in the job, bound as the `text-reasoning`
  system: `TEXT_API_KEY`, and `TEXT_MODEL`, which the install places from the
  binding. The package names no model and refuses to call one when
  `TEXT_MODEL` is empty. A name starting `google-vertex-anthropic/` is Claude on
  Google Vertex AI; a bare name is a Gemini model at Google.
- The platform's defaults, attached, or the copy in
  [references/house-stack.json](references/house-stack.json) (the system
  vocabulary as AgentMesh published it on 2026-10-27).

## Running it

This folder is a package source: `agent-descriptor.json`,
`agent-runtime-requirements.json`, `plugin.json`, a `SKILL.md` per skill, the
scripts, the references and the standing rules in `rules.md`.

```sh
node --test test/*.test.mjs                        # the suite
python3 ../package-maker/build.py . ./out          # an Agent Package
```

Install the package on any host that runs Agent Packages, bind
`text-reasoning`, and send it a statement.

## Replacing it

This is a reference implementation. Any agent, or a person, that holds the
solution architect role can take its place, and the record is checked the
same way: the package maker builds a package whose systems equal the record's,
and the deployment manager places the bindings it names.
