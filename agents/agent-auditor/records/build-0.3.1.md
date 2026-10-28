# agent-auditor 0.3.1: the members a person reads

Date: 2026-10-28.

## Why

The fix pass brings every lifecycle agent's Descriptor up to the audit
checklist's descriptor-person-members check (Common Agent 6.13, proposed).
This release changes the Descriptor only; the platform batch owns the
auditor's code.

## What changed

- The Descriptor carries `name` ("Agent auditor"), a one-sentence `summary`
  and `will_not`, in words a person can act on. `refusals` is unchanged.
- The offering says who starts it: `started_by` person and agent.
- `does` no longer says a stage record must be signed by the stage's holder:
  since 0.2.0 any signed artifact bound to the digest counts, and `does` now
  says so.

## Tests

33 pass. The package maker builds it with no format, option or standing finding.

## Who held each step

The harness (Claude Code) wrote the change.
