# test-writer 0.3.1: no model named, specific kinds, and the members a person reads

Date: 2026-10-28.

## Why

The fleet audit (adlc main 785a77b) found, for test-writer 0.3.0:
- no-model-names: write-suite.mjs named a default model and a price table
  keyed by model, and the runtime requirements named the default;
- specific-kinds: the input "the spec" was bare application/json;
- people-read-markdown: "what it could not test" and "the verdict" were
  text/plain;
- descriptor-person-members and revisions-declared.

## What changed

- The model is read from TEXT_MODEL, else AGENT_MODEL. The package names
  none, and a job with neither is refused in words before any call. Vertex
  reports tokens and not money, so no cost is stated; the tokens are still
  recorded.
- "the spec" is a `document` that accepts the agent's own files, as the spec
  writer 0.5.3 delivers them, or a spec.json
  (`application/vnd.agentmesh.agent-spec+json`). The scripts already read it
  by its content, so nothing else changed in how it is read.
- "what it could not test" is Markdown, `out/could-not-test.md`; "the
  verdict" is declared text/markdown (it is the reply, in words).
- The Descriptor carries name, summary and will_not; each offering says
  started_by and declares its revisions (one within 14 days, then the job's
  own price); every input says given_by; can_use is declared empty.

## Tests

73 pass. The package maker builds it with no format, option or
standing-asset finding.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
