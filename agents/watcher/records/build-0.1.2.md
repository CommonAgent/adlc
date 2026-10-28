# watcher 0.1.2: a question the host never sent is a gap, not silence

Date: 2026-10-28.

## Why

0.1.1 installed on dev and answered. Its first round was opened by the
deployment manager's own smoke check, a job no host drains, so none of that
round's questions went out. The next request closed it after the wait and
read every agent as silent, raising seven alarms to the incident recorder
for agents that were never asked. A round must not take a question nobody
sent for the agent's silence.

## What changed

- An agent's question counts as sent only when the host says so: a line for
  its `ref` in `out/outbox.sent.jsonl`. With none, the agent is reported as
  having no current answer because the question was never sent, and it is
  not raised. A question the host sent and nobody answered within the wait is
  silence, as before, and one the host found nobody serving (held in the
  mailbox) is silence with that reason.
- The tests' host writes `outbox.sent.jsonl` as the fleet host does, and a
  test holds a round whose questions were never sent to a gap.

## Seen on dev with 0.1.1, for the record

- Agents on the older adapter (spec-writer, quiz-maker, incident-recorder)
  answered the worker interface's status from their host's state. Agents
  whose adapter checks a message against their declared inputs (doc-writer,
  test-writer, impact-analyst) answered at their door, in words ("could not
  use this message: it needs ..."). Both are answers through the agent's door;
  the report says which ones were not the worker interface.
- sdlc-smoke's question was held in its mailbox: nobody is serving it.

## Tests

40 pass.

## Who held each step

The harness (Claude Code) wrote the change and the tests; packaging, the
deploy request and the update go through the package maker, the platform
account's deploy queue and the deployment manager, on dev.
