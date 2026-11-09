# reverse-engineer 0.1.0: Reverse engineering has a reference agent

Date: 2026-11-08. stages.json 1.4.0 added Reverse engineering (stage 00) and
the reverse engineer role with no reference agent; this is that agent, so
anyone who needs an open-source holder for the stage has one.

## What it is

A new agent, `reverse-engineer`, holding the reverse engineer role
(https://agentroles.ai/reverse-engineer.html, roles section 40). One
offering, `reverse-engineer`, in six steps: read-the-codebase,
list-the-dependencies, run-the-baseline, draft-from-the-code (the one step
that calls a model), check-the-evidence and write-the-record.

- It hands back the as-built record as files, one per part: behaviors.json
  (the feature list's shape, marked as built), architecture.json (the
  architecture record's shape, marked as built), interfaces.json with any
  OpenAPI or JSON Schema found or derived, sbom.cdx.json (CycloneDX 1.5, made
  by rule) and tests-and-gaps.json, with record.json tying them to the
  repository, the commit digest and the read mode.
- The model drafts; code decides what is delivered. Every cited file and line
  is checked against the commit, and a claim whose evidence does not check,
  that judges or that infers is listed as a gap with the reason.
- On drift it reads what changed since the last record's commit from git,
  shows the model only the changed files and the diff, and delivers only
  claims that touch a changed line.
- The baseline runs the project's own test script once, with a time limit, no
  credential of the agent passed to it, and no network where the host can cut
  it off (the record says which).
- It declines, in words, to judge the code, to write tests and to change the
  code, and still writes the record.
- The model is reached through the shared caller and the four model
  settings; without them, the parts read by rule are delivered and the
  drafted parts are gaps.
- Inputs and outputs are specific kinds (`application/vnd.agentmesh.as-built-*+json`,
  `application/vnd.cyclonedx+json`, `application/vnd.oai.openapi+json`,
  `application/schema+json`); no bare `application/json`, no model named.

stages.json goes to 1.4.1: the reverse engineer role names this agent as its
reference agent.

## Tests

40 pass (and one skipped that reads kept examples, of which there are none):
the role's own check on fixture codebases (describe.test.mjs), drift across two
commits (drift.test.mjs), the evidence rules (evidence.test.mjs), the bill of
materials (sbom.test.mjs), the baseline run (baseline.test.mjs), and the run
command from a laid-out package against a model stand-in on the machine
(run.test.mjs), with the test writer's delivered-formats check. The package
builds with the package maker and has no findings.

## Who held each step

The harness (Claude Code) wrote the spec, the scripts and the tests, at the
owner's instruction; the spec writer, test writer and code writer were not
used.
