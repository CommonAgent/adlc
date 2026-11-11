# What a good spec carries

The spec is what Requirements hands back (stages.json 1.6.0): the analysis of
the product's functional requirements and capabilities, in the shape of
standards/spec.schema.json (spec-v1). It says what the product must do and how
anyone can tell that it does, in a form a test writer can write tests from
without guessing. It is not the agent's descriptor. The descriptor, the
runtime requirements, the plugin manifest and the skills are the agent's own
files, made from the spec at Design; the second part of this reference, from
the heading "The agent's own files, made from the spec", says what they carry.

Until 0.9.0 this agent handed back those files as the spec. A descriptor has
no place for a stop pattern, a page reader's sources, the words of a refusal
or an output's schema, so in a round trip on a real agent on 2026-11-09 the
as-built record captured all four exactly, and none of them reached the tests
or the code. The spec is where they now go.

## Features

A feature is one capability of the product, with an id that stays the same
across versions (`F1`, `F2`, ...), a name of a few words, one sentence saying
what it does, and the offering it belongs to when there is more than one. A
feature built from an as-built record says which behavior it is (`as_built:
B3`). A feature the person approved earlier keeps the id it was approved
under, because tests, findings and history name it.

Every feature has requirements and at least one acceptance scenario. A
feature with neither cannot be tested, and a feature that cannot be tested is
a wish.

## Requirements

Each requirement carries the attributes ISO/IEC/IEEE 29148:2018 (section 5.2)
names: an id (`F3.R2` under a feature, `C2` for a constraint), one statement
written with shall, its kind, a rationale where one helps, a priority (must,
should or may), its source, and how it is verified (inspection, analysis,
demonstration or test).

The statement is one sentence: "The agent shall refuse a harbor code that is
not four capital letters." Write it so somebody who was not there can tell
whether the product does it. "The agent shall be careful with harbor codes"
is not a requirement.

The kind says what sort of rule it is: `behavior`, `input`, `output`,
`refusal` (what it declines, and the words it says), `error` (what it does
when something fails), `limit` (a number it holds to), `order` (which source
first), `wording` (words it must say exactly), `pattern` (a pattern it must
recognize exactly), `default`, `interface`, `security`, `performance` or
`runtime`.

The source says where the requirement came from: the person's words (`said`)
or a behavior of the as-built record (`behavior`, with `evidence`, each a file
and a line). A requirement with no source is one somebody made up.

## Exact words, patterns and numbers

`exact` holds what a requirement fixes, each value as it must appear, so a
check can find it byte for byte in the tests and the code: a regular
expression as written, slashes and flags included; a reply sentence or a
refusal, a template with its `${...}` as written; a format id; a number. The
test writer checks each one, and the code writer is held to it. A value goes
in `exact` only when the given states it. A value nobody gave is asked in
`open`, never fixed: a fixed value is built and tested as though it were
decided.

## Acceptance scenarios

Each acceptance criterion is one Gherkin scenario, kept as Gherkin text: a
`Scenario:` line, then `Given`, `When` and `Then` steps (`And` and `But`
allowed), with `checks` naming the requirement ids it checks. The test that
checks it carries its id in its name, `[F1.A1]`. A scenario that checks a
requirement with exact values says them in its Then steps as they are written
in exact.

    Scenario: a stop notice is answered and nothing is done
      Given a message that reads "stop that"
      When the agent reads it
      Then it answers "Nothing was in progress, so nothing was done."
      And it writes no file

## Interfaces

The interfaces are what the product presents to other code and people:
commands and their flags, files it reads and writes (each with its JSON
Schema), messages, functions other code calls (each with its module and
signature), and settings. `keep: true` means the interface must stay exactly
as given, because a rebuild keeps it or a dependent relies on it; `keep:
false` means it describes today's shape and may change with the person's
approval. A rebuild from an as-built record keeps every interface the record
gives, and the person can loosen one.

Since spec-v1 1.1.0 two more kinds are kept with their values. A constant is
a value a module exports (`MOST`, 12, from scripts/tides.mjs). A declaration
is a name or value the agent declares to the platform, with where:
`declared_in` names the file and the place in it, such as
`agent-descriptor.json offerings[0].outputs[1].name`, and `value` is what is
declared there. Offering ids, step ids, each input's and output's name and
kind, labels, run-config settings and run commands are declarations. A
command also says which of its flags it cannot run without
(`required_flags`), and a file or message says the only values a field may
take (`values`, by JSON pointer: `{"/tides/*/kind": ["high", "low"]}`).

## Constraints, systems and settings

Constraints are requirements on the whole product rather than one feature:
time, size, cost, the runtime and platform, security and data. They have the
same shape as a feature's requirements, ids `C1`, `C2`, ...

The systems are every outside system the product reaches or names: what it
does with it (`reach`: read, write, read-write or none), the address when one
is fixed, and why. An address the product only writes down and never calls,
such as a link it puts in what it hands back, is a system with reach `none`,
so whoever reviews its security can match it. The settings are what a person
or an install can set: name, kind, default, range and what it changes. The
address of a system it reaches is a setting too, with the address as its
default; it is the one place the files will carry one.

A setting's kind is one of six words. What a person or a job sets is a
`preference` (the closest layer wins) or a `rule` (the tightest layer wins),
or `run-config` where that is not yet decided, with `set_by` person or
either. What the install places is an `address` (where a system it reaches
answers), an `environment` (a variable the code reads) or a `credential` (a
secret, never written down), with `set_by` install. The type of the value
is said by its default, its `min` and `max` and its `values`, not by the
kind: a count of stories is a `preference` with the default 30, min 10 and
max 100, not a kind `integer`. The Design reads a setting of any other kind
that a person or a job may set as a preference.

## The name, the price and access

The name, the price and access to any system are the person's. A name they
did not give is `agent-not-named-yet` with `name` asked in `open`; a price
they did not set is absent with `price` asked; a system nothing given names
is not reached, and `systems` is asked. The checks put back any the model
settled.

## From an as-built record

When the record of code that already exists comes with the request, code
seeds the spec from it before the model is asked anything (scripts/seed.mjs):

- each behavior is a feature (`as_built: B<n>`), unless the person dropped it
  or called it a bug;
- each quote is a requirement of kind wording, or pattern for a regular
  expression, with the quote in exact and the behavior and its evidence as
  source;
- each rule is a requirement of its kind (order, limit, default; a header is
  an interface), with its values in exact: its quote, and every number,
  quoted word, tag and file name its words name;
- each refusal is a refusal requirement with its words in exact, and each
  error handling an error requirement in its words;
- each constant a behavior uses is a requirement with its value, and an
  exported one no behavior lists is a constraint;
- each interface is kept, a function with its module and signature, a command
  with its flags and the flags it requires, a file with its schema and its
  allowed values, a constant and a declaration with its value (and a
  declaration with where it is declared);
- each address the code reaches is a system with an address setting, and
  each one it only writes down is a system with reach none;
- the record's settings are the spec's, each with the default and range its
  declarations give, and an open question for each default the record
  withholds;
- each entry of the record's strings.json (reverse engineer 0.3.0), the
  inventory of every string a person reads and every pattern the code
  matches, lands byte for byte in some requirement's exact: under the
  feature whose behavior's evidence covers its line, else under the feature
  anchored to its file, as a wording requirement (a pattern requirement for a
  pattern) where no requirement there carries it already; a string in no
  behavior's file is a constraint, and one of a behavior the person dropped
  is not kept.

The model then writes what code cannot: a clear shall statement for each
requirement, the purpose, a Gherkin scenario for every feature that checks
its requirements, and the open questions. Code keeps every value it seeded,
and the check holds every quote, rule value, refusal, string, interface and
kept value of the record to the spec byte for byte.

## A revision

On Ask for changes or Send back to Requirements, the person's words name what
changes: an id, the name, the price, the purpose, a setting, a system or an
interface by its name, an open question by its key. Only those change, by
edits addressed by id, and every other part of the spec stays byte for byte.
A revision is never a fresh draft: in the round trip of 2026-11-09 the old
writer redrafted on every round and ignored the words that named a change
five times out of eight. A declaration is named by its value in a sentence
that renames it ("rename the output tides to next-tides"), as a whole word,
so the words open that declaration and the features whose pieces carry the
name, and not the offering called read-the-tides. Words that name nothing in
the spec, such as a change to a job's when line, leave it byte for byte as it
was, with no model asked, and go to the agent's own files.

## The open questions

`open` holds what only the person can settle, each with its key and the
question. A spec with an open question is not approved until it is answered
or the person says it stays open. Ask the question you would ask a colleague,
in a sentence, and never answer it yourself.

# The agent's own files, made from the spec

This part is what the Design drafts the agent's own files from, and in it
"the spec" and "the draft" mean that draft: the one JSON document files.mjs
writes the descriptor, the runtime requirements, the manifest and the skills
from. Its given is the approved spec above, not the raw request.

Read off the eight specs that already exist and the packages built from them,
not invented. Every number here was counted on 2026-09-13 across brand-reader,
brief-writer, explainer-critic, explainer-maker, process-runner, publisher,
quiz-maker and video-watcher: 43 jobs between them.

This is the reference the drafting step works from. It says what a spec that
produced a working agent carries, and where the existing eight are thin.

## Code writes the structure, the model writes the prose

From 0.10.0 the structure of the files is written by code from the approved
spec (scripts/structure.mjs), and never by the model. In the round trip of
2026-11-09 the files were a fresh model draft every time: asked to rename one
output, the draft renamed the offering, its step and its skill folder too,
and the build could never pass, because the files disagreed with the spec.
So:

- the offering ids, the step ids and the skill folder names are the spec's
  declarations when it keeps them; otherwise they are the slugs of the
  features' offerings, in the order the features name them, which change only
  when the features do;
- each input's and output's name, kind and schema are the declarations', else
  the spec's pieces (from an as-built record, the files the code writes, a
  file `out/stories.json` being the piece `stories`, with a kind from its
  extension when the spec gives none); a schema carries no address, which the
  spec keeps;
- the labels are the ones the spec keeps; the run-config settings are the
  spec's settings a person or a job sets (a preference, a rule, a run-config,
  or a value kind such as integer with `set_by` person or either), with their
  default, range and allowed values (a whole number range steps by one);
- the systems are the spec's systems it reaches, each with the address
  setting the spec lists for its address, or one named for the system when
  the spec lists none; an address sits only in that setting's default. Each
  model system the architecture record names is declared, as kind model with
  its protocols, even where the spec does not list it, so the install places
  its four settings (Common Agent Section 12.4.1). A keyless public service
  the record binds to itself is declared as a service whose address setting
  has the binding's address as its default, matched to the spec's service by
  the host of its address, even where the spec does not list it. The
  record's cost limit is the model system's ceiling (Common Agent Section
  12.4, item 4): the system says it spends, in the limit's currency, and
  `ceilings` names it, per task or day, with the number as `suggested`;
- each run command is the declared one, else the command interface the spec
  keeps, in the packaged form `{home}/{package}/skills/<slug>/scripts/...`,
  with each flag and what the host puts after it (`--job {job_dir}`, `--records
  {records}`, `--work {work}`, `--text-file {job_dir}/message.txt`, and `--file`
  once per attached file); a required flag the host has nothing for is a
  finding;
- the scripts are the modules the spec's interfaces name; the runtimes are
  the spec's runtime constraints, and node wherever a command runs it; the
  price is the spec's.

The model writes only the prose, by key: the description, the refusals, each
job's does, when, good, empty and instructions, each piece's about and each
system's needs. An answer to anything else is not read. Then code checks the
files against the spec (scripts/declared.mjs): every declaration it keeps is
at its place in the files with its value, and the package maker's own check
runs as before.

A revision of the files is an edit. The structure is written again from the
spec, so it changes only when the spec does. The prose of the files delivered
before is carried over; the model is asked only for the prose the person's
words name (a job by its slug or title, a field such as its when line, a
piece or a system by its name, the refusals, the description) and for any
prose the new structure adds; every other field stays byte for byte, and the
check says so if one does not.

## The four sentences on every job

Every one of the 43 jobs carries `when`, `good` and `empty`. There are no
exceptions, and a job missing one of them is not finished.

**`when`** says when this job is the right one. It is the shortest field:
median 14 words, never more than 28. It is written for somebody choosing
between jobs, not describing this one. "when a piece of work is finished and
somebody needs an address they can open, or send to somebody else" is the
whole of the publisher's.

**`good`** says what a good result looks like, and it is the longest field:
median 47 words, up to 103. It describes the artifact, not the effort. The
publisher's says the address opens, serves exactly the bytes handed over, and
has the digest of each file recorded beside it so anybody can check later.
Every clause there is checkable by somebody who was not present.

**`empty`** says what happens when there is nothing to give: median 33 words.
It is not an error message and it is not an apology. It says what the agent
does instead, and it is where the refusals become visible to a buyer. The
publisher's says that a file not handed over is not published, that it does
not go and fetch one, and that an address whose bytes differ is not given as
good.

**`does`** is one line for a reader skimming the package: median 21 words.
Four of the 43 jobs have none, all four in explainer-maker, all four steps
rather than offerings. That is the gap, not the pattern: write one.

## Jobs are offerings or steps

An offering is what a caller orders. A step is what the agent runs to deliver
it. Six of the eight packages offer exactly one thing and carry four to six
steps under it. Two offer more, and both had a reason: quiz-maker offers the
quiz and the concept list separately because a person wants to approve the
concepts before questions are written, and explainer-maker offers writing the
story apart from making the explainer because the thing a person wants to
approve is the words.

Offer one thing unless a person needs to approve something in the middle. Then
offer that middle thing too.

## What a job takes, and what it hands back

Each input says whether it is `required`. Two other words exist for the
shapes that flag cannot say. When a job reads any one of several kinds of
thing, give each of those inputs `"one_of": "<group>"` and leave `required`
false: brief-writer takes a transcript, a scene list, frames, a page address
or a document, and needs one of the five, which seven optional inputs never
said. Name the group for what the members are, `source`, not for the rule.
When a piece the job files is its working out rather than the deliverable,
give that output `"working": true`: brief-writer's source notes, point and
keep-and-drop are kept so the brief can be checked, and the brief is what the
caller came for. A reader lists the deliverables first and folds the working
out under them; a caller still receives every piece.

## How the job is done

`how` is four words: control, intelligence, cost, contract. Across the 43:

- 25 are `script / none / none / full`. A program, no model woken at all.
- 7 are `script / called / metered / full`. A program that calls a model at a
  named point, for the judgment only.
- 11 are `model / open / ... / ends`. A model in control.

Thirty two of forty three are programs. That is not an accident of style. The
first multi-agent run failed three times in the same way: a method written
down in full and handed to a model to improvise. The builder now refuses that
combination outright, and refuses its mirror, a program that hands the work to
a model to find its own way.

So the default for a new job is `script / none / none / full`, and the step
up is `script / called / metered / full` when a judgment is genuinely needed.
A model in control has to earn it, and when it is in control the contract is
the ends and never the method.

## What it will not do

Every package names refusals: five at the fewest, seventeen at the most,
around six or seven typically. A refusal is an act the agent will not perform,
written as a gerund, then a sentence saying why and what happens instead.

> Publishing anything it was not handed. It does not fetch a file from an
> address in order to publish it, so nothing can be put in front of the public
> by naming it.

That is the shape. An act, then the reason, then the consequence. What it is
not is a rule, a value, or a policy. "Be careful with credentials" is not a
refusal. "Accepting a credential value pasted into a message" is.

The refusals are the agent's authority for saying no, so each one is written
so that a reader can tell whether a given request falls under it.

## What it leaves behind

Records run from six to eleven per package. Every package declares the signed
job manifest of each delivery. Most declare a per-task record for each step
that produces something worth keeping, named `*/something.json` so it lands in
the job's own folder. Two declare a standing record that outlives any one job:
the publisher keeps every name it has published under, so a name it did not
place is not quietly replaced.

A record is declared so that somebody can audit it later, which means it is
written whether the job succeeded or not. A spec that only records success has
recorded nothing useful.

Two records belong on every new spec by default: `*/went-without.json`, what
the job did not have and did anyway, and the signed job manifest.

## What it reaches

When an architecture record came with the request, what it reaches is
settled already: the draft's systems are the record's, by name and access,
and a step that needs another is asked of the architect rather than declared
(the Architecture stage's standard, standards/architecture-standard.md). A
keyless public service the owner approved is one of the record's systems,
bound to the service itself (`itself at <address>, no key, read, approved by
the owner in egress-1`), so it is declared like the rest, with that address
as its address setting's default.
The same holds for its standing assets: the draft's `can_use` is exactly the
record's "Standing assets", one entry per schema, each with `reads` (the
fields the agent reads), `required` (false unless the job cannot be done
without it), `does` (what the agent does with them) and `without` (what it
does when none is given), and no `can_use` where the record says none. The
rest of this section is how a system is declared once it is named.

Systems run from zero to five. process-runner declares none at all and still
reaches the platform, with a token scoped to one route family, which is worth
knowing: a system is for a directory, an MCP server or a service the package
is bound to at install, not for every address it ever opens.

Each system names its access, read or write or trigger, its credential by
name, and the settings its scripts read by variable name. A credential is
always named and never carried.

The system's own name comes from the reserved list the platform publishes,
not from your imagination: `database`, `files`, `sign-in`, `mail`,
`text-reasoning`, `image-reading`, `speech-to-text`, `text-to-speech`,
`draft-host`, `activity-record`. The name says the SHAPE and never the
product. The account that installs the agent says which product stands
behind it, and the same package runs for one customer on Supabase and for
another on something else. A request that says "store the results in our
Supabase" declares `database` and says Supabase in the prose, because the
product is a fact about that customer and not about the package.

Two names carry a convention the shared scripts already read, so use them
and nothing else: a `database` system binds `DATABASE_ADDRESS` and
`DATABASE_KEY`, and a `files` system binds `FILES_ADDRESS` and `FILES_KEY`,
with `FILES_PREFIX` as a setting where the job writes under a folder. A
package that needs either ships `store.mjs` or `files.mjs` as it stands.

A name outside the reserved list is allowed and costs something: the deploy
then needs somebody to bind it by hand, so raise it as a blank and say what
shape you meant, rather than inventing a word and moving on.

`draft-host` is brokered, and a brokered system is declared with less. The
agent never holds a key for it: each time it places a file it asks the mesh
for a short-lived grant under its own job credential, and the host binds the
system at install. So the entry names the system, its access and what it
needs, and nothing else: no `credential`, no `env`, no `settings`. The
publisher in the worked example is written that way. A spec that gives
`draft-host` a credential asks for a key no host holds, and the install
stops on it.

### Where an address goes

The builder refuses any package whose install file carries an address, so a
setting's `purpose` never names one and a system's `needs` names a host but
never a whole address. The one member that may hold an address is an address
setting's `default`: the builder writes a setting's variable and purpose into
the install file and leaves the default out, and the install supplies the
value. There are four cases, and each has its own place:

- A product somebody binds (a database, a mail service, a model): the system
  name and the credential name. The installer binds the address from what the
  account chose. Nothing in the spec says where it is, and for a model nothing
  says which one: see the next section.
- A public read that needs no key (an open API anybody may call): declare it
  as a system with `"access": "read"`, `"kind": "service"`, `"leaves": true`
  when a caller's material is sent to it, no credential, and one address
  setting: a variable ending in `_ADDRESS`, `_URL`, `_BASE`, `_ENDPOINT` or
  `_HOST`, a purpose saying where the service answers, and the real address as
  its `default`. Its `needs` names the host that address is at. A script
  carries no address of its own (Common Agent 12.6 rule 2, the address check
  of 12.10): it reads the address from the setting the install places. This
  is also how the security reviewer matches the call: a program that reads a
  declared service's address setting reaches that service, and a destination
  is matched to a system by the host its reason names.

      { "name": "tide-service", "access": "read", "kind": "service",
        "needs": "reads the day's tide table from the public tide service at tides.example.org",
        "settings": [{ "env": "TIDE_SERVICE_ADDRESS",
                       "purpose": "where the public tide service answers, its base address",
                       "default": "https://tides.example.org/v2" }] }

- Pages at whatever address the job is handed at run time (each page a story
  links to): one more read service, with no address setting, whose `needs`
  says it fetches them, with the word "fetches". The security reviewer reads
  a read service whose reason is fetching what it is handed as covering those
  calls, and "requests" is not that word: a rebuild was refused on it on
  2026-11-09.
- An address the caller gives with the job (a page to read): an input of kind
  `url`, never a setting.

check-spec.mjs holds a new draft to this (scripts/reaches.mjs), and the
reply names each address setting the install supplies, with its default.

Nowhere else in the draft does an address go: not in an output's `about`, a
job's `does` or instructions, a system's `needs` or a refusal. The package
maker refuses a descriptor that carries one, and on 2026-11-09 a round trip
stopped at Package because an output's about wrote out the address of the
source it names. Name the host in words. scripts/design.mjs finds an address
anywhere else while the model has the draft, and after the second go writes
each as its host; the spec's systems keep the address.

An address the spec says the agent only writes down (reach none) gets no
system and no setting of its own. Its host is named in the needs of the
service that writes it down, "writes down links to news.example.com, which it
never calls", because the security reviewer matches every host a program
writes down to a system whose reason names it.

## What the given names, the draft keeps

From 0.9.0 the given is the approved spec (scripts/given.mjs, givenOfSpec):
its settings, its runtime constraint, its price, the systems it reaches at an
address and those it reaches with none, the schemas of its outputs and file
interfaces (each constant that is an address left to the spec), and the
modules its interfaces name. The exact words, patterns and numbers, and the
functions it keeps, are the spec's; Test and Code read them there, and the
files are not held to copying every one. Code then fits the draft to the
spec: the name, the version and the price are the spec's, each address
setting has the spec's name and default, and each host only written down is
named in a service's needs.

Before 0.9.0 the given was what the person sent, words, attachments and
answers. It may be notes or an as-built record the reverse engineer wrote
from code. Whatever it names exactly, the draft carries exactly, and
scripts/given.mjs checks it by rule, with no model:

- every setting it names, as a setting in the spec's own `run_config` (a
  `run_config` inside a job is dropped by the files) or a system setting;
- the runtime it names (node, and its version), and node wherever a job's
  command runs it;
- the price it states;
- each address the code reaches, as an address setting's default, and each
  destination handed at run time, as a service that fetches what it is handed;
- each JSON Schema, its properties and constant values word for word;
- each word or pattern it quotes, in backticks or quotation marks, and each
  exported function it names, carried into the job's instructions as written.

Where it does not say what an output of a JSON kind holds, the draft does not
sketch one: the shape is a blank, `shape of <output>`, with the question. A
sketch nobody gave is built by the test writer and the code writer as though
it were decided; on 2026-11-09 a rebuild invented `{stories, read}` for an
output whose real shape the record did not state, and none of the original's
tests could run against it. A Markdown piece's convention is still drafted,
as above, and a revision keeps the shape the agent already declares.

After the second go, code keeps what it can without guessing: a job's
`run_config` moves to the spec, the runtime and price the given names go in,
and each shape not given is asked. What still stands is said in the reply.

### A model is a bound system, never a name

A job that calls a model declares the capability as a system with access
`trigger`: `text-reasoning` for text, `image-reading` for pictures,
`speech-to-text` and `text-to-speech` for speech. The system's `purpose`
says what the job needs of it, such as "reads a whole 200-page document at
once" for long context. A model called in one of the three request formats of Common Agent 12.4.1
is the agent's one system of kind `model`, with its `protocols` and with no
credential, variable or setting of its own. The scripts reach it only through
the four settings every agent reads, `MODEL_NAME`, `MODEL_ENDPOINT`,
`MODEL_KEY` and `MODEL_PROTOCOL`, on every run, through the shared model
caller (scripts/model-caller.mjs), so the install binds it and a run config
can override which model.

    { "name": "text-reasoning", "access": "trigger", "kind": "model",
      "protocols": ["anthropic-messages", "openai-chat", "gemini"],
      "purpose": "judges which sentences on the page are its key points; needs text only" }

A spec never names a model or a version: not in a setting's default, not in
an instruction, not in a sentence. Brand reader shipped with
`gemini-2.5-flash` in a script and answered 404 when Google retired it. The
package maker warns on a model named in an existing agent's scripts or
skills and refuses a new agent that names one.

## What a job takes, in kinds the builder reads

Each input and output has one `kind`, and there are only two forms of it: one
of the four words `text`, `identifier`, `url` and `document`, or one media
type written as `type/subtype` (`text/markdown`, `image/png`,
`application/vnd.agentmesh.site-read+json`). Nothing else builds. "array of
application/octet-stream", "list of urls", "json" and "file" are not kinds.
Several files of the same kind are one input, declared once; the job reads
every file that arrives under it.

## Which kind, for who reads it

Since 2026-10-27 this is a rule, and not only a habit. An inventory of 73
agents that day found 77 pieces sent as JSON that people should have read as
Markdown, about 180 declared as nothing more than `application/json`, and 59
whose declared kind was not what the code sent. Hand-offs broke on them, and
people were given raw JSON to review. The eight packages this reference was
measured on are among them, so do not copy their kinds.

- **Between agents, or for a person: Markdown.** `text/markdown`, with a
  light convention: a short header for the few structured fields, then fixed
  headings. Sketch it in the piece's `about`, the header's fields and each
  heading in backticks:

      "about": "Markdown: a header `source, read_at`, then `## Key points` with one bullet per point, then `## Not read` with one line per page that could not be read."

  brief-writer's brief, quiz-maker's concept list and explainer-critic's
  review already work this way, and the code that reads them parses the
  headings.
- **Exact typed data only code reads: a specific JSON kind.** IDs,
  coordinates, timings, numeric series. `application/vnd.agentmesh.<name>+json`,
  with the top-level shape sketched in the `about`, such as
  `` `{cues, font}` ``, unless a person may give it: then the `about` is
  form words and the shape goes in the job's skill (below).
- **Never bare `application/json`.** The package maker refuses a new agent
  that declares it, and warns on an agent released before the rule. A
  revision of a released agent keeps a piece it already sends that way and
  says so in the notes; converting it is its own decision.
- **Who gives each input.** `given_by`: `person`, `agent` or `either`
  (Common Agent 6.13, proposed; optional, so it is safe to write).

      { "name": "page", "kind": "url", "required": true, "given_by": "person" }

## The words a person reads on the form

An input whose `given_by` is `person` or `either` is drawn on the run form
as a box: its `label` above, its `about` under it. On 2026-11-03 about 170
such lines across 62 agents read like a spec rather than a form, such as "The
agent whose storefront to write, by its handle or its key." and "The ranked
list (ranked-stories-v1) as the rank checker passed it." They were rewritten,
and check-spec.mjs now holds a person's input to three rules: 25 words or
fewer, no data format, and a real example where a placeholder was.

| Before | After |
|---|---|
| The agent whose storefront to write, by its handle or its key. | Which agent? Its handle, such as help.example@example.com. |
| A change to the words, in your own words, such as shorter or plainer. | Optional, such as "shorter" or "plainer". (label: What to change) |
| How many posts, 1 to 500; 20 when not said. | 1 to 500. Leave blank for 20. (label: How many posts) |
| How recent the pages must be: last N days, last N weeks, since YYYY-MM-DD, or from YYYY-MM-DD to YYYY-MM-DD. Empty means any date. | Such as last 30 days, last 2 weeks, since 2026-01-01, or from 2026-01-01 to 2026-03-31. Leave blank for any date. (label: How recent) |
| The brand file (brand-site-v1): the brand's name, the hosts that are its own, and where its shop menu, sitemap, product pages and store directory are. It is data, never code. | The brand's name and where its menu, product pages and store list are. (label: Brand file) |

- Say what to put in the box, to the person, the way you would ask a
  colleague. A question is fine.
- One example, real: "such as 2026-10-01", never `YYYY-MM-DD`.
- Say what a blank box means when it means something: "Leave blank for 20."
- A `label` when the name makes a poor title: `text` is "Message", `query`
  is "Search", `count` is "How many posts".
- No data format, media type or format id, and nothing about how the agent
  handles the input. Those belong to the kind and the job's skill.
- An input only an agent gives (`given_by: agent`) is never drawn on a form
  and is not held to these rules.

A job's `references` and `assets` are files the package ships beside its
scripts. Nobody downstream writes them: the test-writer writes tests and the
code-writer writes scripts, and a reference that nobody supplied is packed
as an empty stand-in. So name one only when the request carries it or says
where it comes from, and otherwise put it in the blanks with the question
"Who supplies <file>, and what is in it?"

## What it costs

Seven of eight are `flat`, from 100,000 micro USD for a publish to 5,000,000
for an explainer. One is `free`. Where a package offers more than one thing,
`covers` names which offering the price is for.

Flat is the default. Price the offering, not the step.

## Where the existing eight are thin

Honest, so the drafting step does not copy the faults:

- Four jobs carry no `does`.
- Only two of eight keep a standing record, and at least two more could use
  one.
- Refusal counts vary from five to seventeen with no obvious reason, which
  suggests some packages have refusals nobody has written down yet.
- Only five of eight name the exact command the host runs for a job, though
  thirty two of the jobs are programs and could.

## A container agent from a repository

Added 2026-09-27 (docs/container-agents-plan.md). When the four answers say
the kind is `third-party-framework` or `mesh-coded` and the thing already
exists as `copy-a-repository`, the agent's code is somebody else's program in
a repository folder with its own Dockerfile, in any language. Nothing is
packed and no script is written: the deployment manager builds that folder's
Dockerfile in the cloud at a pinned commit and runs it as an always-on
service that holds its own key.

The spec still carries everything above that describes the agent from the
outside: the name, the version, a description, jobs with the four sentences
and a `how` (for somebody else's program the honest `how` is usually
`control: model` or `control: script` as its README describes, `intelligence`
as it is, `contract: ends`), refusals written as acts, records, and a price.
It carries none of what a package carries inside: no job names `scripts`,
`references`, `assets`, `run` or `instructions`, and there is no `verify`.

What it carries instead:

- `kind`: `third-party-framework` for code in somebody else's runtime
  (CrewAI, LangChain, Google ADK, Mastra, a harness driven by a program), or
  `mesh-coded` for a program that answers on the mesh itself.
- `claims`: the role ids it says it holds, such as `ring-member`. Its
  conformance check runs against the installed agent after the install.
- `container`, which says where the code is and how it runs:
  - `repository`: `https://github.com/<owner>/<name>`, public.
  - `path`: the folder inside it.
  - `commit`: the full 40-character commit the spec describes. Never a
    branch: a branch moves and the spec must not. Take it from the scan.
  - `dockerfile`: the file inside the folder, usually `Dockerfile`.
  - `placement`: `service`. An always-on service is the only placement for
    now, because the agent holds its own key and its own connection.
  - `holds_own_key`: `true`. A container that does not speak the mesh is not
    an agent this path installs; say so as a blank rather than writing false.
  - `settings`: each variable the program reads that is not a secret, as
    `{ "env", "purpose", "required" }`, with `value` only when the value is
    the same for every install (a server address). The owner answers the
    rest at the deploy.
  - `secrets`: each secret the program reads, as `{ "env", "purpose" }`.
    Never a value. Which stored credential stands behind it is the owner's
    answer at the deploy, like every access question.
  - `port`, `cpu`, `memory`: what the scan found and what it needs; the
    smallest that runs it. A container that answers Cloud Run's health check
    on `$PORT` needs nothing else said.
  - `ready_line`: the line it writes to its log once it is listening, when
    the scan found one. The installer waits for it before it binds the name.

The scan of the folder (repo-scanner, given `owner/name/path`) is the source
for all of `container`: it read the Dockerfile and the code at the commit and
lists what they need. Where the scan and the request disagree, say so as a
blank; never paper over it.

Four things went wrong in container specs written before, so watch for them:

- A job's inputs and outputs use the same kinds as a package's, above. A
  program that takes several files takes one input of one media type.
- A refusal is something the program will NOT do. "Converting a repository
  into a service" is what a converter does, and written as a refusal it tells
  a buyer the opposite of the truth. Read each refusal against the jobs: if it
  names an act one of the jobs performs, it is not a refusal.
- A handle is never written into `settings` or `secrets` as a value. The
  agent's name is one of the three things that are asked for, and its handle
  on the mesh follows from the name and the owner at the install; a setting
  such as `RING_HANDLE` that the program reads is declared with `required`
  and no `value`, and the owner answers it at the deploy.
- When the scan is not attached, the container block cannot be written.
  Write everything else, and put `container` in the blanks with the question
  "Which repository folder and commit is this, and has repo-scanner read it?"
  rather than giving up on the whole spec.
