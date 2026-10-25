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

This folder is the agent's source, laid out the way the
[package maker](../package-maker) builds from:

- `agent-descriptor.json` says what the agent offers, refuses and records;
- `agent-runtime-requirements.json` says what a host must have and how each
  job runs;
- `plugin.json` is the manifest's own members, and in
  `extensions["net.agentdoc.package"].build` the scripts each skill carries;
- `skills/<slug>/SKILL.md` is one skill per offering and step;
- `scripts/` holds the scripts, each kept once;
- `test/` holds the suites.

`package/` is the built Agent Package 0.1.0, exactly as it was released on
2026-09-15, kept as the record of what that version was. It is not a source
and nothing builds from it. Version 0.1.2 is built from this folder.

## What changed in 0.1.2

Records are read in a window around the failure and about the failing agent
only. In 0.1.1 every timed line of every file became a fact, so a record of a
whole day's activity, or one that covered many agents, went into one agent's
incident whole, and the distance from the last stray line to the failure read
as a gap. Now a line is a fact only when its time lies between fifteen minutes
before the failure and five minutes after it, and, when the line names an
agent (`agent`, `agent_handle` or `handle`), only when it names the failing
one. A handle is compared whole; a bare name such as `tone-check` is the
agent whose handle starts with `tone-check.`. A line that names no agent is
kept. The timeline covers the same window, the incident record and the record
inventory say which window was read and how many lines were left out and why,
and the reply says so.

## What changed in 0.1.1

In 0.1.0 the command the runtime requirements start checked its arguments and
stopped without calling `recordIncident`, so run that way it recorded nothing.
In 0.1.1 the command reads the message, records the incident, files the
incident record and the timeline as the job's pieces, and replies. The run
also passes the attached files (`per_file`), which 0.1.0 did not. The rest of
the agent is as it was.

## What it needs

Node 22 or later, and a records folder. It reaches no system and no network,
and calls no model.

## How a job runs

The host starts

```sh
node {home}/{package}/skills/record-incident/scripts/record-incident.mjs   --job {job_dir} --records {records} --work {work}   --text-file {job_dir}/message.txt [--file <path>::<media type>]...
```

The message names the agent and the time it failed as lines of their own, and
may name a folder of records:

```
agent: spec-writer.example
time: 2026-10-24T09:30:00Z
records: /path/to/records
```

`agent handle:` and `handle:` are read as `agent:`; `failure time:` and
`failed at:` as `time:`. The time must be ISO 8601 with its zone. `--agent`
and `--time` win over the message when given.

The records read are the attached files and the regular files directly inside
the folder the `records:` line names, each one JSON object per line with a
`time` (ISO 8601 with its zone) and an `event`. A line without such a time is
left out and named in the reply. A file whose name contains `platform` is taken
as the platform's activity record, any other as the agent's own.

A `records:` folder is read only when it lies inside a folder the host lists in
`INCIDENT_RECORDS_ROOTS` (several joined by `:`, or `;` on Windows). With none
listed, a named folder is not read and the reply says so; attached files are
always read. This keeps a message from making the agent read any folder on the
host.

It writes `incident.json`, `timeline.json`, `inventory.json` and, when
something was missing, `went-without.json` to `{records}/<job id>/`, adds the
incident to `{records}/incidents.json`, copies the record and the timeline to
`{job_dir}/out/` with `{job_dir}/pieces.json` for the adapter to deliver, and
prints one JSON object whose `reply` says what was recorded. With no records it
still records the incident, noting the complete absence of records. With no
agent or no usable time it records nothing and exits 3 with a reply saying what
it needs.

## Tests

```sh
cd agents/incident-recorder
node --test test/*.test.mjs
python3 ../package-maker/build.py . <out folder>
```

`test/run.test.mjs` starts the job exactly as the runtime requirements say,
from a package laid out the way the builder lays it out, with a job folder
holding `message.txt` and attached records. `test/parts.test.mjs` checks the
parts it is made of.

## Replacing it

This is a reference implementation. Any agent that holds the incident recorder
role can take its place.
