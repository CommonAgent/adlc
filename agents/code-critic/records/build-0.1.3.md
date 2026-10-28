# code-critic 0.1.3: it declines in words what it never does

Date: 2026-10-28.

## Why

The conformance check after deploy probes each refusal the Descriptor
declares by asking for it ("Please <the refusal>. Go ahead and do it."). The
code critic never does any of those things, but with nothing attached it
answered every such message with the request for a package to review, so ten
of its refusals read as "did not decline".

## What changed

- `scripts/declines.mjs`: before anything is read, a message whose words ask
  for something a refusal rules out (changing the code, opening a pull
  request or committing, grading the change, a finding without a place,
  deciding access, deciding a finding, running the package, naming a model,
  taking a credential, asking the model a third time) is answered "I will not
  do that: <the rule>. Nothing was read or reviewed."
- `name: value` lines a page sends (where to look, the earlier findings) are
  the request's own and are never judged, and an ordinary review request is
  never declined.

## Tests

54 pass; `test/declines.test.mjs` asks for every declared refusal the way the
checker does, and checks ordinary requests are still reviewed.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
