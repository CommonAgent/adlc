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

- **0.4.2**: each stage's `cadence` and `carried` on the build and the stage
  workspace, and a product's `setup` and `when_needed` lists. Additive.
- **0.4.1**: the product's boss.
- **0.4**: products, stage workspaces, each stage's chat, and artifacts.
