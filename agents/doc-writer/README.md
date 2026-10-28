# Doc writer

This agent holds the [doc writer](https://agentroles.ai/doc-writer.html) role
for the Docs stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html), for
the documentation. The [documenter](../documenter) holds the same stage for
the AgentDoc.

It writes the documentation a person reads to use or maintain an agent: what
it does, where to send it work, what each job takes and hands back and how it
is done, what it will not do, what it reaches, costs and leaves behind, what
the verdicts about it say, and examples from its own records. It writes only
from the agent's descriptor, its runtime requirements, its AgentDoc, its
records and the verdicts other roles signed about it. Every line ends with the
place in a named source it came from, every silence in those sources is listed
under Not documented, and a check re-derives every line before anything is
delivered. There is no model in it.

## Why it is its own agent

The lifecycle's rule is that one agent owns one artifact. The AgentDoc and the
documentation are two artifacts with opposite rules:

- the AgentDoc is gathered and never authored. The documenter calls no model,
  adds no statement, signs what it gathered, and runs inside the platform,
  re-documenting an agent whenever one of its records changes;
- the documentation is written. It chooses an order, turns declared values
  into sentences a person reads, picks examples from records, and is handed
  to whoever asked, unsigned, as a job's piece.

They are also two roles on agentroles.ai, each with its own check: the
documenter's is mechanical (the same records give the same AgentDoc, a gap
stays a gap, the signature verifies), and the doc writer's is behavioural
(every job covered, every statement traced, a job with no record said to have
none). Putting the doc writer inside the documenter as a second offering would
give the documenter an authored artifact beside its gathered one, and its
promise that it writes nothing of its own would stop being true of the agent
as a whole. So the doc writer is its own agent, and it reads the AgentDoc as
one of its sources.

## Why there is no model

The documentation is written for a person, and that person has to be able to
check any line against its source. Each line is therefore one fixed template
(scripts/templates.mjs) filled from one place in one source, and the check
(scripts/check-docs.mjs) passes a line only when a template filled from the
place its mark names gives exactly that line. A sentence a model wrote is a
sentence that check would have to take on trust, which is the failure the
Docs stage's "nothing was authored" exists to prevent. The templates are the
writing, written once, where anybody can read them.

## What this folder is

This folder is the agent's source, laid out the way the
[package maker](../package-maker) builds from:

- `agent-descriptor.json` says what the agent offers, refuses and records;
- `agent-runtime-requirements.json` says what a host must have and how the job
  runs;
- `plugin.json` is the manifest's own members, and in
  `extensions["net.agentdoc.package"].build` the scripts and references each
  skill carries;
- `skills/<slug>/SKILL.md` is one skill per offering and step;
- `rules.md` and `references/how-a-line-is-traced.md` are the standing rules
  and how to read a line's mark;
- `scripts/` holds the scripts, each kept once;
- `records/` holds the build records;
- `test/` holds the suites.

## What it needs

Node 22 or later, and a records folder. It reaches no system and no network,
and calls no model.

## How a job runs

The host starts

```sh
node {home}/{package}/skills/document-a-package/scripts/document.mjs --job {job_dir} --records {records} --work {work} --text-file {job_dir}/message.txt [--file <path>::<media type>]...
```

The attached files are what it documents from. Each is told apart by what is
in it, not by its name or the media type it arrived under:

| What it is | How it is known |
|---|---|
| the agent descriptor | `"format": "agent-descriptor-v1"` |
| the runtime requirements | `"format": "agent-runtime-requirements-v1"` |
| the AgentDoc | `"agentdoc": "v1"`, or the signed form holding one |
| a verdict | `"record": "v1"` and `"act": "evaluate"` (agent-eval-record-v1) |
| a record | anything else |

It needs the descriptor or the AgentDoc; with neither it writes nothing and
exits 3 with a reply asking for one. A job's records become that job's
examples, the platform's run record (`runs`, `completed`, `failed`) goes under
How it has run, and a text record headed `# ...` goes under Versions.

It writes `given.json`, `documentation.md`, `check.json` and, when something
was missing, `went-without.json` to `{records}/<job id>/`, copies the
documentation and the check's trace to `{job_dir}/out/` with
`{job_dir}/pieces.json` for the adapter to deliver, and prints one JSON object
whose `reply` says what was documented. When the check finds anything,
nothing is delivered and the reply names the findings.

## Reading a line

`[S1: offerings[0].inputs[2]]` is the place `offerings[0].inputs[2]` in source
S1, listed under Sources with its file and digest. `[S1: escalates absent]`
says S1 is silent there. `[given]` is a line about what the job had. The
reference [how-a-line-is-traced.md](references/how-a-line-is-traced.md) says
the rest.

## Tests

```sh
cd agents/doc-writer
node --test test/*.test.mjs
python3 ../package-maker/build.py . <out folder>
```

`test/docs.test.mjs` holds the writer and the check to the role's own test (a
package with three jobs and records from two), and shows that a changed word,
an unmarked line, a false silence, a dropped job and a doctored example each
fail. `test/run.test.mjs` starts the job exactly as the runtime requirements
say, from a package laid out the way the builder lays it out, against
quiz-maker's real descriptor, AgentDoc and run record. `test/parts.test.mjs`
checks the parts agree.

## Replacing it

This is a reference implementation. Any agent that holds the doc writer role
can take its place.
