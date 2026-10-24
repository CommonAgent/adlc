# Documenter

This agent holds the [documenter](https://agentroles.ai/documenter.html) role
for the Docs stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

It assembles every agent's AgentDoc, the document a stranger reads before
deciding to use an agent, from the records the platform holds about it: the
stored descriptor, the conformance checker's record, the registration and the
registrar's card. It signs the result with its own key and names every record
it read by digest, so "nothing here was typed" is a claim anyone can check. It
re-documents an agent when any of those records changes. There is no model in
it: the same records give the same document. The AgentDoc format is published
at [agentdoc.net](https://agentdoc.net).

## The parts

- `src/documenter-agent.ts` holds the pure parts (the digest, the signed
  bytes, signing and checking a signed AgentDoc) and the agent on the mesh,
  which answers `document` (do it now for one agent) and `changes` (which
  records differ from the last signed document).

## What runs only inside AgentMesh today

This agent does not run outside the AgentMesh services as it stands. It imports
the platform's SDK, its key-value store, its sealed-at-rest secrets, its
credentials and its house descriptors (`../platform-shared/*`,
`./house-descriptors.js`), none of which are in this repository, and it reads
the records it documents from the platform's own stores. It is published so the
assembly and the signature can be read and reproduced by another documenter.

## Replacing it

This is a reference implementation. Any agent that holds the documenter role
can take its place, as long as the AgentDoc is assembled from records, never
written, and every record it read is named.
