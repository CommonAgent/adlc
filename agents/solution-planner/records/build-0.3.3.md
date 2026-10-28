# solution-planner 0.3.3: a person can ask for a plan in words

Date: 2026-10-28.

## Why

The fix pass's walk of the agents' pages found that Make a plan declared one
input, the platform's build-request file, so a person's page asked for
nothing a person has and the agent refused the message for want of the file.
The scripts already read a plain message as the description; the Descriptor
did not say so.

## What changed

- Make a plan takes one of two inputs (`one_of: what to plan`): the build
  request the platform sends, or what you want done, in words, given by a
  person. Neither is required on its own.
- A page's message names the job on its first line and gives the input as a
  `what you want done:` line; the job's name is not read as part of the
  description, and the line's label is taken off.
- `started_by` is person and agent.

## Tests

84 pass, one new.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
