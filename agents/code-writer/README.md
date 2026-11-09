# Code writer

This agent holds the [code writer](https://agentroles.ai/code-writer.html) role
for the Code stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

It writes the scripts a spec names so that the test writer's suite passes. The
package lays out a workspace, a coding harness does the work the way a coding
session does (write, check, read the failures, fix), and the package checks the
result: the suite passes, every blanked script is noticed, the builder takes
it, and a fence of digests shows the tests, the spec and any prototype were not
touched. A prototype in any language is read as the clearest statement of what
was wanted and written again in the house stack.

The model is in control of this one job, so the check sits outside the work.
`scripts/verify.mjs` is the delivery check a host runs over the finished job
folder before the reply is accepted. It reads only what came in and what went
out, never a verdict the harness wrote.

## The spec in the hand-off

The hand-off (`hand-off-the-code`, `scripts/handoff.mjs`) lays out the build
folder Product Factory or a person's own coding harness writes the scripts in,
on a pull request. Since 0.4.0 it carries the spec (spec-v1, the analysis
Requirements hands back since stages.json 1.6.0) at its top: `spec.json`, and
`spec.md` when its rendering for a person came. Each is passed the way every
other file is, as `--file <path>::<media type>`, and found by what is in it:
spec.json is the JSON whose format is spec-v1; spec.md is a Markdown file named
spec.md, or one carrying the product's name and every acceptance scenario's
id. Both are pinned in `build.lock.json` like the agent's files, so the fence
keeps them unchanged, and `AGENTS.md` tells the coding agent to read the spec
first: the requirements, the exact words and patterns, the interfaces that
must be kept, the acceptance scenarios; then the agent's files and the suite.
A hand-off with no spec is laid out as before, with the same AGENTS.md.

When a script blanked in turn is not noticed by the suite, delivery still goes
ahead: the reply says which script nothing tests, for the code critic, because
the missing test is the test writer's to write. Nobody is asked to decide
anything, so it is not an escalation.

## What it needs

- Node 22 or later.
- A coding harness on the host to do the rounds: Codex, OpenCode and Claude
  Code all qualify. Which harness and which model are settings of the deploy.
- A host that runs the package's declared `verify` script before it accepts a
  delivery. The AgentMesh fleet supervisor does this; on another host, run
  `JOB_DIR=<job folder> node scripts/verify.mjs` yourself and refuse a delivery
  that does not exit 0.

## Running it

```sh
node --test test/*.test.mjs                                   # 119 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

`rules.md` is what the harness works under. `references/` holds the house
stack and an example package that works.

## Replacing it

This is a reference implementation. Any code writer may hold the role, and a
package maker packs scripts from any code writer unless its operator chooses to
require one (see the package maker's `REQUIRED_CODER`).
