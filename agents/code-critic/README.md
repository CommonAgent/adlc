# Code critic

This agent holds the [code critic](https://agentroles.ai/code-critic.html)
role for the Review stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

It is given the programs, the tests and the Code stage's account, with the
package's declarations as part of the change, and it hands back findings,
each naming a place, a claim and a consequence. The stage is done when every
finding is answered, by a change or a reason. The findings are one Markdown
document with a light header; a person writes a reason after `Answer:`, or
changes the code, and sends the document back with the package, and the next
review says which findings are answered and which are still open.

It changes nothing. It writes no patch, opens no pull request, grades
nothing as a whole, and leaves whether a package may reach a system to the
security reviewer, the next stage.

## What it checks

First, with a program and no model, the house architecture rules
([references/the-house-rules.md](references/the-house-rules.md)):

- no model name or version in code: scripts read the configured model
  (`TEXT_MODEL` or `AGENT_MODEL`) through the shared caller;
- no address hard-coded where a bound system belongs;
- every delivered piece matches its declared kind, and no kind is a bare
  `application/json`;
- no undeclared outputs;
- refusals and records match what the code really does: declared records
  are written, written records are declared, credentials are bound, and
  each step's `how` is what its scripts do.

With a diff, an access a declaration adds is a finding too. A credential
value carried in the package is a finding, and is left out of the records,
the model's prompt and the reply.

Then one call to the configured model, with every file line-numbered and
the house-rule findings already made, for what a program cannot see. Every
finding it gives that names no file and line of the package, makes no claim,
says no consequence, grades the work or writes the fix is dropped, with its
reason kept in the job's records.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- A text model, bound as the `text-reasoning` system: `TEXT_API_KEY`, and
  `TEXT_MODEL` for the model, which must hold a whole package in one
  context. The package names no model of its own; with none configured it
  delivers the house-rule findings and says the review went without the
  model.

## Running it

```sh
node --test test/*.test.mjs                                   # the suite
python3 ../package-maker/build.py . ./out                     # an Agent Package
node scripts/job.mjs --job <job> --records <records> --work <work> \
  --text-file <message> --file <package.tgz>::application/gzip
```

Send the package as a tar.gz of its folder so every finding can name its
path; loose files work too, put back where `plugin.json` says they live.

## Replacing it

This is a reference implementation. Any agent that holds the code critic
role can take its place.
