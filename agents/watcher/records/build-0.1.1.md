# watcher 0.1.1: installable, and a watch in rounds

Date: 2026-10-28.

## Why

0.1.0 was filed on dev and never installed. The deployment manager refused it
at its emit step: the install file carried what reads as an account
identifier, because the INCIDENT_RECORDER setting's purpose named a handle as
an example (Common Agent 12.6 rule 3: a subject is minted at install and never
baked). Its install record also showed where the work would run: the
deployment manager places an agent's work on Cloud Run, a container for one
job that holds no signing key. From there `agentmesh messages send --wait`
can neither sign a message nor hear an answer, so 0.1.0's way of asking (send
and wait inside the job) could not have worked on the platform's own fleet.

## What changed

- The install file names no handle. A test runs the image emitter's own
  check (`forbiddenIn` in agents/image/emit-image.mjs) over it.
- A watch is a round (scripts/rounds.mjs). A request opens one: the status
  question for each agent is left in `out/outbox.jsonl` for the host to send
  under the watcher's key, all in one thread. Each answer comes back as a
  message of its own (`wants_replies`, and the run command now takes
  `--from {sender} --in-reply-to {in_reply_to} --message {message_id}`) and is
  recorded. The round closes when every agent asked has answered (its report
  then goes to whoever asked, as a message with the report and the record
  attached) or when a request comes after the wait (its report is then that
  job's pieces, and a new round opens). A request while a round is open and
  the wait is not over asks nobody again.
- The alarms to the incident recorder are left for the host the same way,
  with their file.
- A round's readings are taken when it closes, so an agent that went down
  while the round was open is reported down.
- No `agentmesh` binary is needed; send.mjs and raise.mjs are gone, and
  outbox.mjs and rounds.mjs take their place.

## Tests

35 pass, run as the host runs the command: a request, the questions it
leaves, the answers as messages of their own, and the request or answer that
closes the round, with the role's own check, the alarm read by the incident
recorder's own reader, the report sent to whoever asked when the last answer
closes a round, and an alert raised once across rounds.

## Who held each step

The harness (Claude Code) wrote the change and the tests; packaging, the
deploy request and the install go through the package maker, the platform
account's deploy queue and the deployment manager, on dev.
