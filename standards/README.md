# Standards: the standing assets the Builders read

This folder holds the standing assets every Builder in this repository reads:
the rules the lifecycle holds an agent to, kept once, in one place, at a
version each Builder pins.

| File | Kind (schema) | Who reads it |
|---|---|---|
| [architecture-standard.md](architecture-standard.md) | `https://schemas.agentmesh.ai/architecture-standard/v1` | the solution architect, which applies it; the spec writer, which designs within it |
| [audit-checklist.md](audit-checklist.md) | `https://schemas.agentmesh.ai/audit-checklist/v1` | the auditor, which runs it over an agent version; the deployment manager and the catalog, which read its verdict |
| [stages.json](stages.json) | the lifecycle's stages, in order, in seven phases: Reverse engineering, numbered 0, and the 24 after it; each stage's cadence (every build, set up once, or when needed); the roles that hold them; the evidence formats an outside holder hands back in; and the starting points, each with the stage it enters at (`version` in the file; changes in [CHANGELOG.md](CHANGELOG.md)) | the site, whose stages page is checked against it (agenticdevelopment.ai `tools/check-stages.mjs`); the auditor, whose stage names must map to it (`test/stages.test.mjs`); the console |
| [spec.schema.json](spec.schema.json) | the spec, spec-v1: what Requirements hands back, the analysis of a product's functional requirements and capabilities (features, requirements with ISO/IEC/IEEE 29148's attributes, acceptance criteria as Gherkin scenarios, interfaces as JSON Schema) | the spec writer, which writes it; the test writer, which writes a test per acceptance scenario; the code writer and the coding harness, which are given it; the console, which shows it |
| [lifecycle-api.schema.json](lifecycle-api.schema.json) | the lifecycle API, version 0.4.14: every request and answer a service implementing the lifecycle gives at `/v1/lifecycle` | a client that shows a build stage by stage; a service author, with [lifecycle-api-check.mjs](lifecycle-api-check.mjs) (see [The lifecycle API](#the-lifecycle-api)) |
| [runtime-verbs.md](runtime-verbs.md) | how a lifecycle service hands a finished product to the runtime it is given: install, and from lifecycle API 0.4.4 rollback, reconfigure and retire, as one command with a package and a run plan and the verb in the environment | a runtime's author; a service that runs Rollback, Reconfigure and Decommission |
| [lifecycle-document.schema.json](lifecycle-document.schema.json) | a lifecycle document, version 0.1: one JSON file holding which stages an organization uses, who holds each role (and with what settings), and the stages it adds of its own, for the organization and each project; no service needed | a person or team defining its lifecycle as a file; the console (`npx adlc-console --lifecycle <path>`), which reads, checks and writes it |
| [process-check.mjs](process-check.mjs) | the check of a process document against Agent Processes 0.9.0: its §17.1 conformance items and the four tests of §20.1 (see [The process check](#the-process-check)) | the spec writer, which runs it over every process document before handing it back; the test writer, which reads a document's phases, deviations and digest through it; review and conformance |
| [common-agent-pin.json](common-agent-pin.json) | the one version of the Common Agent Specification the lifecycle cites, 0.41.0: its tag and the sha256 of its SPEC.md; a section number cited without a version is a section of this version | every agent in `agents/` and every standard here, whose citations `test/common-agent-pin.test.mjs` holds to it |
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
a build lists every stage by its id there, one entry each, and a stage
the service does not run is listed as `not_offered`. Each build carries the
actions the person may take now, and a client draws one button for each
action and nothing else, so every judgment stays with the service. The page
that explains it is https://agenticdevelopment.ai/api.html.

The schema is version 0.4.14, served at `/v1/lifecycle` on the service. It
changes only by adding: a client ignores a field it does not know, and a
service never removes a field or changes its type. Version 0.2 also added
values to two lists, the holder's kinds and the stage's states, and a client
that does not know a state draws the stage as `not_offered`. Version 0.3 adds
one more state, `not_used`, which a 0.2 client draws the same way. Version
0.4 adds products, stage workspaces, each stage's chat and the build's
artifacts; a 0.3 client ignores them. Version 0.4.1 adds the product's boss. Version 0.4.2 adds each stage's
cadence and a product's setup and when-needed lists; a 0.4.1 client ignores
them. Version 0.4.3 adds features. Version 0.4.4 adds the guided setup and
the when-needed actions. Version 0.4.5 shows features at every stage and
lists the features of a product made before them. Version 0.4.6 starts a build from
existing code. Version 0.4.7 starts a build from the as-built record of code
kept elsewhere, and adds the action back_to_requirements. Version 0.4.8 adds the spec.
Version 0.4.9 adds the skills of a stage's holder. Version 0.4.10 makes each feature of a
version in a run of its own. Version 0.4.11 adds a product's documents. Version 0.4.12 gives the security statement and the architecture record their parts. Version 0.4.13 says which Common Agent rules each artifact was checked against. Version 0.4.14 writes the spec of a version built before specs. Its `operations` list names the
definition each request and answer must match.

**Lifecycle stages.** An organization chooses which of the stages its
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

**Each feature in a run of its own.** From version 0.4.10, once a version's
spec is approved, a service may make each approved feature in a run of its
own: its suite, its code and the person's OK, at the same time as the other
features, each with its own pull request, and a feature approved later starts
its run then. The version itself waits until every run has closed, and only
then goes on to Package. The build answers each run on `feature_runs`, in the
order the runs started, as a `FeatureRun`:

- `id`, the run's id on the build (`F3`, or `F3-2` for a second run of the
  same feature), which an action names as `run`;
- `feature`, the feature's id (`all` for the one run of a spec with no
  features), and `name`, the feature in words (`"F3 Count lines"`);
- `started`, `by`, and `ended`, true once the run closed (the OK merged it,
  or it was stopped);
- `at`, the stage it is at and its state there, with a `summary` in words, as
  a build list item says it;
- `stages`, the stages it holds (Test and Code), each a `Stage` as on a build,
  and `pull_request`, its own, when Code is on one;
- `actions`, what the person may do on it now, each naming the run as `run`,
  and empty once it ended; `log`; and `timeline`, its own bars.

The build's own stages, actions and timeline still read across the runs, so a
client that knows only 0.4.9 shows the build as before: its Test and Code are
the runs' together, its actions include each open run's (each `Action` naming
its `run`), and each `TimelineBar` of a run names its `run`. A client sends an
action's `run` back in the action's request; a service given none takes the
version's own action of that name, else the first run that offers it. The
build list gives a `FeatureRunCard` per run (`feature_runs` on a
`BuildListItem`: `id`, `feature`, `name`, `started`, `at` and `ended`), so a
board can show one card per run beside the build. `checkBuild` and
`checkBuildList` hold that each run is named once and holds each stage once,
that a run's actions name it and stop once it ended, and that an action or a
timeline bar naming a run names one the build has, an action being on that
run's own list too.

**The security statement and the architecture record, in parts.** From
version 0.4.12, a made `security` artifact's summary may give its parts as
the security reviewer's record (security-review-v1) lists them: `reaches`,
each with its `system`, `access` and `reason`; `spends`, each a
`limit` with its `ceiling`; `never_does`, each an `act` with its
`reason`; `no_reason_recorded`, each permission the package asks for that
has no reason; and `architecture_record`, `present` or `absent`, whether
the review read one. The words fields (`reach`, `spend`, `never`) stay, so
a client from before reads them as it did. A made `architecture` artifact's
summary may be an `ArchitectureSummary` (one in words alone still reads as
words), the record's seven parts
(architecture-standard.md section 1): `systems`, `bindings` per system per
environment with `product` and `provided_by`, `dependencies`, `kind`,
`limits` (cost, speed, data, trust), `decisions` each with its reason, and
`egress` per environment, with `questions` still open. `checkArtifacts`
holds that a reach without a reason is listed in `no_reason_recorded`, that a
statement with any such permission has not passed (the stage's done-when),
that every binding is for a system the record names, and that every decision
carries its reason.

**The spec of a version built before specs.** A version built by a spec
writer from before stages.json 1.6.0 has the agent's own files and no spec.
From version 0.4.14, its spec artifact, `not_made`, may carry `backfill`:
whether the spec can be written now, and in words what that does or why not.
`POST /builds/{id}/spec/backfill` gives the spec writer what the version was
asked, its earlier draft and the agent's own files, and it writes the spec
(spec.json and spec.md) for the version as it was built. Nothing else in the
version changes, nothing reruns and no gate is answered: the spec is a record
of the version. The spec artifact is then `made`, with `written_after`
saying when and what it was written from. `checkArtifacts` holds that
`backfill` is only on a spec not made and `written_after` only on a made
spec.

**Each artifact's Common Agent checks.** From version 0.4.13, any artifact
may carry `checks`: the Common Agent rules its stage applied to it, one
`RuleCheck` each. A check names the `standard` (`common-agent`), the
`version` it was read in (0.41.0, the version `common-agent-pin.json` pins),
the `section` by number alone, such as `12.6`, and where the section numbers
its rules, the `rule`, such as `2`. It says what the rule `asks` in plain
words, its `result` (`met`, `not_met` or `not_checked`), and in `detail`
what the stage did, in one line. A client shows "Section 12.6, rule 2" and
the words, so a person reads a table of rules per document and a tally for
the version. A service builds each check only from what the stage's own
records say: a rule the stage did not apply is left out, and one it could
not apply here is `not_checked` with the reason. `checkArtifacts` holds that
each check on a made artifact names its section by number, that a check not
done says why, and that the same section, rule and asks appear once on one
artifact.

**A product's documents.** From version 0.4.11, `GET /products/{name}/documents`
answers the product's documents: one `Document` per stage of stages.json that
names an asset (its `asset` field: Spec, Architecture record, Test suite, Code,
Review findings, Security statement, the package, and on), in stages.json's
order, and no other. Each carries the stage, the asset's `name` as stages.json
gives it, the stage's `cadence`, and a `state`: `made` when a copy stands for
the product now, `not_made` when the stage is in the lifecycle and no build
has made one yet, `not_used` when the product's lifecycle leaves the stage
out (`words` says so). A made document's `current` is the copy that stands:
the `build` and `version` that made it and the `artifact` itself, as that
build answers it, with `carried` true when a newer version exists and did not
remake it, which is how a design made in 0.1.0 reads "unchanged since 0.1.0"
in 0.3.0. `history` lists every version that made one, newest first. A build
still answers its own artifacts; this is the product's view across versions,
so a client can show the standing documents (a setup stage's, or the spec
and the AgentDoc, remade each version but read as one document that evolves)
without walking the builds. A change to a document goes through the stage's
holder, as always: the stage's chat and the build's actions. `checkDocuments`
holds the list to stages.json, each document to its stage's asset and
cadence, and a made one to a current copy made at its stage that heads its
history.

**The holder's skills.** From version 0.4.9 a stage workspace's holder may
list its `skills`, each with its `name`, its one-line `description` and its
SKILL.md in full (`text`), so a person can read what the agent holding the
stage knows how to do. The text comes with the answer, because a skill is not
a file of the build. A service lists what it can read, such as a reference
agent's skills folder, and an empty list says the holder has none of its own.
When it cannot see them, such as for a coding harness the person runs, it says
so in one sentence in `skills_note` instead, and when it says nothing a client
shows nothing. A service may leave both out on a build's stages, where the same
holder repeats. The check holds that a holder lists each skill once, and lists
its skills or the note, not both.

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
when something happens: Reverse engineering (from stages.json 1.4.0),
Impact, Retract, Reconfigure, Rollback and Decommission. From version 0.4.2 a build's stages and each stage workspace
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

**Reverse engineering.** stages.json 1.4.0 adds a stage for code that already
exists. It sits before Requirements and is numbered 0 so that the 24 stages
after it keep the numbers the site and the console show. It runs when
needed, on one of two triggers: adoption, when an existing codebase is taken
on, and drift, when the code changed outside the lifecycle (hand edits,
another team, a vendor drop), which shows when the code's commit differs
from the last one any build knew. On drift the record covers only what
changed since the last record, and each changed behavior goes to
Requirements. A codebase that lives fully inside the lifecycle does not need
it again, because its forward artifacts are already the truth, so it never
runs by routine. The reverse engineer is given the codebase at a named
commit, and its running form if there is one, and hands back the as-built
record:
the behaviors, the architecture as built, the interfaces, the dependencies
and the existing tests and gaps, each claim naming its evidence (a file and
line, or an observed run) and each gap marked. It describes what the code
is. It never judges whether that is right, and it writes no tests, because
deciding what to keep is the person's, at Requirements: each behavior in the
record is approved, flagged as a bug for the backlog, or dropped. So the
stage has no gate of its own. Architecture and Design may be given the
architecture as built, Test the behaviors and the existing tests (for
characterization tests that pin today's behavior until Requirements says
otherwise), and Security review and Impact the architecture as built and
the dependencies.

**Starting points.** stages.json 1.4.0 lists `starting_points`: each names
what someone brings, the stage it enters at, the stages it skips ahead to
(`then`), and why. Existing code being adopted enters at Reverse
engineering; from stages.json 1.5.0, the as-built record of code kept
elsewhere, brought to build it again without taking that code on (a
rewrite, a port or a clean-room rebuild), enters at Requirements; a skill, working code shipped as it is, and a package or an
image enter at Security review; a written business process enters at
Source. `starting_point_rules` holds the two rules every starting point
keeps: one that gets credentials passes Security review first, and however
a build starts, it ends in a valid package.

**Features.** Version 0.4.3 gives the statement of the job a feature list:
each feature has a stable id (such as `F3`), a name, what it does, and the
offering it belongs to. A stage's agent or the boss proposes a new or changed
feature in a reply (`features` on the message), and the person answers that
one feature there: `POST /builds/{id}/features/{feature}/approve` is a
recorded gate decision of Requirements for it alone, and the statement gets a
new version with it; `not_now` keeps it proposed, as a backlog item linked
to the conversation; a person who may not answer Requirements uses `ask`, and
the approvers are told and see the same proposal with its approve button.
At the Requirements gate, features already approved are not asked about
again: the gate carries what the statement still leaves `open` and the
`features` it starts building with. A test names the feature it checks by
starting with the feature's id in square brackets (`[F3] counts an empty
passage as none`), and a round that ran the suite reports `by_feature`.
`GET /builds/{id}/features` and `GET /products/{name}/features[?version=]`
answer a matrix: one row per feature, with a badge (new, changed or
unchanged against the version before), and one cell per column (spec, tests,
code, review, docs) that is done, stale, missing or failing and opens its
artifact at that feature. `GET /products/{name}/features/{feature}` gives
the feature's history across the stages, each entry linked to its message or
artifact. `checkFeatures`, `checkFeature` and `checkFeatureDecision` hold
these answers to the schema and to the rules it cannot say, and
`featuresOfTest` reads the features a test's name gives.

**Guided setup and when-needed actions.** Version 0.4.4 makes the product's
setup stages a short guided flow and lets a service run its when-needed
actions. Each setup item carries a `form`: the role's reference agent, if it
has one, a few `fields` (number, text or choice, each with a sensible
default), `ask`, the question a client sends the product's boss for it ("Who
should monitor word-counter?"), and `shares` when the role holds another setup
stage too (the watcher holds Monitor and Cost). A form is saved with the roles
operations a lifecycle already has: `PUT /roles/{role}` with the holder chosen,
whose `settings` keep this stage's values under the stage's id, beside any
other stage's ({ "monitor": {...}, "cost": {...} }). A setup item's
`settings` are that entry, or, for a holder that keeps none, the settings that
are no stage's entry, as before. A build keeps the lifecycle it started with,
so its run plan and every later version read the saved choices.

A when-needed item the service can run names its `action` with its `needs`
(a `choice` need lists `options` and a `default`) and a `confirm` card: the
`title`, what `will` happen and when it is done, in the stage's own words from
stages.json, the service's `steps` for this product now, `who_may` act (the
lifecycle's approvers for the stage, read as for a gate) and whether `you_may`,
the versions it acts on, what `cannot_undo` (Rollback's own words ask for the
side effects to be named), and for Reconfigure the `changes` between the setup
chosen now and the running version's run plan. A client shows the card on the
button's press, and only the person's confirm posts the action, with the
actions operation, on the build the item names (`POST
/builds/{build}/actions/{stage}`). The answer adds `result` (what it did in
words, what can't be undone, what it handed back, and for Impact the report),
and the item keeps it as `last`. A person the lifecycle does not let act is
refused 403 in words; a holder that refuses, such as the runtime, is kept on
the record and answered 409 with its words. The product also says which
version is `running`, and once it is decommissioned, `retired`, when none of
its when-needed actions can run. How a service hands Rollback, Reconfigure and
Decommission to the runtime it is given is [runtime-verbs.md](runtime-verbs.md).
`checkProduct` holds these to the schema and to the rules it cannot say.

**Features at every stage.** Version 0.4.5 makes features visible beyond the
product's matrix. Each every-build stage of a build carries `features`, a
short count such as "4 of 5 features" that a client shows beside the stage,
and the stage workspace carries the same stage's `features` in full, one line
per feature: Requirements, each feature and whether it is approved; Test, the
tests that check each approved feature, a feature with none marked to do;
Code, how many of its tests pass ("6 of 6 passing"); Review, the findings tied
to it through its tests (the finding's place is a line inside one of its
tests, or the finding quotes a test's name), and the rest `untied`, not tied
to a feature; Docs, whether the docs name it, once the docs are made. A row of
the matrix also carries its `pending` proposal, so a client can answer it
beside the list, `from`, the message it was proposed on, and `tests`, the
tests that check it; the matrix lists the tests that check no feature as
`unmapped`. A product made before features can have them listed after the
fact: when the matrix's `backfill` is offered, `POST
/builds/{id}/features/backfill` sends the spec writer a message in the
Requirements chat, and its reply proposes every feature of the statement of
the job, each with the `tests` already in the build whose names or content
make clear they check it. A test that is not clear is left unmapped, never
guessed. The features arrive as proposed; `POST
/builds/{id}/features/approve_all` approves several at once, each a recorded
decision as in a chat, together one new version of the statement.
`checkBuild`, `checkStageWorkspace`, `checkFeatures` and
`checkFeatureApproveAll` hold these to the schema and to the rules it cannot
say.

**Starting from existing code.** Version 0.4.6 adds the starting point
`existing-code` of stages.json 1.4.0. A start request names it as
`starting_point`, with `source`: a repository and commit, or a local folder
for a service that runs locally. The build enters at Reverse engineering,
whose as-built record is one artifact of kind `as_built`; its summary
(`AsBuiltSummary`) names the repository, the commit and whether the code was
run, and gives the five parts in order (behaviors, architecture, interfaces,
dependencies, existing tests and gaps), each in words with one line per item.
Each behavior reaches Requirements as a proposed feature carrying `as_built`
(its behavior id and evidence), and the person answers it with Approve
feature (it is intended), `POST /builds/{id}/features/{feature}/bug` (what
the code does is not what is wanted: a `FixItem` is kept, linked to the
behavior, and nothing approves it silently) or `.../drop` (it is not kept).
The build's `source` says which commit it knew, and the product's `source`
says the last commit any build knew and whether the repository has moved
since (`drift`), so the when-needed Reverse engineering action can run on
drift. `checkArtifacts`, `checkFeatures`, `checkFeatureDecision` and
`checkProduct` hold these to the schema and to the rules it cannot say.

**Starting from an as-built record.** Version 0.4.7 adds the starting point
`as-built-record` of stages.json 1.5.0, for building again code kept
elsewhere without taking that code on: a rewrite, a port or a clean-room
rebuild. A start request names it as `starting_point`, with `source` naming
the record: a local folder holding its files, or a repository, a commit and
the `path` of the record in it. The build enters at Requirements. The record
is its `as_built` artifact, whose summary says it was `brought`, and each
behavior in it reaches Requirements as a proposed feature marked as built,
answered as with existing code. Nothing is adopted, so Code writes the code
fresh against a suite written from the approved spec. The build's `source`
names the code the record describes and, as `record`, where the record was
read. `checkBuild` holds that a build started this way says where its record
was read.

**Sending a build back to Requirements.** Version 0.4.7 also adds the action
`back_to_requirements`, offered at Code wherever `back_to_test` is and also
when Code was refused. It needs the person's words. Requirements opens again
with them as an ask for changes; once the person approves the revised spec,
Test revises the suite against it, and Code goes on (on a pull request, on
the same branch, with the revised spec and suite as one forward commit). The
service records it as a deviation, as it records `back_to_test`. `checkBuild`
holds that it acts at Code and asks for words.

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
