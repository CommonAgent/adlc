# incident-recorder 0.1.3: specific kinds, and the members a person reads

Date: 2026-10-28.

## Why

The fleet audit (adlc main 785a77b) found:
- bare `application/json` on the incident record, the timeline and the record inventory (`specific-kinds`);
- no `name`, `summary`, `will_not` or `given_by` (`descriptor-person-members`);
- no revisions policy (`revisions-declared`).

## What changed

- **Kinds.**
  - The incident record is `application/vnd.agentmesh.incident-record+json`.
  - The timeline is `application/vnd.agentmesh.incident-timeline+json`.
  - The record inventory is `application/vnd.agentmesh.record-inventory+json`.

  pieces.json lists the delivered files under those kinds.
- **Person members.**
  - The Descriptor carries `name`, `summary` and `will_not`.
  - Every input says `given_by`: either, at the offering; agent, for steps' own pieces.
  - Revisions: one within 14 days, then free.
  - `can_use` is empty.
- **SKILL.md** files are regenerated from the descriptor. Nothing it does changes.

## Tests

18 pass.

## Who held each step

The harness (Claude Code) wrote the change. Packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
