# Changelog

Changes to the standards in this folder, newest first.

## architecture-standard.md

- **2.0.0**: the record describes the software architecture, not only the
  systems and their bindings. It gains four views: the components, each with
  what it is responsible for (section 12: the carrier from the kind, a skill
  per offering, a script per skill, the parts of each script, and the
  outside systems); the connectors between them and to each system, each
  naming both of its ends (section 13: the harness to each script by command
  and flags, a model through the shared caller and its four settings, a
  keyless public service at the address its binding names, any other system
  through its bound product); the runtime and deployment view (section 14);
  and the data flow (section 15). The limits become drivers (section 16):
  quality requirements and constraints taken from the spec and the statement,
  which the decisions cite by key, with `cost`, `speed`, `data` and `trust`
  first and the spec's constraints under their own ids. The header keeps
  `cost_limit`, because the Design declares it as the spending system's
  ceiling, and it is an input the record carries. A limit is never a
  decision, and a settled spending limit is the cost driver rather than a
  decision (section 11). Each decision about structure is an architecture
  decision record (section 17): its context, its drivers, why, at least one
  alternative with why it was not chosen, and its consequences. Bindings,
  grants and settled answers are rulings, which keep their earlier form and
  follow the decisions about structure. The body's headings are now
  `## Statement`, `## Systems`, `## Bindings`, `## Dependencies`, `## Kind`,
  `## Components`, `## Connectors`, `## Runtime and deployment`,
  `## Data flow`, `## Drivers` (in place of `## Limits`), `## Egress`,
  `## Formats`, `## Standing assets`, `## Settings`, `## Decisions` and
  `## Questions` (section 9). Done now also needs every component with a
  responsibility, every connector with both ends, a data flow, and every
  decision about structure with its drivers, an alternative and its
  consequences (section 8). The header and its format word,
  `architecture-record-v1`, are unchanged, so a reader of the header reads a
  2.0.0 record as before. This is a major version because a record finished
  under 1.1.0 is not finished under 2.0.0, and the `## Limits` heading is
  gone. Sections 2 to 11 keep their numbers. The worked example is
  hn-digest.
- **1.1.0**: a keyless public service is a system of the record. A service
  the agent reaches at one fixed address that takes no key, such as the
  Hacker News API, is asked for as a destination, with its address in the
  question, and the owner's yes makes it a system bound to the service
  itself in every environment: the binding names the address, says it takes
  no key, gives the access (`read`, `write` or `read-write`) and records the
  approval (`itself at <address>, no key, read, approved by the owner in
  egress-1`). There is no product behind it, and that is a valid binding, so
  the record is finished with it; a no leaves the service out. That address
  is the one address a record carries (section 2). Section 5 no longer says a
  keyless public read keeps its address as a constant in the script: the
  Design declares the address as the service's address setting, whose
  default is the address, and no script holds one (Common Agent Section
  12.6, rule 2). The Design still declares exactly the record's systems
  (section 8), now including the approved service. The header gains
  `cost_limit`, the spending limit in the words it was set in, which the
  Design declares as the ceiling of the spending system in the shape of
  Common Agent Section 12.4, item 4 (section 9). The header now carries a
  `version`; the standard was unversioned before, and this is its first
  change since it was written. Built in build b_6e496a709479 (hn-digest),
  where the Design dropped the approved service, the model system and the
  limit.

## common-agent-pin.json

- **v1**: the lifecycle cites one version of the Common Agent Specification,
  0.41.0 (tag `common-agent-v0.41.0`), pinned by the sha256 of its SPEC.md.
  Citations that named 0.17.0-draft, 0.24.0-draft, 0.28.0-draft,
  0.30.0-draft, 0.39.0 and 0.40.2 for a rule that still holds in 0.41.0 now
  name 0.41.0, and a citation of the records member now names Section 12.3,
  where 0.41.0 defines it. A citation that says what an older version changed
  is history and stays. The ten citations of 0.39.0 that were first left as
  divergences now name 0.41.0 too: the shared model caller reads only the four
  settings of Section 12.4.1, and the deployment manager no longer places
  `TEXT_MODEL` beside `MODEL_NAME`. `test/common-agent-pin.test.mjs` names no
  divergence and fails on any version other than the pin. In the same change,
  architecture-standard.md says the scripts read the four settings of 12.4.1
  in place of `AGENT_MODEL` or `TEXT_MODEL`, and the code critic's address
  warning says that a depot publishes such a package with a warning, as
  Section 12.10 has said since 0.40.0, in place of saying it refuses one.

## stages.json

- **1.8.0**: the writing stages in two phases, as the ADLC One-Builder Plan
  says: the spec (Requirements), which the person approves before anything is
  built on it, and the build (Architecture and Design, Test and Code), whose
  gates the check runs together over the result in whatever order the builder
  writes it. 1.7.0 tied each check to one stage and ended each with "Then it is
  pinned", which made the builder pass five stages in a fixed order; that was
  not the plan. Each `checked_by` entry now names its `phase` (`spec` or
  `build`) and its `gate` (`spec`, `architecture`, `files`, `test`, `code`) in
  place of `stage`, and says nothing is fixed stage by stage. The tests are
  fixed the first time the code is judged, so Code's `done_when` now says the
  approved spec and the tests, once fixed, have not changed. Stage ids, roles
  and every other stage are unchanged.
- **1.7.0**: one holder may hold several stages, as in the ADLC One-Builder
  Plan: one builder writes the spec, the architecture, the agent's files, the
  tests and the code, and what must be separate is each stage's check, not its
  author. Each writing stage names in `checked_by` the check that decides it,
  which its holder does not control: `node .adlc/check.mjs` in the build
  folder (the ADLC plugin), with the stage it answers for and what it asks.
  Requirements, Test and Code have one; Architecture and Design has two, the
  record and the agent's own files. Each one's `done_when` now says what that
  check holds: at Requirements, every requirement checked by a scenario, the
  refusals, the empty case and the failure case stated, and the person's
  approval; at Architecture and Design, the record and the files are what
  the generators write, the spec and the record name the same systems, and
  the packer accepts the files; at Test, every test named for an approved
  scenario, requirement or constraint and none failing on its own mistake; at
  Code, every script written, reading only declared variables, and the
  packer accepting the folder. Stage ids, numbers and roles are unchanged.
  Proven on hn-digest and release-notes (AgentMesh-Dev-Test/adlc-plugin-proof
  #1 and #2).
- **1.6.0**: Requirements hands back the spec (`spec.schema.json`, spec-v1),
  the analysis of the product's functional requirements and capabilities: each
  feature with its requirements, its inputs and outputs, and acceptance
  scenarios a test can check; the interfaces and which must be kept; the
  constraints; the systems it reaches or names; its settings; and the open
  questions. Its asset is now Spec (it was Statement of the job). Until now the
  reference implementation handed back the agent's own files (descriptor,
  runtime requirements, plugin manifest, skills) as the statement, which is a
  declaration a package is built from, not an analysis of what the product must
  do: details with no place in a descriptor were lost before Test. The Design
  part of Architecture and Design now makes those files from the spec, Test
  writes a test for each acceptance scenario, and Code is given the spec with
  the files and the suite. Every given that said "the statement of the job"
  says "the spec". No stage id or number changed.
- **1.5.0**: the starting point `as-built-record`: someone brings the as-built
  record of code kept elsewhere, to build it again without taking that code
  on (a rewrite, a port or a clean-room rebuild). It enters at Requirements,
  because the record already says what the code does and Requirements is
  where the person decides what to keep; nothing is adopted, so Code writes
  the code fresh. The givens of Requirements and Test, where they say "where
  code already exists", now also cover a build that starts from an as-built
  record (Test is also given the interfaces, part 3). Additive: no field
  changed or removed, and no stage's id or number changed.
- **1.4.1**: the reverse engineer role names its reference agent,
  `reverse-engineer` (agents/reverse-engineer), which holds Reverse
  engineering and hands back the as-built record. The stage's
  `reference_holder` stays null until the stage card on the site names it.
  No field added, changed or removed.
- **1.4.0**: Reverse engineering, held by the new reverse engineer role, for
  code that already exists. It is in Define, before Requirements, numbered 0
  so that the 24 stages keep their numbers, and run when needed
  (`when_needed`) on adoption, when an existing codebase is taken on, or on
  drift, when the code changed outside the lifecycle and its commit differs
  from the last one any build knew. A codebase that lives fully inside the
  lifecycle does not need it again. It hands back the as-built record
  (behaviors, architecture as built, interfaces, dependencies, existing tests
  and gaps; on drift, only what changed since the last record), and has no
  gate of its own: the person decides at Requirements. Requirements,
  Architecture and Design, Impact, Test and Security review may be given
  parts of the record, each said in words added to its `given`. The file
  also lists `starting_points` (what someone brings and the stage it enters
  at) and `starting_point_rules`. Additive: no field changed or removed, and
  no stage's id or number changed.
- **1.3.0**: each stage has a `cadence`, and the file lists the three
  `cadences`: `every_build` (the routine, run on every build), `setup` (set
  up once per product and carried forward to later versions until changed)
  and `when_needed` (an action on the product, run when something happens).
  Additive: no field changed.
- **1.2.0**: attestations at Conformance, Docs and Update.
- **1.1.0**: the roles that hold the stages, and the evidence formats.
- **1.0.0**: the 24 stages as data.

## spec.schema.json

- **1.3.0**: a system says what the scripts need to reach it (Common Agent
  Section 12.4, item 3). `credential` is the credential's `name` and the
  environment variable (`env`) the scripts read it from, or `"none"` for a
  keyless public service; `settings` is each non-secret value the host must
  supply, such as its address, by `env` and `purpose`, never with a value.
  The description now says a system is named in plain system words (code-host,
  not GitHub) and that a model is not a system of the spec. Additive. The
  release-notes agent of the ADLC One-Builder Plan's step 3 could not declare
  its GitHub and Slack tokens and addresses, so its scripts read eight
  variables no file declared.
- **1.2.0**: each input and output of a feature (Data) may say whether it
  is `required` and who gives it (`given_by`: person, agent or either), so
  an offering's pieces are carried whole from what the person said to the
  Design, which declares them. A feature's `inputs` absent means nobody has
  said what it takes; an empty list means the person said it takes nothing.
  The descriptions of Data and its `about` say what each holds. Additive. In
  build b_393a1f45c7a4 (hn-digest) the person named the input and the
  output, the spec carried neither, and the Design declared none.
- **1.1.0**: interface kinds constant (an exported value, kept with its value) and
  declaration (a name or value the agent declares to the platform: offering and
  step ids, output names, labels, settings, kept with where they are declared);
  required_flags for a command; values, the allowed values of a field. Additive.
- **1.0.0**: the spec (spec-v1), with stages.json 1.6.0.

## The lifecycle API

- **0.5.0**: one version for the one-builder lifecycle (stages.json 1.7.0),
  so a client and a service move once. The action `send_back`, offered at the
  stage a build is at, reopens any earlier stage the build offers: its need
  `to` is a choice of those stages, and it asks for the person's words. The
  stage chosen opens again with the words as an ask for changes; it and every
  stage after it run again, each when the one before passes; their artifacts
  so far are kept as earlier versions; a person's approval a reopened stage
  needs is asked again; and the service records it as a deviation.
  `back_to_test` and `back_to_requirements` stay as the two sends back offered
  before. A binding's `provided_by` gains `itself`, for a keyless public
  service bound to the service itself (architecture-standard.md 1.1.0,
  section 2), which a build of hn-digest needed and had no word for. A try
  gains `inputs`, the job's inputs by the names the offering declares, so a
  job's inputs have a defined place; a try in a list says what it was sent
  with. And `ArchitectureSummary` gains the record's views from
  architecture-standard.md 2.0.0, as pull request 158 defined them, so that
  pull request needs no API version of its own: `components` (id, name, kind,
  within, responsibility, and for a part the system it reaches), `connectors`
  (from, to, how, access, carries), `runtime` (runs, per_job, own_service,
  and each environment's systems with their bindings), `flow` (from, to,
  data, says) and `drivers` (key, quality, says, from); each decision may say
  its `kind`, `structure` with its `context`, `drivers`, `alternatives` and
  `consequences`, or `ruling`, which keeps `options` and `follows`. `limits`
  stays, for a client that reads it. The check holds that `send_back` asks for
  words and offers only earlier stages the build offers, and, for a record
  that gives its views, that each component has a responsibility and sits
  within one the record names, each connector and flow step names both ends,
  each system has a component, a decision about structure cites drivers the
  record lists, weighs an alternative and says its consequences, and no
  decision only states a limit. Additive: a client that knows only 0.4.14
  ignores what it does not know.
- **0.4.14**: the spec of a version built before specs. A version built by a
  spec writer from before stages.json 1.6.0 has the agent's own files and no
  spec. Its spec artifact, not made, may carry `backfill`: whether the spec
  can be written now, and what that does or why not, in words. `POST
  /builds/{id}/spec/backfill` gives the spec writer what the version was
  asked, its earlier draft and the agent's own files, and it writes the spec
  for the version as it was built. Nothing else in the version changes,
  nothing reruns and no gate is answered. The made spec carries
  `written_after`: when, and what it was written from. The check holds that
  `backfill` is only on a spec not made and `written_after` only on a made
  spec. Additive.
- **0.4.13**: each artifact's Common Agent checks. `Artifact` gains `checks`,
  a list of `RuleCheck`: the `standard`, the `version` it was read in, the
  `section` by number and, where the section numbers its rules, the `rule`;
  what the rule `asks` in plain words; the `result`, one of `met`, `not_met`
  and `not_checked`; and the `detail`, what the stage did, in one line. A
  client can show a table of rules per document, such as "Section 12.6,
  rule 2: No address in its scripts", and a tally for the version. The
  definition is `RuleCheck` because `Check` already names the check on a pull
  request. The check holds that each check on a made artifact names its
  section by number, that a check not done says why, and that the same
  section, rule and asks appear once on one artifact. Additive.
- **0.4.12**: the security statement and the architecture record, in parts.
  `SecuritySummary` gains `reaches` (system, access, reason), `spends`
  (limit, ceiling), `never_does` (act, reason), `no_reason_recorded` and
  `architecture_record`, as the security reviewer's record lists them; the
  words fields stay. `ArchitectureSummary` is new, for a made
  `architecture` artifact: the record's seven parts from
  architecture-standard.md section 1 (systems, bindings per environment,
  dependencies, kind, limits, decisions with reasons, egress) and the
  questions still open. The check holds that a reach without a reason is
  listed as such, that a statement with one has not passed, that every
  binding is for a named system, and that every decision has a reason.
  Additive.
- **0.4.11**: a product's documents. `GET /products/{name}/documents` answers
  one `Document` per stage of stages.json that names an asset, in its order:
  the stage, the asset's name, the stage's cadence, a state (`made`,
  `not_made`, `not_used`), the copy that stands for the product now
  (`current`: the build and version that made it, the artifact itself, and
  `carried` when a newer version did not remake it) and the versions that made
  one (`history`, newest first). It is the product's view of its standing
  documents across versions; a build still answers its own artifacts. The
  check holds the list to stages.json, each document to its stage's asset and
  cadence, and a made one to a current copy made at its stage that heads its
  history. Additive.
- **0.4.10**: each feature in a run of its own. Once a version's spec is
  approved, a service may make each approved feature in a run of its own (its
  suite, its code and the person's OK), at the same time as the others, each
  with its own pull request, the version waiting for every run before
  Package. The build gains `feature_runs`, each a `FeatureRun` (its card,
  its own stages, actions, pull request, log and timeline); a build list item
  gains `feature_runs`, one `FeatureRunCard` per run, for a board; an
  `Action` gains `run`, sent back in the action's request; a `TimelineBar`
  gains `run`. The build's own stages, actions and timeline read across the
  runs. The check holds that each run is named once and holds each stage
  once, that its actions name it and stop once it ended, and that an action
  or a bar naming a run names one the build has. Additive.
- **0.4.9**: the holder's skills. `Holder` gains `skills`, a list of
  `Skill` (`name`, `description` and `text`, the SKILL.md as written, in
  full), given on a stage workspace's holder, and `skills_note`, one sentence
  in its place when the service cannot see them, such as a coding harness the
  person runs. An empty list says the holder has none of its own. The check
  holds that a holder lists each skill once, and lists its skills or the note,
  not both. Additive.
- **0.4.8**: the spec artifact (kind `spec`, `SpecSummary`): what
  Requirements hands back (stages.json 1.6.0). The `statement` artifact is the
  agent's own files, made at Design. Additive.
- **0.4.7**: starting from an as-built record (stages.json 1.5.0), and
  sending a build back to Requirements. The start request's `starting_point`
  may be `as-built-record`, with `source` naming the record (a `folder`, or a
  `repository`, `commit` and the new `path`); the build enters at
  Requirements and its behaviors reach it as proposed features marked as
  built, with no adoption. `AsBuiltSummary` gains `brought`, and
  `BuildSource` gains `record`. The action names gain `back_to_requirements`,
  offered at Code wherever `back_to_test` is and also when Code was refused,
  with the person's words, recorded as a deviation. The check holds that a
  build started from a record says where it was read, and that
  `back_to_requirements` acts at Code and asks for words. Additive.
- **0.4.6**: starting from existing code (stages.json 1.4.0). The start
  request's `starting_point` and `source`; the artifact kind `as_built` with
  `AsBuiltSummary` and `AsBuiltPart`; `as_built` (`AsBuilt`) on a feature, a
  matrix row and a proposal; `POST /builds/{id}/features/{feature}/bug` and
  `.../drop`, the proposal states `bug` and `dropped`, the decision request's
  `words`, and `FixItem` (on the proposal, the feature, the decision answer
  and the matrix's `fixes`); the build's `source` (`BuildSource`) and the
  product's `source` (`ProductSource`, with `drift`); `maxItems` in the
  validator. Additive.
- **0.4.5**: features at every stage. Each every-build stage's `features`
  count on the build and its full list on the stage workspace
  (`FeatureCount`, `FeatureSlice`); a matrix row's `pending`, `from` and
  `tests`, and the matrix's `unmapped` tests and `backfill`; a proposal's
  `tests`; `POST /builds/{id}/features/backfill`, which asks the spec writer
  to list a product's features after the build, and `POST
  /builds/{id}/features/approve_all`; and `minItems` in the validator.
  Additive.
- **0.4.4**: the guided setup and the when-needed actions. A setup item's
  `form` (`fields`, `ask`, `reference_agent`, `shares`), saved with the roles
  operations, each stage's settings under its id; a when-needed item's
  `action.needs`, `confirm` card and `last` run; a `choice` need with
  `options` and `default`; the actions operation's `result`; the product's
  `running` and `retired`; and [runtime-verbs.md](runtime-verbs.md). Additive.
- **0.4.3**: features. The statement's `features`; feature proposals on a
  stage's or the boss's reply, answered one at a time with `approve`,
  `not_now` or `ask`; a round's `by_feature`; the Requirements gate's `open`
  and `features`; the features matrix per build and per product version, and
  each feature's history. Additive.
- **0.4.2**: each stage's `cadence` and `carried` on the build and the stage
  workspace, and a product's `setup` and `when_needed` lists. Additive.
- **0.4.1**: the product's boss.
- **0.4**: products, stage workspaces, each stage's chat, and artifacts.
