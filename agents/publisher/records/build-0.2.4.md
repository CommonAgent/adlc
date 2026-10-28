# publisher 0.2.4: specific kinds, and the members a person reads

Date: 2026-10-28.

## Why

The builder's format rules found bare `application/json` on the publication
record and on the steps' own pieces. The fix pass also asks for:
- `name`, `summary`, `will_not` and `given_by`;
- a revisions policy.

## What changed

- **Kinds.**
  - The publication record is `application/vnd.agentmesh.publication-record+json`, and pieces.json lists it so.
  - The steps' own pieces are `application/vnd.agentmesh.publish-reading+json` and `application/vnd.agentmesh.placed-files+json`.
- **Person members.**
  - The Descriptor carries `name`, `summary` and `will_not`.
  - `given_by`: the files are either; the name and the notes are person; steps' own pieces are agent.
  - Revisions: one within 14 days, then 0.10 USD each, the job's own price.
  - `can_use` is empty.
- **SKILL.md** files are regenerated from the descriptor. Nothing it does changes.

## Tests

28 pass.

## Who held each step

The harness (Claude Code) wrote the change. Packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
