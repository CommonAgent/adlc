# solution-planner 0.3.1: no model of its own, specific kinds, and the members a person reads

Date: 2026-10-28.

## Why

The fleet audit (adlc main 785a77b) found:
- the model written into the scripts and a skill (`no-model-names`);
- bare `application/json` on the request, the plan and every step's pieces (`specific-kinds`);
- no `name`, `summary`, `will_not` or `given_by` (`descriptor-person-members`);
- no revisions policy (`revisions-declared`).

`does` also carried the agent's handle and the page it sits behind.

## What changed

- **Model.** The package names no model. The model is the install's
  `TEXT_MODEL`, or else the host's `AGENT_MODEL`. With neither, the job is
  refused in words ("no model is configured") and nothing is called. The
  Vertex price table, which named models, is gone: a Vertex call records its
  tokens and states no cost (`cost_usd: null`), and the platform prices the
  tokens, as `services/src/prompt-to-prod/plan.ts` already does.
- **Kinds.**
  - The request is `application/vnd.agentmesh.build-request+json`.
  - The plan (draft, checked and delivered) is `application/vnd.agentmesh.build-plan+json`, and pieces.json lists it so.
  - The steps' own pieces have kinds of their own.

  The platform still sends request.json as `application/json`, and the adapter matches it to the input by its name. The platform finds the plan by the piece name "plan".
- **Person members.**
  - The Descriptor carries `name`, `summary` and `will_not`.
  - The request is `given_by` agent, and the step inputs are agent.
  - The offering is `started_by` agent, since the platform starts it.
  - Revisions: one within 14 days, then free.
  - `can_use` is empty.
- **`does`** is a plain description, with no handle and no page.
- **SKILL.md** files are regenerated from the descriptor.

## Tests

83 pass, including a new one for a job with no model configured.

## Who held each step

The harness (Claude Code) wrote the change. Packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
