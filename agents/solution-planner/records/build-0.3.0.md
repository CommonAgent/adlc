# planner 0.3.0: the solution planner names no agent; the catalog answers each step

Platform services plan P7 item 5 (approved by the owner on 2026-10-05) and
the SDLC revision plan's B2 and B4, in part: the solution planner stops
choosing agents, and the catalog agent holds the Source stage.

## What changed

- The plan's steps say what they need and name no agent. Each step carries
  `needs`: what kind of work it is, what it takes and what it hands back,
  each with a kind from a fixed list (url, text, document, identifier,
  application/json, text/html, image, audio, video). Every step is `new`,
  with agent and offering null. An agent or offering the model writes anyway
  is removed in code and recorded in checks.json and went-without.json.
- The job reads no catalog and no descriptor. The steps read-the-catalog and
  read-the-descriptors are gone, with scripts/catalog.mjs and
  scripts/descriptors.mjs and their tests, and candidates.json is no longer
  written. The planner reaches only the model. This also ends the planner on
  dev reading the prod catalog at its fixed address.
- The platform sends the plan's steps to the catalog agent
  (catalog.platform@agentmesh.ai, offering `source`), which answers each
  with an agent and its offering, a solution, or "build one" with the
  reason (services/src/prompt-to-prod/source.ts and
  services/src/api/catalog-source.ts). The planner's job runs in a
  container, which cannot send a message and wait for the answer, so the
  platform carries the steps, as it already carries the person's words to
  the planner.
- The build figures are counted after Source. The plan carries
  `estimate.new_agent_usd` (NEW_AGENT_USD, default 1.50), `to_build_usd` 0 and
  `ready_minutes` 1, and the platform counts them once it knows which steps
  need a new agent.
- A step for an agent the person named keeps that name as its new_agent name,
  as before, so the platform puts the named agent in it; the catalog is not
  asked about that step.
- The description in the spec gives the handle the planner answers to on dev,
  solution-planner.platform@agentmesh.ai. The installed name stays `planner`
  (the A3 rename keeps labels), and so does this folder.

Not done here: the requirements head and the three modes (B1, B2). The
planner still writes no "done" lines, so it does not yet meet the whole
solution planner role (https://agentroles.ai/solution-planner.html).

## Tests

81 pass. check.test.mjs and plan.test.mjs were rewritten for the steps'
needs and the removed agent names; ask.test.mjs and spec.test.mjs changed
where they named candidates. The test-writer's check (check-suite.mjs) says:
against empty stand-ins for the 6 scripts the suite fails, against the
scripts all 81 pass, and broken one at a time, each of the 6 is noticed.

## Who held each step

The harness (Claude Code) wrote the spec change, the tests and the scripts,
under the owner's word of 2026-10-05 for P7 ("make your best guesses"), as
the harness-writes exception allows. Packing, the deploy request, the
approval as the platform account and the install go through the agent
builder, the platform account's deploy queue and the deployment manager, on
dev. Prod waits for the owner.
