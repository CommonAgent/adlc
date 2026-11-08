# Standards: the standing assets the Builders read

This folder holds the standing assets every Builder in this repository reads:
the rules the lifecycle holds an agent to, kept once, in one place, at a
version each Builder pins.

| File | Kind (schema) | Who reads it |
|---|---|---|
| [architecture-standard.md](architecture-standard.md) | `https://schemas.agentmesh.ai/architecture-standard/v1` | the solution architect, which applies it; the spec writer, which designs within it |
| [audit-checklist.md](audit-checklist.md) | `https://schemas.agentmesh.ai/audit-checklist/v1` | the auditor, which runs it over an agent version; the deployment manager and the catalog, which read its verdict |
| [stages.json](stages.json) | the lifecycle's 24 stages, in order, in seven phases; each stage's cadence (every build, set up once, or when needed); the roles that hold them; and the evidence formats an outside holder hands back in (`version` in the file; changes in [CHANGELOG.md](CHANGELOG.md)) | the site, whose stages page is checked against it (agenticdevelopment.ai `tools/check-stages.mjs`); the auditor, whose stage names must map to it (`test/stages.test.mjs`); the console |
| [lifecycle-api.schema.json](lifecycle-api.schema.json) | the lifecycle API, version 0.4.2: every request and answer a service implementing the lifecycle gives at `/v1/lifecycle` | a client that shows a build stage by stage; a service author, with [lifecycle-api-check.mjs](lifecycle-api-check.mjs) (see [The lifecycle API](#the-lifecycle-api)) |
| [lifecycle-document.schema.json](lifecycle-document.schema.json) | a lifecycle document, version 0.1: one JSON file holding which stages an organization uses, who holds each role (and with what settings), and the stages it adds of its own, for the organization and each project; no service needed | a person or team defining its lifecycle as a file; the console (`npx adlc-console --lifecycle <path>`), which reads, checks and writes it |
| [process-check.mjs](process-check.mjs) | the check of a process document against Agent Processes 0.9.0: its §17.1 conformance items and the four tests of §20.1 (see [The process check](#the-process-check)) | the spec writer, which runs it over every process document before handing it back; the test writer, which reads a document's phases, deviations and digest through it; review and conformance |
| [standing-asset-schemas.json](standing-asset-schemas.json) | the list of known standing-asset kinds | the package maker, which refuses a `can_use` entry naming any other; the solution architect and the spec writer, which choose from it |

## What a standing asset is

A standing asset is a typed, versioned, non-secret document that an
organization owns and many agents read: a brand profile, a style guide, a
glossary, media templates, the organization's stack, the architecture
standard, the audit checklist. It is what a person means by the
organization's **Library**, one of the three things an agent draws on:

- **Setup**: what the agent is connected to, and with which keys, done once
  by the operator (install settings and system bindings). Secrets live only
  here.
- **Library**: the organization's shared material and defaults (standing
  assets the agent declares in `can_use`, and the default layers of its
  run-config settings).
- **This job**: what you give it, and your options for this run (its inputs
  and that run's run-config choices).

Every standing asset has:

- a **kind**, named by a schema URL with the version in it, such as
  `https://schemas.agentmesh.ai/brand/v1`;
- a **version**, the `sha256:` digest of its bytes;
- an **owner**: an organization, a team or a person;
- an **approval**: a person approves each version (`approved_by`,
  `approved_at`);
- a **layer**, and no secrets.

The Markdown standards here carry `schema`, `name`, `owner`, `layer`,
`approved_by` and `approved_at` in a header at the top. The version is not
written in the file, because it is the digest of the file.

## Layers

A standing asset can be given at five layers, widest first: **publisher**
(a family ships these defaults), **organization**, **team**, **person** and
**job**. A preference is taken from the closest layer that gives it. A rule
takes the tightest: a later layer may only narrow it. A republisher becomes a
publisher for its own buyers. These are the layers and semantics the
AgentMesh run-config resolver already applies to settings.

The standards in this folder are the publisher layer for the Builders
family. An organization may give its own, which the Builders read in their
place where the organization's rules are tighter.

## Across companies

Work content (a brand, a style guide, templates) comes from the
**requester's** library, under the requester's grant: an announcement written
for a customer is in the customer's voice. Build and check standards (the
architecture standard, the audit checklist) come from the **operator's**
library: the operator decides what its Builders hold an agent to.

## How an agent declares what it reads

An agent declares each kind of standing asset it reads as a `can_use` entry
in its Descriptor:

```json
{ "schema": "https://schemas.agentmesh.ai/style-guide/v1",
  "reads": ["voice", "words.avoid"],
  "required": false,
  "does": "writes the announcement in the organization's voice and avoids the words it lists",
  "without": "writes in a plain, neutral voice and says no style guide was given" }
```

`without` says what the agent does when no asset of that kind is given, and
every entry states it. Each run record cites `{schema, version_digest, layer}`
for every standing asset the run used, so anyone can tell which version of
the brand or the style guide a piece was made under.

In the lifecycle, the solution architect's record decides which standing
assets apply to each kind of output, with a reason, or says "none,
because…"; the spec writer declares exactly those as `can_use`; and the
package maker refuses a `can_use` entry whose schema is not in
[standing-asset-schemas.json](standing-asset-schemas.json) or that has no
`without`.

## How the Builders read these files

Each Builder that reads a file here pins it by digest in its own folder (the
solution architect and the spec writer in `standards-pins.json`, the package
maker in `build.py`'s `STANDING_SCHEMAS_PIN`), and its tests fail when the
file here no longer matches the pin. A change to a
standard is therefore a new version on purpose: the change is made here,
approved by a person, and each Builder re-pins, is tested and is released
with it. A Builder's package carries the bytes it pinned, so an agent built
or checked by it was held to exactly that version, and its records can cite
that digest.

## Levels, and raising them

Each check in the audit checklist has a level: `refuse` fails the audit,
`warn` passes it with findings, and `info` is shown in the report and does
not count toward the verdict. The checklist here requires artifacts and
checks, not a particular lifecycle: the artifacts before the package (the
statement, the architecture record, the design, the tests, the review
findings, the security statement) are optional evidence at `info`, accepted
from whoever made and signed them, while the package, its build record, its
deployment record and its conformance verdict, and every agent's signed
Descriptor and registration, are required. An organization may raise any
`info` check to `warn` or `refuse` in its own checklist, a standing asset at
its own layer, because a rule may only tighten as it goes down the layers.

## Changing a standard

Change the file here, in a pull request. Record the person who approved the
new version in its header. Re-pin every Builder that reads it (each Builder's
README says where its pins are), run their tests, and release them.

## The lifecycle API

[lifecycle-api.schema.json](lifecycle-api.schema.json) is what any service
implementing this lifecycle answers, so that one client can show a person's
builds from more than one service. It sits beside [stages.json](stages.json):
a build lists the 24 stages by their ids there, one entry each, and a stage
the service does not run is listed as `not_offered`. Each build carries the
actions the person may take now, and a client draws one button for each
action and nothing else, so every judgment stays with the service. The page
that explains it is https://agenticdevelopment.ai/api.html.

The schema is version 0.4.2, served at `/v1/lifecycle` on the service. It
changes only by adding: a client ignores a field it does not know, and a
service never removes a field or changes its type. Version 0.2 also added
values to two lists, the holder's kinds and the stage's states, and a client
that does not know a state draws the stage as `not_offered`. Version 0.3 adds
one more state, `not_used`, which a 0.2 client draws the same way. Version
0.4 adds products, stage workspaces, each stage's chat and the build's
artifacts; a 0.3 client ignores them. Version 0.4.1 adds the product's boss. Version 0.4.2 adds each stage's
cadence and a product's setup and when-needed lists; a 0.4.1 client ignores
them. Its `operations` list names the
definition each request and answer must match.

**Lifecycle stages.** An organization chooses which of the 24 stages its
lifecycle uses, for the whole organization or for one project, beside who
holds each role. `GET /stages` lists every stage in stages.json's order, each
with whether it is used, where that choice comes from (`project`, `org` or
`default`), and whether this service can run its builds without it
(`can_leave_out`, with `why_not` in words when it cannot). `PUT` and `DELETE`
on `/stages/{stage}` change the choice; the service refuses to leave out a
stage it cannot build without. When nothing is chosen every stage is used.
A build keeps the choice in effect when it started, names it in
`lifecycle`, and reports each stage it leaves out as `not_used`, with no
holder and no actions. `not_applicable` comes before `not_used`, and
`not_used` before every other state.

**Products, stages and chat.** A product is every build of one name, one
build per version (not a project, which is the lifecycle's team scope).
`GET /products` lists them and `GET /products/{name}` gives one product's
builds, its newest run plan and a short activity feed. Each stage of a build
is a workspace, `GET /builds/{id}/stages/{stage}`: what it was given (earlier
stages' artifacts), what it handed back (its own artifacts), what done means
for it, and its gate, whose buttons are the build's actions. Each stage has
a chat with the agent holding it, kept per product per stage across builds:
`GET` and `POST` on `/products/{name}/stages/{stage}/messages`. Answering
changes nothing; a change the person asks for comes back as a proposal of the
build's existing action, with its needs filled, which the person takes with
the actions operation, so a change always goes back through its gate. A
build's `artifacts` list what it made and will make, each with a summary in
its kind's shape. `checkArtifacts`, `checkProducts`, `checkProduct`,
`checkStageWorkspace`, `checkMessages` and `checkMessageReply` in the check
hold these answers to the schema and to the rules it cannot say.

**The boss.** Version 0.4.1 adds a conversation at the product level with
the product's boss, the agent holding Agent Roles §39 (`role-boss`):
`GET` and `POST` on `/products/{name}/boss/messages`, and
`GET /products/{name}/boss/commitments`. The boss answers questions from the
product's record; routes a directive into the chat of the stage that owns it
and says where it went (`routed`); and breaks a larger request into a `plan`
that names each stage in the lifecycle's order and the gate the person meets
at each, proposing the first stage's existing action. When the request
changes the agent's statement, it first proposes `start_version`, which the
person confirms with `confirms` on the same operation; only then does the
reply carry `started`. A stage's action is still taken with the actions
operation, so the boss never answers a gate and changes no artifact. Its
commitments list, in full and oldest first, every message it posted into a
stage's chat, every proposal with the person's answer, every build it
started with the confirmation, and every stage it told to drop work.
`checkBossMessages`, `checkBossReply` and `checkBossCommitments` hold these
answers to the schema and to the rules it cannot say.

**Cadence.** stages.json 1.3.0 gives each stage a cadence. `every_build`
stages are the routine: Requirements, Test, Code, Review, Security review,
Package, Release, Deploy, Conformance, Acceptance and Docs run on every build.
`setup` stages are set up once per product: Source, Architecture and
Design, Publish, Monitor, Eval, Incident response, Cost and Update are given a
holder and settings once, and each later version carries them forward until
someone changes them. `when_needed` stages are actions on the product, run
when something happens: Impact, Retract, Reconfigure, Rollback and
Decommission. From version 0.4.2 a build's stages and each stage workspace
carry `cadence`, and a setup stage whose holder and settings are the same as
an earlier version's carries `carried` ("Unchanged since 0.1.0"), so nothing
is asked again. `GET /products/{name}` adds `setup`, each setup stage with
its role, its holder or null, its settings, `chosen`, `not_chosen` or
`not_used`, and the version it has held since; a holder is chosen with the
roles operations. It also adds `when_needed`, each action with `can_run`: when
true, the build action that runs it, taken with the actions operation; when
false, `why_not` in words. A client shows a build's steps from its
`every_build` stages, the setup stages as a checklist on the product, and
each when-needed action as a button that is enabled only when the service
says it can run it. `checkBuild`, `checkStageWorkspace` and `checkProduct`
hold these to stages.json.

**Role bindings.** An organization chooses who holds each role in
stages.json's `roles`: the service's reference agent, its own agent, a
contracted supplier, a person or an outside tool, for the whole organization
or for one project. `GET /roles` says who holds each one now and where that
comes from, and `PUT` and `DELETE` on `/roles/{role}` change it. The
requester is always the person who asked. An agent bound to a role is sent
the stage's input under the role's offering, `role-<id>`, and its answer is
the stage's asset; the service never calls a vendor's API.

**Evidence formats.** A holder outside the service hands its evidence back
with `POST /builds/{id}/evidence`, in one of the open formats stages.json
lists in `evidence_formats` (SARIF, CycloneDX, SPDX, SLSA provenance, in-toto,
OpenTelemetry traces with `gen_ai` attributes, Pact). The service reads it
for what that list says and shows it on the stage.

[lifecycle-api-check.mjs](lifecycle-api-check.mjs) checks a running service
against it (node 22, no dependencies). It only reads: it asks who the key
belongs to, who holds each role and which stages are used, lists the builds,
reads each build and its tries, and opens the first file each build handed
back. It checks every answer against the schema and holds the rules a schema
cannot say: every stage of stages.json listed once, an action only at a stage
the build offers (a state it does not know reads as `not_offered`), rounds
newest first, a build in the list at a known stage, real ISO 8601 times with
a zone, every role of stages.json in the roles answer, the requester held by
a person, a `not_bound` stage whose role nobody holds, a `not_used` stage with
no holder and no runs, every stage in the stages answer once and in order, and
a stage the service cannot leave out that says why and is used.

```
ADLC_API_KEY=... node standards/lifecycle-api-check.mjs https://example.com/v1/lifecycle/
node standards/lifecycle-api-check.mjs https://example.com/v1/lifecycle/ --key-file ./key
```

The key is one the person makes for their own account, as the service says.
The check reads it from `--key-file` or `ADLC_API_KEY`, refuses it on the
command line, sends it only to the service's own address, and never prints
it. It exits 0 when nothing is wrong and 1 on any problem. `--limit <n>` reads
at most n builds (50 by default), and `--all-files` opens every file instead
of the first of each build. Its tests are `test/lifecycle-api.test.mjs`.

AgentMesh (https://agentmesh.ai) is the first service that implements it.

## The process check

When a build's artifact is a process, it is an Agent Processes 0.9.0
document (https://agentprocesses.ai/spec.html) from Requirements on, and
every later stage reads that one document. [process-check.mjs](process-check.mjs)
reads one and says two things (node 22, no dependencies):

- **failures**: each conformance item of the specification's §17.1 the
  document fails, by the section that states it. The parts a document must
  carry, a version beside an id of the form `<team>/<slug>`, an owner and
  `concurrency:`; phase names in lowercase kebab, once each, each resolving to
  one of the five forms, with `owner:`, `after:` naming declared phases or
  the trigger, and an automation level from the list; a harness phase naming
  its output; a phase that runs a process citing it by id and version, not
  at `never`, with no chain of `runs process` lines back to itself; no cycle
  in `after:`; handoffs and deviations naming phases that exist (or a role
  the roster names, or a destination in prose), saying what crosses, `+`
  only on the sending side and `/` only on the receiving side; the trigger's
  items unique, each saying required or optional; keys unique across
  handoffs, deviations, records and run-scoped lines; run-scoped lines with
  `from:` and `until:`; `roster:`, `systems:` and `data:` with an access word
  on every system; a quality gate; an `extensions:` block last, each
  extension with a version. Whether a goal is a state and a trigger an
  event are a reader's judgment and are not reported.
- **findings**: what the four tests of §20.1 would send somewhere else, where
  a program can see it: a line the specification does not define outside the
  `extensions:` block (`undefined-line`, §20.3), two items the trigger
  carries under one name (`carries-not-unique`), a handoff naming a phase
  that does not exist (`handoff-unknown-phase`), and a gate
  (`automation: never`) that names nobody to sign it (`gate-without-holder`).

```
node standards/process-check.mjs docs/processes/new-process.process.txt
node standards/process-check.mjs outer.process.txt --inner inner.process.txt --json
```

It exits 0 when the document conforms and has no findings, and 1 otherwise.
It reads the grammar the AgentMesh process runner reads, and imports nothing
from it. A document in a Markdown page is read from its fenced block. Its
`--json` result carries the document's `digest`, the sha256 of its text with
line endings written as `\n`, which a test case is pinned to (§21.1). The
spec writer and the test writer carry it byte for byte as
`scripts/process-check.mjs`, and their tests hold each copy to this file. Its
tests are `test/process-check.test.mjs`.
