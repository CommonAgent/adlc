# Spec writer

This agent holds the [spec writer](https://agentroles.ai/spec-writer.html) role
for the Requirements and Design stages of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

It takes what somebody wants an agent to do, in their own words, and writes
the agent's own files the package maker will take, the layout a package is
built from (`agent-descriptor.json`, `agent-runtime-requirements.json`,
`plugin.json` and a `SKILL.md` per skill): what the agent offers, what each
job takes and produces, what it refuses and what it records. It writes no
`spec.json`: the draft is its own working record, and the files are taken
from what the builder makes of it. It never invents the
three things only the person can decide (the name, the price and access to any
system), and it hands back the questions it could not settle instead of
guessing. The package maker's own check runs over every draft, so a draft that
will not build is caught here, and no files are delivered for it.

It holds the Design part of the Architecture and Design stage, after the
[solution architect](../solution-architect). Given the architecture record,
the draft declares exactly the systems the record names; a step that needs
another goes back to the architect as a question instead of into the draft.

## Standing assets

Given an architecture record, the draft declares exactly the standing assets
its `Standing assets` section decides, as `can_use` entries, each with
`reads`, `required`, `does` and `without`, and none where the record says
none (the architecture standard, section 10). The model drafts the entries;
`scripts/can-use.mjs` then takes out any the record did not decide, and adds
any it left out (or fills an empty member) from the house rule in
[`standards/standing-asset-schemas.json`](../../standards/standing-asset-schemas.json),
which this agent reads at the version [standards-pins.json](standards-pins.json)
pins (`test/standards-pins.test.mjs` holds the pin). The draft's notes say
what code changed.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- A text model for the one judgment in the job, bound as the `text-reasoning`
  system: `TEXT_API_KEY`, and `TEXT_MODEL` to pick the model, else the host's
  `AGENT_MODEL`. The package names no model; with neither set, the job is
  refused in words. A `google-vertex-anthropic/` name is Claude on Google
  Vertex AI, and a bare model name is a Gemini model.
- Python 3 and the package maker's `build.py` on the host to check each draft.
  It looks for `/opt/fleet/agentbuilder-build.py`; set `BUILD_PY` to point it
  at `../package-maker/build.py` or your own builder. Without one the files
  still go out, written by `scripts/files.mjs` (the builder's own projection,
  held to it byte for byte by `test/files.test.mjs`), and the reply says the
  build check did not run.

## Running it

This folder is a package source. Its offerings and steps are declared in
`agent-descriptor.json` and `agent-runtime-requirements.json`, each skill's
instructions are in `skills/<slug>/SKILL.md`, the scripts are in `scripts/`, and the standing rules the model
works under are in `rules.md` and `references/`.

```sh
node --test test/*.test.mjs                                   # 139 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

Install the package on any host that runs Agent Packages, bind
`text-reasoning`, and send it a request.

## Replacing it

This is a reference implementation. Any agent that holds the spec writer role
can take its place, and its output is checked the same way: files the package
maker accepts, with the open questions named.
