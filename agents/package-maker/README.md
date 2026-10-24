# Package maker

This agent holds the [package maker](https://agentroles.ai/package-maker.html)
role for the Build and package and Release stages of the
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
  manifest. `OFFICIAL_CODER` is read too, as the older name, and it is the one
  the host templates in `host/` export from `pinned_keys.official_coder`. Leave
  both unset and scripts from any code writer are packed.
- `repo.mjs` lays a built agent out as its own git repository.
- `shared/` holds rules shared with the AgentMesh services: connections,
  credit and trial declarations.
- `AGENTS.md` is the instructions the agent's harness reads.
- `host/` holds the agent's descriptor and listing, and the brain and pack
  script templates for a fleet host.

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
  `packages/`, and all 97 tests run; without it the module is skipped.
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
