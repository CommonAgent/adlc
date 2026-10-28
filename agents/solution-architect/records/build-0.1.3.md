# solution architect 0.1.3: the reference agent for the Architecture part of stage 02

The owner approved a Builder for the Architecture role on 2026-10-27. The
Builders family had skipped this stage, so its decisions fell to the spec
writer by default, and one result was an agent shipped with a model's name
written into its code.

## What it is

The role is the solution architect (https://agentroles.ai/solution-architect.html,
v1.4). Given the statement of a job and the organization's stack, it hands
back the architecture record the role defines: the systems in plain system
words, the product bound to each in dev, test and production (the
organization's choice first, a platform default for the rest, each marked),
the dependencies, the kind, the limits on cost, speed, data and trust, the
egress per environment, and every decision with its reason; plus the formats
at the agent's edge and its settings, which the house rules require.

Two offerings, the role's two exchanges: write the architecture, and revise
it (with the person's answers, or with what to change), which also returns
what changed: the lines that moved and the reason for each changed decision.

## How it is built

A program that calls a model at one named point, as the Sept plan asks
(AgentMesh docs/agent-sdlc-agents.md, requirement 1). Five steps:

- read-what-was-asked (script, no model): tells the statement, the stack, the
  platform's defaults and an earlier record apart by their contents; declines
  a request for the statement, the design or an agent choice before any model
  is woken; reads `key: answer` lines as answers.
- name-the-systems (script, one model call, two at most): the one judgment.
  The answer is checked against the standard and asked once more with the
  findings. Code then takes out every model name, address and credential,
  renames a system named by its product, and turns each commitment the model
  filled in (a spending limit, a destination beyond the derived set, a system
  the statement does not call for) into a question.
- bind-each-environment (script, no model): the organization's binding, its
  production binding where it lets production stand in, the House Stack's
  product where it covers the system, otherwise a question.
- check-the-record (script, no model): writes the record and holds it to the
  done-when; a record carrying a model name, an address or a credential is not
  written.
- write-the-reply (script, no model).

The model is the text-reasoning binding's: the scripts read `TEXT_MODEL` (or
`AGENT_MODEL`) through `scripts/caller.mjs` and refuse when it is empty. No
script names a model; the package maker's format and model rules (new agent,
refuse mode) find nothing.

## The standard

`references/architecture-standard.md` writes the house rules down as the
stage's standard: models are bound systems stated by capability; readable
Markdown between steps and agents, specific JSON kinds only for typed data
code reads, never a bare `application/json`, and who gives each input;
addresses are never settings; settings are declared with defaults. The spec
writer (0.5.0, in the same change) reads the record and is held to it.

## One disagreement, said rather than hidden

The role says a platform default fills each binding the organization left
open. The AgentMesh deploy's resolver refuses a test or production deploy for
a system the organization bound in another environment and not that one
(docs/account-stack.md, section 3, step 7). The record follows the role, and
that binding's decision says the deploy needs the organization's own binding
there first. Which of the two should change is the owner's call.

## Tests

65 pass, one skipped (no delivered example kept). They include the role's own
check (Agent Roles section 4): two systems in plain words bound in all three
environments, the organization's email product in production and a default
everywhere else, every decision with its reason; a default removed in test
raised as a question; a design step with a third system answered with a
question; and a request for the statement declined. The test writer's
delivered-formats check holds each delivered piece to its declared kind.

## Proved on dev

Released on dev only (agentmesh-dev), the way the other Builders are: packed
by the agent builder on the dev fleet host, filed with the platform
account's deploy queue, approved as the platform account, installed by the
deployment manager as a Cloud Run worker. Three dev releases found three
things the suite had not:

- 0.1.0: a statement sent as words was refused at the agent's door, because
  the statement was declared a required Markdown file. It is `text` since
  0.1.1, and the record to revise is optional (the newest earlier record is
  revised when none is attached).
- 0.1.1: the request for the job ("Write the architecture, with the statement
  attached") was quoted as part of the statement, and the model asked about
  egress again in its own words. The request words are taken off, and a
  model's own question about a commitment is dropped, since code asks each
  once.
- 0.1.2: the words are read from the inbox entry the host gives
  (MESH_MESSAGE_FILE), exactly as sent. (The empty and escaped text seen on
  dev came from the probe that sent it, not from the harness; reading the
  entry is still the sturdier source.) 0.1.3 changes only comments.

The proof, "an agent that reads a web page and writes the key points for a
person to review": the record named one system, `text-reasoning`, for text,
access trigger, bound to the House Stack's product in dev, test and
production and marked a platform default, with the model left to the
binding; the key points handed back as `text/markdown` with a header and
fixed headings, the page as a `url` given by a person or an agent; every
decision with its reason; and three questions open (the spending limit, the
web pages as egress beyond the derived set, and where the person reviews).
Revised with the answers (1 USD a day, yes, in the reply), it came back
finished, with what changed listed line by line. Spec writer 0.5.0, given
that record, drafted page-points declaring exactly `text-reasoning` (trigger),
no model named, Markdown out and the page as a `url`.

## Who held each step

The harness (Claude Code) wrote the agent, its standard and its tests, and the
spec writer's change, at the owner's instruction of 2026-10-27. Packing, the
deploy request, the approval as the platform account and the install go
through the agent builder, the platform account's deploy queue and the
deployment manager, on dev only.
