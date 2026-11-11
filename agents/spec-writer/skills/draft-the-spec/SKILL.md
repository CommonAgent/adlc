---
name: draft-the-spec
description: once the request is recorded, to write the spec it describes and the agent's own files from it
---

# Draft the spec

Part of spec-writer. once the request is recorded, to write the spec it describes and the agent's own files from it

## When to use this

once the request is recorded, to write the spec it describes and the agent's own files from it

## What a good result looks like

A spec valid against spec-v1, every feature with the inputs and outputs the person named, wherever they named them, and with requirements and at least one Gherkin scenario that checks requirement ids it has, every quote, rule value, refusal and interface of an as-built record in it byte for byte, no exact value nobody gave, and the name, price and access left to the person; a revision that changed only what the person's words name. Then the agent's own files made from that spec, every structural field written by code from it and every declaration it keeps at its place, with prose that carries what the reference says a good one carries: every input and output with a specific kind, every input saying who gives it, a model reached as a bound system and named nowhere, no address outside an address setting's default, and the spec's settings, systems and price. Beside both, the blanks it could not fill, each with the question it would ask.

## When it comes back empty

If the service will not answer, or answers with something that is neither a fill, a set of edits nor a spec, nothing is written and the reply says which of those happened. An answer wrapped in prose or a code fence is read for the JSON object inside it; an answer with no object in it is asked for once more with a reminder to answer with JSON only, and never a third time. The spec runs inside SPEC_SECONDS (300 by default) and the files inside DRAFT_SECONDS (240 by default): no call starts without a minute left, and each call is cut at what remains, so the job ends in words and never at its own time limit. A spec or a draft that still carries findings after a second go is delivered as it is, with every finding said out loud.

## How to do it

Nothing in this folder is run on its own; the write-a-spec skill names the one command that does the whole job, and this skill only explains what that command does for this step.

draft.mjs does two parts in one run, the spec first and then the agent's own files from it (stages.json 1.6.0: Requirements hands back the spec, and the Design part of Architecture and Design makes the files from it).

The spec (spec.mjs). With an as-built record attached (behaviors.json, interfaces.json, architecture.json, tests-and-gaps.json and the schemas, told by their formats), code seeds the spec with no model (seed.mjs): each behavior a feature unless the person dropped it or called it a bug, each quote a wording or pattern requirement with the quote in exact, each rule a requirement of its kind with its values in exact, each refusal and error handling a refusal or error requirement, each interface kept, each address the code reaches a system with an address setting, each address it only writes down a system with reach none, and the record's settings with an open question for each default it withholds. The model then answers with a fill by id: the shall lines, the purpose, Gherkin scenarios for every feature, and open questions; code keeps every value it seeded. Without a record the model drafts the whole spec from the person's words, and everything it cannot settle goes in open. On a revision (Ask for changes or Send back to Requirements) the earlier spec is changed by edits addressed by id to what the person's words name (revise.mjs); words that name an input or an output the spec does not have open the features' pieces, a keyed name, version or price is set by code, and every other part stays byte for byte. Each answer is checked (spec-check.mjs): valid against standards/spec.schema.json, every feature with requirements and a Gherkin scenario that checks ids it has, every quote, rule value and interface of the record carried byte for byte, no exact value nobody gave, and the name, price and access the person's. What the check finds goes back once, and never a third time; then code writes a scenario for a feature still without one, takes an invented value out to open and takes back a name or price nobody gave. It writes records/<job>/spec.json and records/<job>/spec.md.

From an as-built record of the reverse engineer 0.3.0, code also carries its constants and declarations (every name and value the agent declares to the platform, with where) as kept interfaces with their values, a command's required flags, a file's allowed values, a declared setting's default and range, and every entry of strings.json byte for byte in some requirement's exact: under the feature whose behavior's evidence covers its line, else the feature anchored to its file, else as a constraint. The check finds any of them lost. A revision whose words name nothing in the spec leaves it byte for byte and asks no model.

The agent's own files. Code writes every structural field from the spec (structure.mjs), never the model: the offering ids, step ids and skill folders (from the spec's declarations, else from its features' offerings), each input's and output's name, kind and schema, with the about, whether it is required and who gives it as the spec says them (an offering the spec gives no output, or never says the input of, is asked in blanks and in still-open.md), the labels the spec keeps, the run-config settings, the systems with their address settings, each run command in the packaged form {home}/{package}/skills/<slug>/scripts/... with the flags its command interface keeps, the scripts, runtimes, records and price; and every declaration the spec keeps is put at its place. The model is asked only for the prose, by key (design.mjs): the description, the refusals, each job's does, when, good, empty and instructions, each piece's about and each system's needs. On a revision the structure is written again from the spec, so it changes only when the spec does; the earlier files' prose is carried over, the model is asked only for the prose the person's words name and any the new structure adds, and every other field stays byte for byte, checked by code. The files are checked (check-spec.mjs, reaches.mjs, given.mjs, and declared.mjs: every kept declaration's value at its declared place), what a change of prose can settle goes back once, and then code names each host in its service's needs and writes any address outside a setting's default as its host. It writes records/<job>/draft.json, records/<job>/blanks.json (the spec's open questions first, then any the files add, and what the Design wrote) and records/<job>/calls.json, with the digest of the spec, its Markdown and the draft.

The model is reached through the shared model caller (scripts/model-caller.mjs) and the four settings the install places, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, read on every run; the package names no model and no address, and with a setting missing the job is refused in words.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/draft.mjs
- scripts/spec.mjs
- scripts/seed.mjs
- scripts/spec-check.mjs
- scripts/spec-v1.mjs
- scripts/revise.mjs
- scripts/design.mjs
- scripts/structure.mjs
- scripts/declared.mjs
- scripts/files.mjs
- scripts/json-in.mjs
- scripts/model-caller.mjs
- scripts/check-spec.mjs
- scripts/asked.mjs
- scripts/agent-folder.mjs
- scripts/architecture-record.mjs
- scripts/can-use.mjs
- scripts/options.mjs
- scripts/job-seconds.mjs
- scripts/run-reply.mjs
- scripts/reaches.mjs
- scripts/given.mjs

## References

- references/what-a-good-spec-carries.md
- references/a-spec-that-works.json
- references/standing-asset-schemas.json
- references/spec.schema.json
- references/plugin-manifest-schema.json
