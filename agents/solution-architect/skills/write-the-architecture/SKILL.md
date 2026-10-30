---
name: write-the-architecture
description: when somebody has a statement of what an agent is for, and the systems it stands on have to be named and bound before anybody designs it
---

# Write the architecture

Part of solution-architect. when somebody has a statement of what an agent is for, and the systems it stands on have to be named and bound before anybody designs it

## When to use this

when somebody has a statement of what an agent is for, and the systems it stands on have to be named and bound before anybody designs it

## What this needs

- the statement of the job (text, required)
- the organization's stack (application/vnd.agentmesh.stack+json, optional)
- the platform's defaults (application/vnd.agentmesh.stack-vocabulary+json, optional)

## What a good result looks like

The architecture record: every system the agent reaches named in plain system words, each bound to a product in dev, test and production with the organization's choice first and a platform default marked as one, the dependencies, the kind, the limits on cost, speed, data and trust, the egress per environment, the formats at its edge (Markdown with a convention for what a person reads, a vendor JSON kind only for typed data code reads, who gives each input), the settings with their defaults, and every decision with its reason. A model is a bound system stated by capability, and no model is named anywhere. Beside it, the questions only a person can answer, each under a key the answer goes back with.

## What it produces

- the architecture record (text/markdown, per task)
- what is still open (text/markdown, per task)

## When it comes back empty

If nothing arrived to write an architecture from, nothing is written and no model is woken: the reply asks for the statement. If the message asks for the statement itself, the design or the agent that does a step, it is declined in words, because those belong to other stages. A binding nobody can make, a spending limit, a destination beyond the derived set and a system the statement never called for are asked rather than filled, and the record goes with them open and says it is not finished.

## How to do it

Nothing in this package runs on its own, and nothing here is done by opening files and working out what to do next. Every message that reaches this agent is one job, and these commands do the whole of it. The package is installed at ~/solution-architect, so the scripts are always under ~/solution-architect/skills/write-the-architecture/scripts/.

Run these five commands in order, with these exact paths. JOB_DIR is the path on the message's `job folder: <absolute path>` line, and RECORDS is the records directory this agent was installed with, with this job's own folder under it.

1. JOB_DIR=<job folder> RECORDS=<records folder> TEXT_FILE=<the message text written to a file> FILES=<each attached path, with ::media_type, comma separated> node ~/solution-architect/skills/write-the-architecture/scripts/asked.mjs

2. ASKED=<records folder>/asked.json RECORDS=<records folder> node ~/solution-architect/skills/write-the-architecture/scripts/name.mjs

3. NAMED=<records folder>/named.json ASKED=<records folder>/asked.json RECORDS=<records folder> node ~/solution-architect/skills/write-the-architecture/scripts/bind.mjs

4. ASKED=<records folder>/asked.json NAMED=<records folder>/named.json BOUND=<records folder>/bound.json RECORDS=<records folder> node ~/solution-architect/skills/write-the-architecture/scripts/check-record.mjs

5. RECORDS=<records folder> node ~/solution-architect/skills/write-the-architecture/scripts/reply.mjs

Then JOB_DIR=<job folder> RECORDS=<records folder> node ~/solution-architect/skills/write-the-architecture/scripts/pieces.mjs to file the pieces.

Each script prints one JSON object. The last one's `reply` field is your whole answer; print it and nothing else. When any of them exits 3, print its `reply` and stop: there was nothing to write from, or it was not this role's to do, and no record is written. When any of them exits 2 the command was called wrong; fix the variables and run it again. When one exits 1 with a `reply`, that reply is your whole answer.

Attached files arrive as local paths in an `attached: N files, already downloaded to this machine:` block the adapter writes under the message, each with its media type in brackets. Pass every one of them in FILES. The first command tells them apart by what is in them: a stack, the platform's defaults, an earlier record, or more of the statement.

A message that answers the record's questions, or says what to change in a record, is a REVISION and never a new request: run the same commands with the same variables, and the first command takes the record from FILES or from this agent's newest earlier record. Never write an answer into a record yourself.

Never write a record yourself, never fill in a binding, a limit or a destination the person did not give, and never open or edit record.md with your own file tools: pieces.mjs delivers the record only while it is byte for byte what check-record.mjs wrote.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/asked.mjs
- scripts/name.mjs
- scripts/model-caller.mjs
- scripts/standard.mjs
- scripts/options.mjs
- scripts/bind.mjs
- scripts/architecture-record.mjs
- scripts/standing.mjs
- scripts/check-record.mjs
- scripts/reply.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs

## References

- references/architecture-standard.md
- references/house-stack.json
- references/a-record-that-works.md
- references/rules.md
- references/standing-asset-schemas.json
