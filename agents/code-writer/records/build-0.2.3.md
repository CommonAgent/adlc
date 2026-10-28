# code-writer 0.2.3: specific kinds, and the members a person reads

Date: 2026-10-28.

## Why

The fleet audit (adlc main 785a77b) and the package maker's format rules
found, for code-writer 0.2.2:
- specific-kinds: the input "the spec" and the output "the run record" were
  bare application/json;
- a delivered piece no job declares: "account" (the output is "the account");
- person-facing-declares-library: "the account" is Markdown a person reads,
  and no can_use was declared;
- descriptor-person-members and revisions-declared.

## What changed

- "the spec" is a `document` that accepts the agent's own files, as the spec
  writer 0.5.3 delivers them, or a spec.json
  (`application/vnd.agentmesh.agent-spec+json`). The scripts read it by its
  content, unchanged.
- "the run record" is `application/vnd.agentmesh.code-runs+json`.
- The account is delivered under its declared name, "the account".
- The Descriptor carries name, summary and will_not; the offering says
  started_by and declares its revisions (one within 14 days, then the job's
  own price); every input says given_by; can_use is declared empty, since
  the account is about the work and reads no organization's material.
- It names no model: the coding harness on the host is the binding.

## Tests

38 pass. The package maker builds it with no format, option or
standing-asset finding.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
