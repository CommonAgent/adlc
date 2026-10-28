# spec-writer 0.5.3: no model named, specific kinds, and the members a person reads

Date: 2026-10-28.

## Why

The fleet audit (adlc main 785a77b) found, for spec-writer 0.5.1 and the
package maker's format rules for 0.5.2:
- no-model-names: draft.mjs named a default model and a price table keyed by
  model, and the runtime requirements named the default;
- specific-kinds: the input "an existing spec" was bare application/json;
- delivered pieces no job declares: spec.json and still-open.txt;
- people-read-markdown: "what is still open" was text;
- descriptor-person-members and revisions-declared.

## What changed

- The model is read from TEXT_MODEL, else AGENT_MODEL. The package names
  none, and a job with neither is refused in words before any call. Vertex
  reports tokens and not money, so no cost is stated (it was the tokens at a
  price table keyed by model names); the tokens are still recorded.
- "an existing spec" is a `document` that accepts the agent's own files
  (`application/vnd.agentmesh.agent-descriptor+json`,
  `application/vnd.agentmesh.agent-runtime-requirements+json`,
  `application/vnd.agentmesh.agent-plugin+json`, `text/markdown`) or a
  spec.json (`application/vnd.agentmesh.agent-spec+json`).
- The agent's own files are delivered under those kinds, not
  application/json.
- A container agent's spec.json is delivered as the declared output "the
  container spec" (`application/vnd.agentmesh.agent-spec+json`).
- "what is still open" is Markdown, `out/still-open.md`.
- The Descriptor carries name, summary and will_not; the offering says
  started_by and declares its revisions (one within 14 days, then the job's
  own price); every input says given_by; can_use is declared empty (the
  standards it pins are the package's own, not an organization's library).
- files.mjs and agent-folder.mjs carry name, summary, will_not, started_by,
  works_as and an empty can_use, as the package maker (adlc #39) does, so
  every agent folder still round-trips.

## Tests

153 pass. The package maker builds it with no format, option or
standing-asset finding.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
