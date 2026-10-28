# usability-tester 0.2.0: every offering, not only those a person starts

Date: 2026-10-28.

## Why

Offerings that other agents usually start must still be usable by a person.
Common Agent 6.13.2 lets a person load the inputs another agent would hand
over, as pieces of their declared kinds, and the App now offers "Give it the
inputs yourself". 0.1.0 skipped such offerings as "nothing to run", so an
agent like Fact writer, started by the explainer chain, was reported usable
with nothing run. The owner's coordinator corrected this before the hosted
proof.

## What changed

- Every offering is checked and run from its example, whoever usually starts
  it. A missing example is a descriptor finding wherever the offering is
  started from.
- A person who gives the inputs themselves gives every required one, those
  other agents usually hand over included; each goes as a file named for its
  input, of its declared kind.
- The report's table names who usually starts each offering; its header
  counts `offerings` (it was `offerings_a_person_starts`).

## Tests

35 pass, with an agent-started offering run from its example with its input
given as a file, and one with no example reported as a descriptor finding.

## Who held each step

The harness (Claude Code) wrote the change on the owner's instruction of
2026-10-28.
