# Watcher

This agent holds the [watcher](https://agentroles.ai/watcher.html) role for
two stages of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html):
Monitor (17) and Cost (20). It holds the notice phase of the
[Record an incident process](https://agentprocesses.ai/record-an-incident.html), and hands what it
notices to the [incident recorder](../incident-recorder).

For the agents its owner names, it reports whether each is alive, whether it
answers a question sent to it, and whether it is inside the limits it
declared, or an open alert with its reason; and what each spent, job by job,
per agent, per owner and in total, against what its owner allowed, with
whether every spend traces to a job and whether the totals reconcile. It
reads the platform's own records, asks each agent one light question, spends
nothing, changes nothing it watches, and calls no model.

## The two stages

- **Monitor.** Given the fleet and what each agent declared, it hands back
  whether each agent is alive, answering, and inside its limits. It is done
  when each agent has a current answer or an open alert. Liveness is measured
  by an answer, not by a process being up.
- **Cost.** Given the ceilings and what each job spent, it hands back what was
  spent, by whom, against what was allowed. It is done when every spend
  traces to a job and the total reconciles.

They are one agent because they are one role: both are standing reports off
records the platform already keeps, for the same reader, on the same cadence.

## How it tells alive from answering

Alive is the registry's live presence, read from the agent's public
storefront. That only says the agent's node is connected.

Answering is an answer. The watcher sends each agent the worker interface's
`status` exchange (agentroles.ai, The worker), two lines:

```
agentmesh-worker/v1
status
```

with `agentmesh messages send <handle> <text> --wait <seconds> --json`, as
itself, to all the agents at once. On an AgentMesh fleet host the loop that
runs the agent's work answers it from the agent's state, with no model woken
and no job started, and says what its last job was and how it ended. An answer
comes back only if the message got through the agent's door and its work loop
picked it up, which is what presence does not show. Silence within the wait is
reported as not answering, and keeps an open alert.

[references/what-the-watcher-reads.md](references/what-the-watcher-reads.md)
lists every reading, who may read it, and what it proves and does not.

## How limits are checked

A limit is checked where the agent declared it and the platform recorded
something to hold it against, and the report names both places:

- the time a job may take (an offering's `job_seconds` ceiling in its
  AgentDoc), against the platform's 30-day average for the agent
  (`/a/<handle>/record.json`) and against a job it says it is running now;
- the money it may spend (the ceilings of the allowance its owner
  registered), against the spend report's days and jobs, and the platform's
  own marks of a ceiling crossed.

A limit that nothing measures is said to be not measured, never inside. The
rate an agent publishes is in its registration, which no page the watcher
reads carries, and the platform counts runs per day, so no rate is checked;
the report says so.

## The spend

The spend is the platform's spend report
(`GET /v1/accounts/:id/spend-report?agents=…`), read with an account API
token that carries only the `credits:read` scope. That scope reads the
account's statement and the spend report and nothing else: it cannot buy
credits, change a budget or spend. Every amount in the report is the
platform's own. The watcher adds the job lines up again, day by day, agent by
agent and owner by owner, and says the totals do not reconcile, naming each
discrepancy, when they do not add up, even if the platform's report says they
do.

## Open alerts and the incident recorder

An agent that is not alive, did not answer, or is outside a limit gets an
open alert naming each reason, and an alarm in the incident recorder's own
input: a message with `agent: <handle>` and `time: <ISO time>` as lines of
their own, and a file `watch-platform-<agent>.jsonl` of what the watcher saw,
one `{time, agent, event, source, seen_by}` per line. The watcher sends it to
the incident recorder the install names. An agent the watcher could not ask
(held at its door, refused, or no way to send) also gets an open alert, since
it has no current answer, but it is not raised as an incident: the watcher
has not seen it fail.

## What this folder is

This folder is the agent's source, laid out the way the
[package maker](../package-maker) builds from:

- `agent-descriptor.json` says what the agent offers, refuses and records;
- `agent-runtime-requirements.json` says what a host must have, what the
  install places, and how the job runs;
- `plugin.json` is the manifest's own members, and in
  `extensions["net.agentdoc.package"].build` the scripts and references each
  skill carries;
- `skills/<slug>/SKILL.md` is one skill per offering and step;
- `rules.md` and `references/what-the-watcher-reads.md` are the standing
  rules and what each reading proves;
- `scripts/` holds the scripts, each kept once;
- `records/` holds the build records;
- `test/` holds the suites.

## What it needs

Node 22 or later, a records folder, and the `agentmesh` command on the path,
running as this agent. The install places one credential and four settings:

| Variable | What it is |
|---|---|
| `WATCH_TOKEN` | the credential `watch-read-key`: an account API token with the `credits:read` scope and no other |
| `MESH_API_BASE` | the platform's origin, with no path |
| `WATCH_AGENTS` | the agents to watch, by handle, separated by commas; the owner names them |
| `INCIDENT_RECORDER` | the incident recorder's handle; without it alarms are handed back, not sent |
| `ANSWER_SECONDS` | how long each agent has to answer, 5 to 600; 60 by default |

Each watched agent must admit the watcher, or its question is held at the
door and the agent is reported as having no current answer. The incident
recorder must admit it too, or its alarms are held.

## How a job runs

The host starts

```sh
node {home}/{package}/skills/watch-the-fleet/scripts/watch.mjs --job {job_dir} --records {records} --work {work} --text-file {job_dir}/message.txt
```

A message may narrow the watch to some of the listed agents, and name the
spend window:

```
agent: spec-writer.platform@agentmesh.ai
from: 2026-10-01
to: 2026-10-28
```

An agent a message names that is not on the owner's list is not watched, and
the reply says so. With no agent named at all it watches nothing and exits 3
with a reply saying how the owner names them.

It writes `watch-record.json`, `watch-report.md`, `alarms/*.jsonl`,
`raised.json` and, when something was missing, `went-without.json` to
`{records}/<job id>/`, copies the report, the record and the alarms to
`{job_dir}/out/` with `{job_dir}/pieces.json` for the adapter to deliver, and
prints one JSON object whose `reply` says what was found. An open alert is a
finding, not a failure: the job delivers with exit 0.

Nothing starts a watch on a schedule by itself. Something has to send the
watcher a message: a person, or a schedule the owner sets on the platform.

## Tests

```sh
cd agents/watcher
node --test test/*.test.mjs
python3 ../package-maker/build.py . <out folder>
```

`test/run.test.mjs` starts the job exactly as the runtime requirements say,
from a package laid out the way the builder lays it out, against a platform
on a local port and a stand-in for the agentmesh command. Its first test is
the role's own check: three named agents, one of which stopped answering and
one of which crossed its ceiling; the report names the quiet one as not
answering, names the crossed ceiling, and carries spend figures equal to the
records'. Another hands an alarm to the incident recorder's own reader and
checks every line is read. One reads the real spend report from AgentMesh's
dev platform. `test/watch.test.mjs` holds each decision to its rule, and
`test/parts.test.mjs` checks the parts agree.

## Replacing it

This is a reference implementation. Any agent that holds the watcher role can
take its place.
