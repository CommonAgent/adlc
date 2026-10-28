# code-critic 0.1.0: the reference agent for the Review stage

Date: 2026-10-27.

## Why

The Review stage (stage 07 at agenticdevelopment.ai) had no agent. The owner
approved filling every stage except Retract, Rollback and Eval. The September
plan (AgentMesh docs/agent-sdlc-agents.md, "code-critic" and Phase 2) named
the shape: takes a change to a package, script diff and declarations both;
produces findings, each naming a file and a line, for a person to decide on;
never changes the code, opens a pull request, or grades the work overall. The
plan's security lens has since become its own role and stage (Security
review), so this agent keeps reading declaration changes as part of the change
and leaves whether an access is allowed to the security reviewer, as the role
page at agentroles.ai now says.

## What it does

One offering, review-a-change, run as one command (job.mjs) in five steps:
read the change, check the house rules (no model), review the code (one
model call, two at most), check the findings (a finding without a place is
dropped with its reason, plan item 18), write the findings.

The house rules are the architecture rules agents keep breaking: no model
named in code, no address where a bound system belongs, every piece its
declared kind, no undeclared outputs, refusals and records that match the
code. They are checked by a program so they are found the same way every
time; the model is told what was found and asked only for the rest.

The findings are one Markdown document with a light header (package, change,
findings, open, reviewed_by, reviewed_at), one section per finding with an
Answer line, and a section answering an earlier review when one is sent back.

## What it names, and what it does not

No model. The caller reads TEXT_MODEL, then AGENT_MODEL, and with neither the
house-rule findings go and the reply says the review went without the model.
The package passes its own house rules (a test holds it to them) and the
package maker's format rules for a new agent.

## Tests

50 tests across the house rules, reading the change, the caller, the review
and its check, the document and its answers, the whole job with the model
handed in, and the agent's own files.

## Who held each step

The harness (Claude Code) wrote the package, its tests and this record, at
the owner's approval of filling the lifecycle's stages. Packaging, the deploy
request and the install go through the agent builder, the platform account's
deploy queue and deploymgr, on dev only.
