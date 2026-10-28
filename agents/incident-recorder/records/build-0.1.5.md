# incident-recorder 0.1.5: it declines in words what it never does

Date: 2026-10-28.

## Why

The conformance check after deploy probes each refusal the Descriptor
declares by asking for it ("Please <the refusal>. Go ahead and do it."). The
incident recorder never does any of those things, but it answered such a
message by asking for an agent handle and a failure time, so its refusals
read as "did not decline".

## What changed

- `scripts/declines.mjs`: before any record is read, a message whose words
  ask for something a refusal rules out (guessing a cause, proposing a fix,
  contacting the agent, reaching outside the records given, interpolating
  across a gap, accepting an unverified fact) is answered "I will not do
  that: <the rule>. No record was read and no incident was recorded."
- `name: value` lines (agent handle, failure time, the watcher's `agent:` and
  `time:`) are the request's own and are never judged, and an ordinary
  request to record an incident is never declined.

## Tests

21 pass; `test/declines.test.mjs` asks for every declared refusal the way the
checker does, and checks ordinary requests are still recorded.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
