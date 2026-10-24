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

## The parts

- `src/catalog-source.ts` is the Source logic: reading the request, matching
  each step, and the answer. Everything that reaches outside (the catalog
  search and each listing's descriptor) is handed in, so it runs on its own.
- `src/find-shape.ts` holds the word matching and answer shapes it shares with
  the catalog's search.
- `src/catalog-agent.ts` is the agent on the mesh: its identity, its
  registration and the `source` offering, wired to the catalog store.
- `test/catalog-source.test.ts` tests the Source logic.

## What it needs

- Node 22 or later and TypeScript. The tests use vitest.
- A catalog to search and the descriptors of what it lists, handed in through
  `SourceDeps`.

```sh
npm install
npm test          # 13 tests
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
