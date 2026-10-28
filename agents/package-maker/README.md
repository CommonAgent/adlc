# Package maker

This agent holds the [package maker](https://agentroles.ai/package-maker.html)
role for the Package and Release stages of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html). On
AgentMesh it runs under its older name, agentbuilder.

It turns an agent's own files into an Agent Package in the open format at
[commonagent.net/package.html](https://commonagent.net/package.html). An agent
is kept the way that format says a package is authored (Common Agent 13.2):

- `agent-descriptor.json`, the draft descriptor: what the agent does, refuses,
  needs and must record;
- `agent-runtime-requirements.json`: what a host must have and bind;
- `plugin.json`: the manifest's own members (name, version, description,
  license, author, repository), and in its `net.agentdoc.package` entry one
  member that is the builder's alone, `build`, which lists the files each skill
  carries, so a script several skills run is kept once beside the agent;
- `skills/<slug>/SKILL.md`, one per offering and step.

Building checks those files, copies the skills and their files in, generates
NOT.md, RECORDS.md and SYSTEMS.md, and writes the manifest's digests. It adds
nothing the files did not say, and it refuses a folder that says something it
would not have written, naming the member. Every package it makes is a draft,
because it has not run the agent.

It still reads a `spec.json` (one description of the whole agent, which the
spec writer drafts and the rest of the lifecycle passes along), with a
warning, for one transition. `convert.py` turns a spec into the files above.
Files under the names used before Common Agent 0.30.0-draft (`descriptor.json`,
`install.json`, format `agent-install-v1`) are read with a warning too; what
it writes is always the current names.

## The parts

- `build.py` is the builder: `python3 build.py <agent folder> <out folder>`
  (or a `spec.json` in place of the folder). It prints one JSON line with the
  package's name, version, path and digests, and any warnings.
- `convert.py` writes an agent's own files from its spec:
  `python3 convert.py <spec.json> [<folder>]`.
- `compare-packages.py` is the gate the move from spec.json was held to: it
  builds each agent with the builder from before and with this one, from the
  folder and from the spec, and compares every file, allowing only the renamed
  files, pointer and format.
  It runs anywhere with Python 3, and it is what the other agents here use to
  check their own drafts.
- `pack.py` is the procedure the agent runs on a fleet host for a lifecycle
  run's work: it lays the delivered files out where the spec names them,
  builds, and files the tarball and a signed build record as the job's output.
- `request.py` files a built package with the operator's deploy queue.
- `provenance.mjs` is the optional required coder check. Set `REQUIRED_CODER` to
  a code writer's public key (one or several, comma separated) and the builder
  packs only scripts that writer delivered, traced through the signed delivery
  manifest. `OFFICIAL_CODER` is read too, as the older name. The host
  templates in `host/` set neither, so scripts from any code writer are packed.
- `repo.mjs` lays a built agent out as its own git repository.
- `shared/` holds rules shared with the AgentMesh services: connections,
  credit and trial declarations.
- `AGENTS.md` is the instructions the agent's harness reads.
- `host/` holds the agent's descriptor and listing, and the brain and pack
  script templates for a fleet host.

## The format and model rules, and the cut-over for existing agents

Since 2026-10-27 `build.py` holds every package to three rules, so that
what an agent declares it takes and hands on is what it really sends, and
so that a retired model is a setting changed rather than a broken agent:

1. **No bare `application/json`.** Every input and output kind is specific:
   `text/markdown` (with a light convention sketched in the piece's `about`)
   for content a person reviews or one agent hands to another, a vendor
   kind such as `application/vnd.agentmesh.<name>+json` for exact typed data
   only code reads, or another real media type. The four value kinds
   (`text`, `identifier`, `url`, `document`) are still read.
2. **No undeclared delivered piece, where the build can see one.** A literal
   piece entry (`{ name: "...", ..., media_type: "..." }`) in a job's
   `scripts/pieces*.mjs`, and every entry of the `pieces.json` at the top of
   the agent's folder or in a file `PIECES` names, must be a declared
   output, by its name or as `<output> (<file>)`. A name built at run time
   is not seen, and a `pieces.json` deeper in the folder (a test fixture,
   a leftover `out/`) is not the agent's delivery and is not read.
3. **No model named in a job's scripts or skills.** A model is a bound
   system (`text-reasoning`, `image-reading` and the like, access
   `trigger`); a script reads which model from `AGENT_MODEL` or
   `TEXT_MODEL` through the shared caller, so the install and a run config
   choose it. A literal name such as `gemini-2.5-flash`,
   `claude-sonnet-4-5` or `gpt-4o`, with or without a provider prefix, in a
   script (comment lines aside) or a SKILL.md is a finding. Brand reader
   shipped with one and answered 404 when the model was retired.

An input may also say who gives it, `given_by`: `person`, `agent` or
`either` (Common Agent 6.13, proposed and optional). Any other value is
refused.

What a finding does depends on the cut-over:

- **A new agent** (no release before 2026-10-27): its findings **refuse** the
  package, with each finding named.
- **An existing agent** (released before then): its findings are
  **warnings**, said on stderr and in the result's `warnings`, and the
  package is built as before.

The result, and the signed build record `pack.py` writes, carry
`format_rules`: `existing`, `mode` (`warn` or `refuse`), `since` and
`findings`. An agent is existing when its name is in
`FORMAT_EXISTING_NAMES` in `build.py`, the agents released when the rules
came in, or when the caller says `FORMAT_EXISTING=1`. `pack.py` says so
for a name this builder released before the rules: its last build record
of that name carries no `format_rules` and was written before 2026-10-27. A name first built under the rules
stays new, because its record says `existing: false`. `FORMAT_EXISTING=0`
treats a listed name as new.

To tighten the cut-over once the existing agents are fixed: remove each
fixed agent's name from `FORMAT_EXISTING_NAMES` as it is fixed (the list is
only ever shortened), or set `FORMAT_EXISTING_MODE = "refuse"` in
`build.py` to turn every existing agent's warnings into refusals at once.
The tests in `test_build.py` (`TheFormatRules`, `AModelIsABoundSystem`,
`WhereThePiecesAreRead`) and `test_pack.py` (`TheFormatCutOver`) pin both
sides. The list is by name, so a new agent that happens to share a listed
name (a generic one such as `planner`) is warned rather than refused until
that name leaves the list.

## The standing-asset rules (2026-10-28)

A standing asset is the organization's shared material many agents read: a
brand profile, a style guide, a glossary, media templates (see
[`standards/README.md`](../../standards/README.md)). An agent declares each
kind it reads as a `can_use` entry, and since 2026-10-28 `build.py` holds
every package to three rules, the audit checklist's `can-use-known-schema`,
`can-use-without` and `person-facing-declares-library`:

1. **A known kind.** Every `can_use` entry names a schema on the list in
   [`standards/standing-asset-schemas.json`](../../standards/standing-asset-schemas.json).
2. **`without`.** Every entry says what the agent does when none is given.
3. **Person-facing output declares its library.** A new agent whose offered
   jobs hand a person `text/markdown`, `text/html`, an image, video or audio,
   and that declares no `can_use`, is warned, unless its architecture record
   says why none apply, in the person's own words: `architecture-record.md` at the top of the agent's
   folder, or the file `ARCHITECTURE_RECORD` names, whose header says
   `standing_assets: none` and whose `## Standing assets` section gives the
   reason.

Rules 1 and 2 use the format rules' cut-over: they refuse a new agent and
warn for an existing one (the same `FORMAT_EXISTING_NAMES`,
`FORMAT_EXISTING` and `FORMAT_EXISTING_MODE`). Rule 3 is only ever a warning,
and only for a new agent. The result, and the signed build record `pack.py`
writes, carry `standing_rules`: `existing`, `mode`, `since`, `findings`
(rules 1 and 2), `warnings` (rule 3), `schemas_digest`, `levels`, and
`none_because` where the record said why.

The list is read at the version `build.py` pins, `STANDING_SCHEMAS_PIN` (the
sha256 of its bytes): on a fleet host from
`/opt/fleet/agentbuilder-standing-asset-schemas.json`, beside the builder,
and in this repository from `standards/`. A list that is not the pinned
version, or no list at all, is not read: rule 1 is not run, the build is
warned, and `standing_rules` says why under `not_checked`. To adopt a changed list, re-pin, run
`test_standing.py` and release both files together. `test_standing.py` pins
the rules and the pin.

## The option rules (2026-10-28)

Two more design-time rules, the audit checklist's `options-are-settings` and
`settings-declared-fully`, with the same cut-over (refuse a new agent, warn
an existing one):

1. **Options are settings, inputs are material.** An offered job's input
   whose name says it only shapes how the job runs (a voice, a tone, a
   length, a style, a format) and whose kind is `text` or `identifier` is a
   finding: it belongs in `run_config.settings`. One whose name says brand,
   palette, colours, logo, font, style guide, glossary or template is a
   finding of any kind: it is a `can_use` standing asset. Explainer maker
   declared Voice, How it sounds, Target length and Palette as inputs.
2. **Settings declared in full.** Every run-config setting has `label`,
   `about` and `default`; `allowed` when its value has a natural set of
   choices (its name says so, or it is a rule); `value_labels` for each
   allowed value; and `min`, `max` and `step` for a number.

`label`, `about`, `value_labels`, `min`, `max` and `step` are carried into the
descriptor as declared (Common Agent 6.13, proposed), and checked: a value
label for a value that is not allowed, or a default outside its range, is
refused. The result and the signed build record carry `option_rules`
(`existing`, `mode`, `since`, `findings`, `levels`), each finding starting
with its check id. `test_options.py` pins them.

## What it needs

- Python 3.11 or later for `build.py`. Nothing else to build a package.
- On a fleet host, as an agent: the mesh-adapter installed globally (its
  libraries sign the build record and verify manifests), a coding harness for
  messages that are not a run's work (the brain uses Codex), and the bootstrap
  in [`../../host`](../../host).

## Running it

```sh
python3 build.py ../publisher ./out
node --test connection.test.mjs request.test.mjs
AGENTMESH_ENV=example python3 -m unittest test_build test_pack
```

## What runs only inside AgentMesh today

- `test_build.py` builds AgentMesh's product packages (the explainer chain and
  others) as its fixtures. Set `ADLC_PACKAGES` to a folder of packages laid out
  as `<family>/<name>/` (each an agent's own files), such as the AgentMesh repository's
  `packages/`, and all 120 tests run; without it the module is skipped.
- The tests in `test_pack.py` that lay a run's work out as the agent's own
  repository need AgentMesh's `tools/agent-repo.mjs`; name it with
  `AGENT_REPO_TOOL`. The image tools they also read are in
  [`../image`](../image).
- `provenance.test.mjs`, `sign.mjs` and `pack.py`'s signing read the
  mesh-adapter's libraries from `/usr/lib/node_modules/mesh-adapter`.
- The pack procedure, the brain and the install paths assume the fleet layout
  under `/opt/fleet` and the AgentMesh fleet supervisor that wakes the brain
  per message.

## Replacing it

This is a reference implementation. Any package maker that produces a valid
Agent Package can hold the role. The package is what the rest of the lifecycle
checks, not the tool that made it.
