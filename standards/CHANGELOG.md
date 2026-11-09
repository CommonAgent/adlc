# Changelog

Changes to the standards in this folder, newest first.

## stages.json

- **1.3.0**: each stage has a `cadence`, and the file lists the three
  `cadences`: `every_build` (the routine, run on every build), `setup` (set
  up once per product and carried forward to later versions until changed)
  and `when_needed` (an action on the product, run when something happens).
  Additive: no field changed.
- **1.2.0**: attestations at Conformance, Docs and Update.
- **1.1.0**: the roles that hold the stages, and the evidence formats.
- **1.0.0**: the 24 stages as data.

## The lifecycle API

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
