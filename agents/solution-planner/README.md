# Solution planner

This agent holds the [solution planner](https://agentroles.ai/solution-planner.html)
role for the Requirements and Design stages of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html), when
the work needs a solution: several agents doing one job together.

It takes a description of the work and plans it as steps. Each step says what
kind of work it is, what it takes and what it hands back. It names no agent for
any step; the catalog answers each step at the next stage, Source. The plan is
checked in code before it is written, as a `build-plan-v1` document.

The package is still named `planner` inside `spec.json`, its name before the
role was renamed. The folder carries the role's name.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- A text model, bound as the `text-reasoning` system: `TEXT_API_KEY`, and
  `TEXT_MODEL` to pick the model. The default is Claude on Google Vertex AI.

## Running it

```sh
node --test test/*.test.mjs                                   # 81 tests
python3 ../package-maker/build.py spec.json ./out             # an Agent Package
```

`records/` holds the build notes of earlier versions.

## Replacing it

This is a reference implementation. Any agent that holds the solution planner
role can take its place. The role page says what a plan must carry.
