# impact-analyst 0.1.2: the members a person reads, and a revisions policy

Date: 2026-10-28.

## Why

The fleet audit (adlc main 785a77b, checklist sha256:283c9695...) warned on two
design findings for this agent: descriptor-person-members (no `name`,
`summary` or `will_not`) and revisions-declared (no revisions policy on an
offering). Neither changes what the agent does.

## What changed

- The Descriptor carries `name` ("Impact analyst"), a one-sentence `summary`,
  and `will_not`, the things it will not do in words a person can act on.
  `refusals` is unchanged; it stays the operator's prose for every reader.
- Each offering says who starts it: `started_by` person and agent.
- Each offering declares its revisions policy: agent-change: one revision within 14 days, then 0.00 USD each.
- `can_use` is declared empty: the agent reads no standing asset, and says so.
## Tests

46 pass. The package maker (adlc #39) builds it with no format, option or
standing-asset finding.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
