# Impact analyst

This agent holds the [impact analyst](https://agentroles.ai/impact-analyst.html)
role for the Impact stage (03) of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

A change that is safe for its owner can break everyone who depends on it. Given
the change, the running version, and what depends on it, the impact analyst
names every dependent, says where it learned of it, and answers each one
compatible, breaking or a change of behavior, with the reason. It files a
dependency debt in the ledger for each one that is not compatible, owed to that
dependent's owner, and hands back the impact report the person who asked for
the change approves or refuses it from. It calls no model, changes nothing it
reports on, and approves nothing.

## What it is given

One offering, `agent-change`. The files attached to the job, each known by
what it holds:

| Input | Kind | |
|---|---|---|
| running version, changed version | `application/vnd.agentmesh.agent-descriptor+json` | required: the two agent-descriptor-v1 files; the lower agent_version is the running one |
| what depends on it | `application/vnd.agentmesh.dependents+json` | required: the platform's list, as `dependents_list` (GET /v1/accounts/:id/agents/:key/dependents) answers it |
| dependent solutions | `application/vnd.agentmesh.solution+json` | optional: each as GET /v1/solutions/:id answers it, so its lines are read |
| agents that may take its outputs | `application/vnd.agentmesh.agent-ports+json` | optional: an agent's ports as ports.ts readPorts reads them, one or a list |
| runtime requirements | `application/vnd.agentmesh.agent-runtime-requirements+json` | optional: before and after, for the price and the limits |
| what changed | `text` | optional: a `what changed:` line in the message |

## How it finds dependents

The platform already knows them. The dependents list (AgentMesh
`docs/dependents-view.md`, `services/src/dependents/dependents.ts`) gathers
what declares a use of the agent (solution canvases, process documents,
schedules, Variations, shares, published samples, other agents' published
terms) and what was seen using it in the last 90 days (solution runs and the
record of who called it), and names the sources it could not read. Every entry
in it is a dependent in the report, with the platform's own words for where it
was found.

What each dependent uses decides which differences reach it. A solution's
canvas, when given, says which outputs it reads and into which input of the
next agent, with that input's kind, and which inputs it sends. An agent given
by its ports is matched to an output by name, or by a kind that says what the
piece is. Anything else (another organization's solution, whose canvas its
owner does not show; a process document; a caller seen only in the record of
who called it) is answered from the offerings the platform saw it use, and
what it reads is said to be not known.

Whether a kind still fits an input is the platform's own rule, copied from
`services/src/compose/ports.ts` (`mediaTypeSatisfies`) into `scripts/kinds.mjs`,
so the report and the canvas never disagree about a line. `rules.md` and
`references/how-each-change-is-answered.md` give every rule.

## What it hands back

`out/impact-report.md`, Markdown with a front matter header that lists each
dependent with its answer and reason, then What changed, Each dependent, The
agents that read what it hands back, What is owed, What to redo and what to
reuse, Cost, Not read, and Your decision. The same files always give the same
bytes: nothing in it depends on the clock or on what the ledger answered. What
was filed, and its numbers, are in the reply and in `records/<job>/filed.json`.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- The ledger, bound as the `the-ledger` system: the ledger's key (`ledger-key`)
  in `LEDGER_TOKEN`, and the platform's origin in `MESH_API_BASE`. It reads
  `GET /v1/operator/debt` for what is already filed against the agent and files
  with `POST /v1/operator/debt/items`. Without the binding the report is still
  delivered and what is owed is listed in it, not filed.

## Running it

```sh
node --test test/*.test.mjs                                   # 43 tests, and one skipped that reads kept examples
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

`test/role-check.test.mjs` is the role's own check: three dependents, one known
only from the calls record; a new optional input, a removed output and a new
model in turn; every case twice; and a request to go ahead, declined.
`test/site-reader.test.mjs` is a real change, Site reader 2.4.1 to 2.5.0, on the
platform's own answers from dev. `test/run.test.mjs` starts the job as the
runtime requirements say, from a package laid out the way the builder lays it
out, against a ledger served on the machine.

`records/` holds the build notes of each version.

## Not done yet

The role's second request, what a change to a solution touches (its
requirements and plan before and after), is not in this version.

## Replacing it

This is a reference implementation. Any agent that holds the impact analyst
role can take its place.
