# planner 0.2.0: whole candidate descriptions, every candidate, an output budget read

The owner decided on 2026-10-04 that content handed between our agents is
never cut without a word (docs/handoff-audit.md, row P15).

## What changed

CUT: each candidate's description went into the prompt cut at 200
characters, so the model chose among agents half-described. It now goes
whole.

FIRST-N: only the first 60 catalog candidates were kept, an arbitrary cap,
so an agent read later was never offered to the plan. Every candidate is kept,
first read first. The test that pinned the cap now pins the new rule, and its
comment says why.

CAP: Gemini was called with no output budget. Both services now get
OUTPUT_TOKENS (32,000: max_tokens for Claude on Vertex, maxOutputTokens for
Gemini), and the finish reason is read (stop_reason max_tokens,
finishReason MAX_TOKENS). An answer that stopped at its limit is a failure
that says "the model's answer was cut at its limit of 32000 tokens"; it is
never read as whole and not asked again with the same budget. A Gemini
answer's parts are joined with its thinking parts left out.

Not a loss: the catalog search is sent the first 300 characters of the
description as its search words; the whole description goes to the model.

## Tests

Two new tests (the whole description in the prompt; the budget on both
services, a cut answer a failure, every part read). One test changed to pin
the new rule. 103 pass.

## Who held each step

The harness (Claude Code) wrote the spec text, the tests and the scripts on the
owner's word of 2026-10-04 (docs/handoff-audit.md); packaging, deploy request
and install go through the agent builder, the platform account's deploy queue
and deploymgr.
