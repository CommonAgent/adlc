# What a good spec carries

Read off the eight specs that already exist and the packages built from them,
not invented. Every number here was counted on 2026-09-13 across brand-reader,
brief-writer, explainer-critic, explainer-maker, process-runner, publisher,
quiz-maker and video-watcher: 43 jobs between them.

This is the reference the drafting step works from. It says what a spec that
produced a working agent carries, and where the existing eight are thin.

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

### Addresses are never settings

The builder refuses any package whose install file carries an address, so a
setting never holds one and a setting's `purpose` never names one. There are
three cases, and each has its own place:

- A product somebody binds (a database, a mail service, a model): the system
  name and the credential name. The installer binds the address from what the
  account chose. Nothing in the spec says where it is, and for a model nothing
  says which one: see the next section.
- A public read that needs no key (a public web page, an open API anybody may
  call): declare it as a system with `"access": "read"`, `"kind": "service"`,
  `"leaves": true` when a caller's material is sent to it, and no credential
  and no settings. The address itself is written in the script as a constant,
  which is where the publisher's `published-address` keeps its own. "The base
  address should be changeable" is not a reason to make it a setting: a
  different address is a different version of the script.
- An address the caller gives with the job (a page to read): an input of kind
  `url`, never a setting.

### A model is a bound system, never a name

A job that calls a model declares the capability as a system with access
`trigger`: `text-reasoning` for text, `image-reading` for pictures,
`speech-to-text` and `text-to-speech` for speech. The system's `purpose`
says what the job needs of it, such as "reads a whole 200-page document at
once" for long context. The scripts read the model from configuration,
`AGENT_MODEL` or `TEXT_MODEL`, through the shared caller, so the install
binds it and a run config can override it.

    { "name": "text-reasoning", "access": "trigger", "kind": "service",
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
  `` `{cues, font}` ``.
- **Never bare `application/json`.** The package maker refuses a new agent
  that declares it, and warns on an agent released before the rule. A
  revision of a released agent keeps a piece it already sends that way and
  says so in the notes; converting it is its own decision.
- **Who gives each input.** `given_by`: `person`, `agent` or `either`
  (Common Agent 6.13, proposed; optional, so it is safe to write).

      { "name": "page", "kind": "url", "required": true, "given_by": "person" }

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
