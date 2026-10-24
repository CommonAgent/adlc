# Incident recorder

This agent holds the [incident recorder](https://agentroles.ai/incident-recorder.html)
role for the Incident response stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html). It
holds the record-the-incident phase of the
[Incident process](https://agentprocesses.ai/incident.html).

When an agent goes quiet or a job fails, it reads the platform's activity
records and the agent's own records around the failure, builds a strict
timeline of known facts and gaps, and writes an incident record that names the
source of every fact. It never guesses a cause, never proposes a fix and never
contacts the agent. There is no model in it.

## What this folder is

`package/` is the built Agent Package, version 0.1.0, exactly as it was
released, not a package source. It was made by the package maker from a description during the first end to end run
of the New agent process, on 2026-09-15, and it is a good example of what the
lifecycle hands over at the end:

- `package/plugin.json` is the manifest, with the digests of the descriptor
  and the install file;
- `package/descriptor.json` says what the agent offers, refuses and records;
- `package/install.json` says what a host must have and how each job runs;
- `package/skills/` holds the four skills and their scripts;
- `package/net.agentdoc.package/` holds the plain statements of what it will not do,
  the records it keeps and the systems it uses.

The source `spec.json` it was built from was not kept, so this package has no
tests.

## What it needs

Node 22 or later, and a records folder for each job. It reaches no system and
no network.

## A known gap

The command-line entry of `package/skills/record-incident/scripts/record-incident.mjs`
checks its arguments and stops without calling `recordIncident`. Run through
`install.json`, version 0.1.0 records nothing. The functions it exports work
when called directly. The next version needs its source spec rebuilt, the entry
fixed and a suite written by the test writer.

## Replacing it

This is a reference implementation. Any agent that holds the incident recorder
role can take its place.
