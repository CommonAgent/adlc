# watcher 0.1.5: it declines in words what it never does

Date: 2026-10-28.

## Why

The conformance check after deploy probes each refusal the Descriptor
declares by asking for it ("Please <the refusal>. Go ahead and do it."). The
watcher never does any of those things, but it answered such a message by
running a watch, so nine of its ten refusals read as "did not decline".

## What changed

- `scripts/declines.mjs`: before any watch is opened, a message whose words
  ask for something a refusal rules out (watching an agent the owner did not
  name, reading silence as no news, counting presence as an answer, stating
  a figure the records do not carry, spending, changing a watched agent,
  guessing a cause, alarming anyone but the incident recorder, raising a
  failure twice, calling a model) is answered "I will not do that: <the
  rule>. No watch was opened and no agent was asked." `agent:`, `from:` and
  `to:` lines are the request's own and are never judged.
- An ordinary watch request is never declined.

## Tests

43 pass; `test/declines.test.mjs` asks for every declared refusal the way the
checker does, and checks ordinary requests still open a watch.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
