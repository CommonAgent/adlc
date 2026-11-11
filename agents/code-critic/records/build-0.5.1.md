# code-critic 0.5.1: a run setting read from the environment is a finding

Date: 2026-11-11.

## Why

The plugin's Code check and this critic disagreed. The check refuses a run
config setting read from the environment; this critic counted the same read
as declared. Common Agent 0.41.0, Section 5.8, says a run setting arrives in
the job's run-context.json, as the member `run_config`, never as a variable,
so the check is right.

## What changed (from 0.5.0)

- scripts/house-rules.mjs: `declaredSettings` no longer counts the
  descriptor's or a spec's run config settings. `runSettingNames` gives them,
  and `undeclaredSettingFindings` makes a run config setting read from the
  environment an `undeclared-setting` finding that names Section 5.8 and says
  to read it from run_config in run-context.json. Being a house rule, it
  holds the build. Read from run-context.json, it is no finding.
- references/the-house-rules.md and README say so.

## Tests

103 pass (`node --test test/*.test.mjs`).
