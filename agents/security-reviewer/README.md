# Security reviewer

This agent holds the [security reviewer](https://agentroles.ai/security-reviewer.html)
role for the Security review stage (stage 08) of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

The blast radius is set before the credentials are given, not after. Before a
package is installed and before any credential is bound to it, this agent
reads the package and writes down what the agent may reach, what it may spend
and what it must never do, with the reason for each. It flags every permission
the package asks for that has no recorded reason. It refuses a package whose
programs reach a system its declaration does not name, whose owner set no
spending limit, or that carries something that looks like a credential, and
the refusal names what stopped it. What it lets through that carries a risk is
listed as accepted knowingly. It grants nothing, binds no credential, installs
nothing and changes nothing in the package.

It is a pre-release review of a package. Watching an agent while it runs is a
different job, the watcher's, and this agent does not do it.

## What it is given, and what it hands back

- **The package** (required): the `.tar.gz` the [package maker](../package-maker)
  built, or the package's own files handed over one by one. A package source
  folder (this layout) reads the same as a built package.
- **The architecture record** (optional): the solution architect's record from
  Architecture and Design, attached beside the package as Markdown. When it is
  given, a system the package declares and the record does not name is
  refused, its egress names the further destinations the programs may reach,
  and its limits may carry the owner's spending limit. Without it the review
  goes ahead against the package's own declaration and says so near the top.
- **The owner's spending limit**: a line of the message of its own,
  `spending limit: <amount> per <day|month|job>`, or the record's limits.

It hands back one piece, the security review, as Markdown: YAML front matter
listing each reach (system, access, reason), each spend ceiling (with its
reason), each never-do (with its reason), each permission with no recorded
reason, and what stopped the package when it was refused; then the same for a
reader under fixed headings. `references/what-a-review-holds.md` says what
every part holds and where it comes from.

## How it matches what the platform enforces

Each bound in the review says what holds it, and where only the package's own
code does, it says so: a review that calls a bound enforced when it is not is
the review that lets the harm through. `references/what-the-platform-holds-it-to.md`
lists what AgentMesh enforces today and where: systems and their access words
(`read`, `write`, `trigger`) and the `leaves` flag; credentials placed by name;
the egress record (open on a fleet host and on Cloud Run, observed for worker
jobs, closed but for the mesh for a tenant agent); ceilings and the owner's
spending limits; and the kill switch, including what it does not reach.

## How a job runs

Four steps, one judgment, and the judgment never decides:

1. **Read the package**: unpacked in memory, never to disk; both halves of the
   declaration read, and every file read for what the publisher refuses to
   publish.
2. **Trace the programs**: every program read as text, comments, patterns and
   tests left out, for the addresses it reaches, the calls to addresses it is
   handed, the credentials it reads and the commands it starts; each matched
   to a declared system by evidence, or named as undeclared.
3. **Weigh the reasons**: one call to the text-reasoning service, under
   `rules.md`, saying for each recorded reason whether it accounts for its
   access. It says which reasons to read hardest and never passes or refuses
   anything.
4. **Write the review**: the role's rules applied the same way every time, and
   the review written and filed.

The host starts

```sh
node {home}/{package}/skills/review-a-package/scripts/review-package.mjs \
  --job {job_dir} --records {records} --work {work} \
  --text-file {job_dir}/message.txt [--file <path>::<media type>]...
```

and `--package <folder or .tar.gz>` and `--architecture <record.md>` name them
on disk instead, for running it by hand. It writes `asked.json`,
`declared.json`, `traced.json`, `assessment.json`, `security-review.md` and,
when something was missing, `went-without.json` to `{records}/<job id>/`, adds
the review to `{records}/reviews.json`, copies the review to `{job_dir}/out/`
with `{job_dir}/pieces.json` for the adapter to deliver, and prints one JSON
object whose `reply` says the verdict. A refusal is a review too, and is
delivered. With no package it exits 3 and says what it needs.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- For the one judgment, the model the install places (`AGENT_MODEL`), and
  where to call it (`GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` for a
  model on Vertex AI, or a Gemini key). It is reached through the shared caller,
  `scripts/caller.mjs`, copied unchanged from AgentMesh's
  `packages/explainer/shared/caller.mjs` with its `model-record.mjs`; no model
  is named in this package. Without a model the review is the same review,
  and says nobody weighed the reasons. A `CEILING_TEXT_REASONING` below 1
  makes no call.

## Running it

```sh
node --test test/*.test.mjs                                   # 71 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

`test/run.test.mjs` starts the job exactly as the runtime requirements say,
from a package laid out the way the builder lays it out, and holds it to the
role's own check: one system at read with the owner's limit passes and names
the system, its access, its reason and the limit; a program changed to reach a
second system is refused and the system named; no spending limit is refused;
asked to bind the credential, it declines. It also reviews its own package and
passes it. `test/bypass.test.mjs` tries the ways a package could reach a host
it never declared, or carry a credential into the review, and holds each one
caught: a user name in front of the host, an address built from a value, one
word of a host in a reason, code in an odd file or a test a program imports,
a bundled node_modules, an address kept in a list, a stray quote, a package's
own ARCHITECTURE.md, and an archive that cannot be read whole.
`test/parts.test.mjs` checks the parts.

## Replacing it

This is a reference implementation. Any agent that holds the security
reviewer role can take its place.
