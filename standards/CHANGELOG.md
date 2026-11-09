# Changelog

Changes to the standards in this folder, newest first.

## stages.json

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

- **1.1.0**: interface kinds constant (an exported value, kept with its value) and
  declaration (a name or value the agent declares to the platform: offering and
  step ids, output names, labels, settings, kept with where they are declared);
  required_flags for a command; values, the allowed values of a field. Additive.
- **1.0.0**: the spec (spec-v1), with stages.json 1.6.0.

## The lifecycle API

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
