# Spec writer

This agent holds the [spec writer](https://agentroles.ai/spec-writer.html) role
for the Requirements and Design stages of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

> **One builder now writes this stage.** With the ADLC plugin for Claude Code (`plugin/`) or the [reference builder](../reference-builder), one builder writes an agent from its spec through its code, and what keeps each stage honest is its check, not a separate author. This agent is no longer a separate author in that path: its spec checks, its structure and its files generator carry on inside the plugin's check and generators (`plugin/kit/`, copied byte for byte by `plugin/sync.mjs`). This package still runs on its own for a lifecycle that keeps a separate holder for the role, and its role stays at agentroles.ai.

It takes what somebody wants an agent to do, in their own words or as the
as-built record of code that already exists, and writes the spec
([standards/spec.schema.json](../../standards/spec.schema.json), spec-v1):
the analysis of the agent's functional requirements and capabilities. Each
feature has requirements in the attributes of ISO/IEC/IEEE 29148 (a statement
with shall, its kind, the exact words, patterns and numbers it fixes, its
source and how it is verified) and acceptance scenarios in Gherkin a test can
be written from; then come the interfaces and which must be kept, the
constraints, the systems it reaches or names, its settings, its price and the
open questions. That is what Requirements hands back (stages.json 1.6.0).

Then, in the same job, it holds the Design part of the Architecture and
Design stage: from the spec it writes the agent's own files the package maker
will take, the layout a package is built from (`agent-descriptor.json`,
`agent-runtime-requirements.json`, `plugin.json` and a `SKILL.md` per skill).
It never invents the three things only the person can decide (the name, the
price and access to any system), and it hands back the questions it could not
settle instead of guessing. The package maker's own check runs over every
draft of the files, so a draft that will not build is caught here, and no
files are delivered for it. Given an architecture record (after the
[solution architect](../solution-architect)), the files declare exactly the
systems the record names; a step that needs another goes back to the
architect as a question instead.

## The spec

One command does the job (`scripts/draft.mjs`, the second of the four the
write-a-spec skill names), and it writes the spec first:

- From an as-built record (agents/reverse-engineer 0.2.0: behaviors.json,
  interfaces.json, architecture.json, tests-and-gaps.json and the schemas),
  code seeds the spec with no model (`scripts/seed.mjs`): each behavior is a
  feature unless the person dropped it, each quote a wording or pattern
  requirement with the quote in `exact`, each rule a requirement of its kind
  with its values in `exact`, each refusal and error handling a requirement in
  its words, each interface kept (`keep: true`), each address the code reaches
  a system with an address setting, and each address it only writes down a
  system with reach `none`. The model answers with a fill by id: the shall
  lines, the purpose, the Gherkin scenarios and the open questions. Code keeps
  every value it seeded.
- From the reverse engineer 0.3.0 the record adds, and code carries
  (spec-v1 1.1.0): every constant and every declaration (a name or value the
  agent declares to the platform, with `declared_in`, such as
  `agent-descriptor.json offerings[0].outputs[1].name`) as a kept interface
  with its `value`; a command's `required_flags`; a file's allowed `values`;
  a declared setting's default and range; and every entry of strings.json,
  the inventory of the strings a person reads and the patterns the code
  matches, byte for byte in some requirement's `exact`, under the feature
  whose behavior's evidence covers its line, else the one anchored to its
  file, else as a constraint. The check finds any of them lost.
- From the person's words alone, the model drafts the whole spec, and what it
  cannot settle goes in `open`.
- On Ask for changes or Send back to Requirements, the spec is revised by
  edits addressed by id to what the person's words name
  (`scripts/revise.mjs`); everything else stays byte for byte, checked by
  rule, and a keyed name, version or price is set by code with no model. A
  rename names a declared value or a piece as a whole word, and opens that
  declaration and the pieces of the features that carry it, never their
  offering. Words that name nothing in the spec leave it byte for byte, with
  no model asked.

## The agent's own files: structure by code, words by the model

From 0.10.0 the Design is written the way the spec is: code copies facts and
the model only describes. `scripts/structure.mjs` writes every structural
field of the files from the spec: the offering ids, step ids and skill
folders (from its declarations, else from its features' offerings), each
input's and output's name, kind and schema, the labels it keeps, the
run-config settings, the systems with their address settings, each run
command in the packaged form `{home}/{package}/skills/<slug>/scripts/...` with
the flags its command interface keeps, the scripts, runtimes, records and
price, and then every declaration the spec keeps at its place. The model is
asked only for the prose, by key (`designFromSpec` in `scripts/draft.mjs`):
the description, the refusals, each job's does, when, good, empty and
instructions, each piece's about and each system's needs; anything else it
answers is not read. `scripts/declared.mjs` checks every kept declaration's
value at its place in the files, and the package maker's check runs as
before.

A revision of the files is an edit. The structure is written again from the
spec, so it changes only when the spec does. The earlier files' prose is
carried over (the files sent back, or else the newest draft an earlier job
wrote), the model is asked only for the prose the person's words name and any
the new structure adds, and every other field stays byte for byte, checked by
code. On the round trip of 2026-11-09 a request to rename one output renamed
the offering, its step and its skill folder too; now it changes that output's
name and its about, and nothing else.

From 0.10.1 the structure keeps what the hn-digest build (2026-11-11)
lost. A setting a person or a job sets whose kind is a value
type (integer, number, string, boolean) is a run-config preference with its
default and range. Each model system the architecture record names is
declared as kind model with its protocols, even where the spec lists none,
so the install places its four settings (Common Agent Section 12.4.1). A
keyless public service the record binds to itself (architecture standard
1.1.0, section 2) is declared as a service whose address setting has the
binding's address as its default. And the record's `cost_limit` is the
model system's ceiling in Common Agent's shape (Section 12.4, item 4), read
by `ceilingOf` in `scripts/structure.mjs`.

From 0.12.0 a spec is ready only when every requirement is checked by a
scenario and what the agent refuses, what it does when it finds nothing to work
on, and what it does when a system it reaches fails are each stated
(`coverageProblems` in `scripts/spec-check.mjs`, stages.json 1.7.0). The ADLC
plugin's Requirements check runs this same rule, so a spec this agent calls
ready is never held in the build folder. A revision may add what is missing to
the features even when the person's words name none of them.

From 0.12.1 a system's address is settled at Requirements too
(`systemAddressProblems`): a service that takes no key names its own `address`,
unless its why says it fetches whatever address the caller hands it, and its
address is never a setting of the spec. The agent's own files were already held
to this; now the spec is, before the person approves it.

From 0.11.0 a system in the spec says what the scripts need to reach it
(spec-v1 1.3.0, Common Agent Section 12.4, item 3): its `credential`, by name
and the environment variable it is read from, or `"none"`, and its
`settings`, each value the host supplies by variable and purpose. The Design
places both on the system, so `agent-runtime-requirements.json` declares the
credential and every variable a script reads to reach it, with no value.

From 0.10.2 an offering's inputs and outputs go from the person's words to
the files whole. The spec step writes each piece in its feature's `inputs`
or `outputs` (spec-v1 1.2.0: name, kind, whether it is required, who gives
it, its shape in words in `about`), whether the person names it in the
request or in an answer to a revision: words that name a piece the spec does
not have open the features' pieces (`namedTargets` in `scripts/revise.mjs`).
The Design declares every piece the spec carries, with the spec's `about`,
which the model does not write again. An offering the spec gives no output,
or never says the input of, is asked in blanks and in still-open.md
(`outputs-<offering>`, `inputs-<offering>`), never delivered empty.

`scripts/spec-check.mjs` holds every spec to the schema (`scripts/spec-v1.mjs`
validates it with no dependencies), to a scenario per feature that checks
requirement ids it has and is Gherkin, to every quote, rule value and
interface of the record byte for byte, to no value nobody gave, and to the
person's name, price and access. What it finds goes back to the model once;
then code fits what it can and says what still stands. The job delivers
`out/spec.json` and `out/spec.md`, the same spec readable by a person.
[references/what-a-good-spec-carries.md](references/what-a-good-spec-carries.md)
says what goes in a spec, and then what goes in the agent's own files.

## Writing a process

Its second offering, `write-a-process`, takes work somebody describes that
passes between several agents or people, or waits for a person to approve it,
and writes it as an Agent Processes 0.9.0 document
(https://agentprocesses.ai/spec.html): the trigger and what a run is handed,
whether runs overlap, the goal, every step with who holds it by role or by the
kind of agent it needs, its automation level, the handoffs, the ways back,
the bindings, policy and measures. It replaced the
[solution planner](../solution-planner) (owner, 2026-11-01): a build whose
artifact is a process carries that one document from Requirements on, and
every later stage reads it.

One command does the job (`scripts/process.mjs`). The model drafts the parts
as JSON; code writes the document from them (`scripts/process-draft.mjs`), so
a key is on every handoff and no step names an agent. The process check
(`scripts/process-check.mjs`, [standards/process-check.mjs](../../standards/process-check.mjs)
byte for byte) runs over every document before it goes; what it finds goes
back to the model once, and what is still wrong after that is said and asked
rather than passed on. The name, the owner, who signs and what may reach
outside are always asked. The planner's refusals carry over: no messages to
many people who did not ask, no deception or harassment, no action on or
signing in to an account the person does not own, no spending money.
[references/what-a-good-process-carries.md](references/what-a-good-process-carries.md)
says what goes in a document and why.

## What the given names, and what it reaches

The agent's own files are made from the spec, so their given is the spec
(`scripts/given.mjs`, `givenOfSpec`): its settings, runtime, price, the
systems it reaches, its output schemas and the modules its interfaces name.
Code then holds the draft to it (`scripts/design.mjs`): the name, version and
price are the spec's, each address setting has the spec's name and default,
each host the spec only writes down is named in a service's `needs`, and no
address sits anywhere but a setting's default, because the package maker
refuses a descriptor that carries one.

Before 0.9.0 the given was what the person sent (words, attachments, answers,
or an as-built record of existing code), and the same checks read it there:
`scripts/given.mjs` checks, with no model, that every setting, runtime,
price, address, JSON Schema, quoted word or pattern and exported function the
given names is in the draft, and that an output of a JSON kind whose shape the
given does not state is asked about (`shape of <output>`) rather than
sketched. Every outside system a job reaches over the network is declared the
way the security reviewer reads it (`scripts/reaches.mjs`): a public read
with an address setting whose default is the real address and whose host its
`needs` names, and pages handed at run time as a service that fetches them.
What these find goes back with the second ask; then code keeps what it can
without guessing, and the reply says what still stands and which address
settings the install supplies.

## Standing assets

Given an architecture record, the draft declares exactly the standing assets
its `Standing assets` section decides, as `can_use` entries, each with
`reads`, `required`, `does` and `without`, and none where the record says
none (the architecture standard, section 10). The model drafts the entries;
`scripts/can-use.mjs` then takes out any the record did not decide, and adds
any it left out (or fills an empty member) from the house rule in
[`standards/standing-asset-schemas.json`](../../standards/standing-asset-schemas.json),
which this agent reads at the version [standards-pins.json](standards-pins.json)
pins (`test/standards-pins.test.mjs` holds the pin). The draft's notes say
what code changed.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- A text model for the one judgment in the job: the system of kind `model` named
  `text-reasoning`, reached through the shared caller
  (`scripts/model-caller.mjs`) and the four settings the install places:
  `MODEL_NAME`, `MODEL_ENDPOINT`, `MODEL_KEY` (empty for a gateway on the
  host) and `MODEL_PROTOCOL` (`anthropic-messages`, `openai-chat` or `gemini`, the three
  formats the shared caller speaks), read on every run. The
  package names no model and no address of its own. With a setting
  missing the job is refused in words.
- Python 3 and the package maker's `build.py` on the host to check each draft.
  It looks for `/opt/fleet/agentbuilder-build.py`; set `BUILD_PY` to point it
  at `../package-maker/build.py` or your own builder. Without one the files
  still go out, written by `scripts/files.mjs` (the builder's own projection,
  held to it byte for byte by `test/files.test.mjs`), and the reply says the
  build check did not run.

## Running it

This folder is a package source. Its offerings and steps are declared in
`agent-descriptor.json` and `agent-runtime-requirements.json`, each skill's
instructions are in `skills/<slug>/SKILL.md`, the scripts are in `scripts/`, and the standing rules the model
works under are in `rules.md` and `references/`.

```sh
node --test test/*.test.mjs                                   # 315 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

Install the package on any host that runs Agent Packages, bind
`text-reasoning`, and send it a request.

## Replacing it

This is a reference implementation. Any agent that holds the spec writer role
can take its place, and its output is checked the same way: a spec valid
against spec-v1 that carries what the as-built record fixes, files the package
maker accepts, and the open questions named.
