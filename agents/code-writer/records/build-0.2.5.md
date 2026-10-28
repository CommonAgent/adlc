# code-writer 0.2.5: an escalation that routed nobody is no longer one

Date: 2026-10-28.

## Why

The conformance check after deploy probes each declared escalation and
expects the reply to route it to someone. "A script blanked in turn that the
suite did not notice" was declared as an escalation, but delivery goes ahead
and nobody is asked to decide anything: the reply only tells the code critic.
It read as "handled it without routing", which was true.

## What changed

- That line is no longer in `escalates`; the README says what the reply does
  in that case.
- The reply when the rounds are used up now says it goes to the owner, who
  can raise the ceiling, as the escalation declares. The conflict reply
  already named a person's call at the review gate.

## Tests

38 pass.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
