# Catalog

This agent holds the [catalog](https://agentroles.ai/catalog.html) role for the
Source stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

It is given the steps of a plan, each saying what kind of work it is, what it
takes and what it hands back, and it answers every step with one of three
things: an agent and the offering that does the step, a solution, or "build
one" with the reason nothing listed fits. A listing fits only when it matches
the step's words closely and declares an offering whose inputs and outputs fit
the step's. It answers only from what is listed, and it hires and starts
nothing. There is no model in it: the same catalog gives the same answer.

Given an Agent Processes document instead of plan steps (`process`), it
answers every phase but a person's: with an agent that declares the offering
the phase says it runs, or whose declared inputs fit what the phase takes;
with a process that exists, when the phase's words restate its goal, so the
phase becomes `runs process <id> v<n>`; or with build one and the reason. It
names the people's phases as the document does and fills the document's
roster from the answers (`source-process-answers-v1`). This is the
find-the-holders step of a build whose artifact is a process.

## The parts

- `src/catalog-source.ts` is the Source logic: reading the request, matching
  each step, and the answer. Everything that reaches outside (the catalog
  search and each listing's descriptor) is handed in, so it runs on its own.
- `src/find-shape.ts` holds the word matching and answer shapes it shares with
  the catalog's search.
- `src/catalog-agent.ts` is the agent on the mesh: its identity, its
  registration and the `source` offering, wired to the catalog store.
- `test/catalog-source.test.ts` tests the Source logic.
- `src/audit-gate.ts` is the audit gate's rule, and `test/audit-gate.test.ts`
  tests it. See "The audit gate" below.

## The audit gate

The catalog lists an agent version only with a current audit pass for the
exact package digest that version was deployed from. A current pass is the
newest audit report for that digest, with a verdict of `pass` or
`pass_with_findings`, not past its `expires_at`, and signed by the auditor key
the environment pins. Where the environment requires the gate (prod), nothing
turns it off. Elsewhere it is off unless its switch, `AUDIT_GATE`, is on. A
refusal names the digest and what is missing, and it points to the audit
report, or says that no report exists.

`src/audit-gate.ts` holds the rule, and it is pure. On AgentMesh, the
catalog's listing doors apply it before a version is listed, in
`catalog/src/listing-gate.ts`, which reads the audit from the platform's
`GET /v1/audits/<digest>`. A listing that already stands at the same version
is refreshed without being asked again, so the gate never delists anything.
The Source logic answers only from what is listed, so it never offers a
version that the gate refused.

## What it needs

- Node 22 or later and TypeScript. The tests use vitest.
- A catalog to search and the descriptors of what it lists, handed in through
  `SourceDeps`.

```sh
npm install
npm test          # 23 tests
```

The role publishes its own conformance check at
[agentroles.ai/checks/catalog-check.mjs](https://agentroles.ai/checks/catalog-check.mjs),
and this logic passes it.

## What runs only inside AgentMesh today

`catalog-agent.ts` is part of the AgentMesh services and does not run outside
them. It imports the platform's SDK, its key store, its sealed-at-rest secrets
and its catalog store (`../platform-shared/*`, `./house-descriptors.js`), none
of which are in this repository. It is published so the agent's wiring can be
read. `catalog-source.ts` and `find-shape.ts` run on their own.

## Replacing it

This is a reference implementation. Any agent that holds the catalog role can
take its place, over any catalog, as long as every step gets an answer and a
poor fit is never offered in place of "build one".
