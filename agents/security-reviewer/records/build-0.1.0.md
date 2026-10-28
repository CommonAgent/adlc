# security-reviewer 0.1.0: the reference agent for Security review

Date: 2026-10-27.

## Why

The owner approved filling every stage of the lifecycle except Retract,
Rollback and Eval. Security review (stage 08) had no reference agent: the role
was moved from the code critic to a role of its own on 2026-10-05
(agentroles.ai, the security reviewer, v0.1.0-draft), and nothing held it.

## What it is

A new Builder. It reviews a package before it is installed and hands back the
statement the stage names: what the agent may reach, what it may spend, what
it must never do, and the reason for each, with every permission that has no
recorded reason flagged. It applies the role's rules as programs (no access
without a reason, programs reach only what the declaration names, no package
without the owner's spending limit, nothing that looks like a credential) and
says what holds each bound on AgentMesh today, including where nothing does.
One model call weighs whether each recorded reason accounts for its access;
it never changes the verdict.

It takes the architecture record when the solution architect (being built at
the same time) hands one over, and works without it, saying so.

## The shared parts it carries

- `scripts/caller.mjs` and `scripts/model-record.mjs`: AgentMesh's shared
  caller and model record, `packages/explainer/shared/`, at AgentMesh
  5a2a350, unchanged. The model is the one the install places (AGENT_MODEL).
- `scripts/secrets.mjs`: the publisher's list of what it refuses to publish
  (`agents/publisher/scripts/inspect.mjs`), held to it by
  `test/parts.test.mjs`. The PKCS#12 pattern counts its closing dashes so the
  file does not carry the line it looks for.
- `scripts/went-without.mjs`: the publisher's.

## Tests

`test/run.test.mjs` (20 tests) runs the job as the runtime requirements start
it, including the role's four-part behavioral check and a review of its own
package; `test/bypass.test.mjs` (29 tests) holds every way a review of the
first draft found to reach an undeclared host and still pass, or to carry a
credential into the review, caught; `test/parts.test.mjs` (22 tests) checks the
parts. 71 tests pass.

Swept over eight AgentMesh packages on 2026-10-27: brand-reader and
site-auditor pass; site-reader, source-reader and web-searcher are refused for
fetching addresses their declarations name no system for; hn-reader,
document-reader and fact-writer for addresses written in their programs that no
declared system's reason names (fact-writer's is a link it writes into its
output, x.com: an address in a program cannot be told from one it goes to, so
the reviewer asks for it to be named rather than guess).

## Who held each step

The harness (Claude Code) wrote the agent, its references and its tests
directly, on the owner's approval to fill the stages, relayed by the
coordinator on 2026-10-27; no lifecycle agent was run to write it. Packaging,
the deploy request and the install go through the agent builder, the platform
account's deploy queue and the deployment manager, on dev only.
