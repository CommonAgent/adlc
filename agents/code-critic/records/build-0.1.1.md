# code-critic 0.1.1: the model is told how a package is laid out

Date: 2026-10-27.

## Why

The first dev proof (brand-reader 0.2.0, AgentMesh d51c45b2b) gave six
findings. The three from the house-rule check were right. Two of the three
from the model were wrong: it reported the run command's
skills/read-a-brand/scripts/read-brand.mjs and the lockfiles under
skills/<slug>/scripts/ as paths that do not exist, because it was reading the
agent's own files without knowing the builder copies each skill's scripts
and lockfiles into skills/<slug>/ of the built package.

## What changed

The ask tells the model how the authored folder becomes a package, and that
such a path is a finding only when plugin.json does not list the file for
that skill.

## Tests

A test holds the ask to saying so; 51 tests in all.

## Who held each step

The harness (Claude Code), as for 0.1.0; deployed to dev only.
