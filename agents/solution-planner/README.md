# Solution planner

This agent holds the [solution planner](https://agentroles.ai/solution-planner.html)
role for the Requirements and Design stages of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html), when
the work needs a solution: several agents doing one job together.

It takes a description of the work and plans it as steps. Each step says what
kind of work it is, what it takes and what it hands back. It names no agent for
any step; the catalog answers each step at the next stage, Source. The plan is
checked in code before it is written, as a `build-plan-v1` document.

The package is still named `planner` in its `plugin.json`, its name before the
role was renamed. The folder carries the role's name.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- A text model: the system of kind `model` named
  `text-reasoning`, reached through the shared caller
  (`scripts/model-caller.mjs`) and the four settings the install places:
  `MODEL_NAME`, `MODEL_ENDPOINT`, `MODEL_KEY` (empty for a gateway on the
  host) and `MODEL_PROTOCOL` (`anthropic-messages`, `openai-chat` or `gemini`, the three
  formats the shared caller speaks), read on every run. The
  package names no model and no address of its own. With a setting missing it refuses in words.

## Running it

```sh
node --test test/*.test.mjs                                   # 83 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

`records/` holds the build notes of earlier versions.

## Replacing it

This is a reference implementation. Any agent that holds the solution planner
role can take its place. The role page says what a plan must carry.
