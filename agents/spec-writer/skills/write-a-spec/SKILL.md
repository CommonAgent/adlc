---
name: write-a-spec
description: when somebody wants an agent built and has said what it should do, in their own words, however untidily
---

# Write a spec

Part of spec-writer. when somebody wants an agent built and has said what it should do, in their own words, however untidily

## When to use this

when somebody wants an agent built and has said what it should do, in their own words, however untidily

## What this needs

- what it should do (text, required)
- an existing spec (application/json, optional)
- notes or a document (document, optional)
- answers to earlier questions (text, optional)

## What a good result looks like

The agent's own files, the layout a package is built from (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and a SKILL.md per skill), the same bytes the builder writes for the draft, carrying the four sentences on every job, a how declaration on each, a specific kind on every input and output (Markdown with a convention for what agents hand each other or a person reviews, a vendor JSON kind for typed data only code reads, never a bare application/json), who gives each input, at least four refusals written as acts, and the records an agent is audited by. Beside it, the questions it could not answer itself, each one something nobody else could have answered.

## What it produces

- the agent's own files (document, per task)
- what is still open (text, per task)

## When it comes back empty

If nothing arrived to write a spec from, nothing is drafted and no model is woken: the reply says so and names what would be enough. If the request settles the name, the price or what the agent may reach, those are asked rather than invented, and the draft is delivered with them still open.

## How to do it

Nothing in this package runs on its own, and nothing here is done by opening files and working out what to do next. Every message that reaches this agent is one job, and one command does the whole of it. The package is installed at ~/spec-writer, so the scripts are always under ~/spec-writer/skills/write-a-spec/scripts/.

Run these four commands in order, with these exact paths. JOB_DIR is the path on the message's `job folder: <absolute path>` line, and WORK and RECORDS are the work and records directories this agent was installed with, each with this job's own folder under it.

1. JOB_DIR=<job folder> RECORDS=<records folder> TEXT_FILE=<the message text written to a file> FILES=<each attached path, with ::media_type, comma separated> node ~/spec-writer/skills/write-a-spec/scripts/asked.mjs

2. ASKED=<records folder>/asked.json RECORDS=<records folder> ANSWERS=<records folder>/answers.json node ~/spec-writer/skills/write-a-spec/scripts/draft.mjs

3. DRAFT=<records folder>/draft.json RECORDS=<records folder> node ~/spec-writer/skills/write-a-spec/scripts/builds.mjs

4. DRAFT=<records folder>/draft.json BLANKS=<records folder>/blanks.json BUILDS=<records folder>/builds.json RECORDS=<records folder> node ~/spec-writer/skills/write-a-spec/scripts/ask.mjs

Then JOB_DIR=<job folder> RECORDS=<records folder> node ~/spec-writer/skills/write-a-spec/scripts/pieces.mjs to file the pieces.

Each script prints one JSON object. The last one's `reply` field is your whole answer; print it and nothing else. When the first exits 3, print its `reply` and stop: nothing arrived to write a spec from, and no model was woken. When any of them exits 2 the command was called wrong; fix the variables and run it again.

Attached files arrive as local paths in an `attached: N files, already downloaded to this machine:` block the adapter writes under the message, each with its media type in brackets and, when the sender filed a manifest, a sentence saying what it is. Pass every one of them in FILES.

A message that answers questions from an earlier round, sends a draft back with changes, or relays an owner's answer ("here is your answer") is a REVISION of that draft and never a new request: run the same four commands with the same variables and nothing else. The first command reads the answers out of the message itself, writes <records folder>/answers.json, and takes the draft from FILES when one was attached or from this agent's newest earlier draft when none was; it exits 3 when there is no draft to revise, and then its reply is your whole answer. Never write answers.json yourself, never write a spec yourself, and never draft an agent from the words of an answer.

Never write a spec yourself. Never fill in a name, a price or an access grant the person did not state, whatever the draft says: the script checks the draft for those three and puts back any the model quietly settled.

Never open draft.json, an attached spec or any other spec with your own file tools, and never edit one: your read tool cuts every line over 2000 characters, and a spec's instructions are longer than that. The scripts read and write every spec whole. pieces.mjs delivers the draft only while it is byte for byte what draft.mjs wrote; when it refuses, it prints one JSON object whose `reply` says so, and that reply is your whole answer.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/asked.mjs
- scripts/draft.mjs
- scripts/check-spec.mjs
- scripts/builds.mjs
- scripts/files.mjs
- scripts/ask.mjs
- scripts/went-without.mjs
- scripts/pieces.mjs
- scripts/agent-folder.mjs

## References

- references/what-a-good-spec-carries.md
- references/a-spec-that-works.json
- references/rules.md
