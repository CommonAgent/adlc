# impact-analyst 0.1.0: the Impact stage has a reference agent

Date: 2026-10-27. The owner approved filling every lifecycle stage except
Retract, Rollback and Eval; this is the Impact stage (03), item C1 of the
AgentMesh SDLC revision plan (`docs/agent-sdlc-revision-plan.md`).

## What it is

A new agent, `impact-analyst`, holding the impact analyst role
(https://agentroles.ai/impact-analyst.html, v0.1.0-draft). One offering,
`agent-change`, in five steps, each a script and none calling a model:
read-the-change, compare-the-declarations, answer-each-dependent,
file-what-is-owed and write-the-report.

- Dependents come from the platform's dependents list (dependents_list), which
  the platform gathers from declared and observed sources. Each dependent's use
  is read from its solution's canvas or an agent's ports when they are given.
- Kinds are compared by the platform's own rule, copied from
  services/src/compose/ports.ts as of AgentMesh PR #672.
- One dependency debt is filed per dependent answered breaking or change of
  behavior, against the changed agent, owed to the dependent's owner, holding
  back promote and decommission, and never twice for the same change.
- Inputs are specific kinds (`application/vnd.agentmesh.<name>+json`, and
  `text` for the change in words); the output is `text/markdown` with the
  convention in its `about`. No bare `application/json`, no model named.

Not in this version: the role's second request, a change to a solution.

## Tests

45 pass (and one skipped that reads kept examples, of which there are none): the role's own check (role-check.test.mjs), each rule of the
comparison (compare.test.mjs), the answers per reader (answer.test.mjs),
filing once (ledger.test.mjs), the edges an independent review found (edges.test.mjs), the run command from a laid-out package against
a ledger served on the machine, with the test writer's delivered-formats check (run.test.mjs, delivered-formats.test.mjs), and a real change, Site reader
2.4.1 to 2.5.0, on the platform's own answers from dev with identifiers
replaced (site-reader.test.mjs). The package builds with the package maker on
main with its format rules (adlc PR #17) and has no findings.

## Who held each step

The harness (Claude Code) wrote the spec, the scripts and the tests, at the
owner's instruction, under the harness-writes exception; the spec writer, test
writer and code writer were not used. Packing, the deploy request, the
approval as the platform account and the install go through the package
maker, the platform account's deploy queue and the deployment manager, on dev
only. Prod waits for the owner.
