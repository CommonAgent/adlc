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
node --test test/*.test.mjs                                   # 36 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

`rules.md` is what the harness works under. `references/` holds the house
stack and an example package that works.

## Replacing it

This is a reference implementation. Any code writer may hold the role, and a
package maker packs scripts from any code writer unless its operator chooses to
require one (see the package maker's `REQUIRED_CODER`).
