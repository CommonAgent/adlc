# What a security review holds

A security review is the statement the Security review stage (stage 08 of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html)) hands
back: what the agent may reach, what it may spend, what it must never do, and
the reason for each. It is done when every permission asked for has a recorded
reason. This file says what the review carries and where each part comes from.

## The header

The review opens with YAML front matter, so a program can read it and a person
can skim it. Every value is a JSON string or number, which YAML reads as the
same value.

| Field | What it is |
|---|---|
| `review` | `security-review-v1` |
| `package`, `version` | the package's name and version, from plugin.json and the descriptor |
| `digest` | `sha256:` of the archive as handed over, when it came as one |
| `verdict` | `passed` or `refused` |
| `reviewed_at` | when the review was written |
| `architecture_record` | `given` or `absent` |
| `spending_limit` | the owner's limit and where it was said, or `none set` |
| `reaches` | each `system`, `access` and `reason` |
| `spends` | each `ceiling`, `limit` and `reason` |
| `never_does` | each `act` and `reason` |
| `no_reason_recorded` | each `permission`, where it is `asked_in`, and why it is `flagged` |
| `refused_for` | what stopped the package, when it was refused |

The body says the same for a reader under fixed headings: `## Verdict`,
`## Reaches`, `## Spends`, `## Never does`, `## No reason recorded`,
`## Programs`, `## Parts`, `## Accepted knowingly`, `## Reasons weighed` and
`## Not reviewed`.

## Reaches

Each thing the agent is granted, with the reason the package records for it:

- each system in the descriptor's `systems`, at its `access` (`read`, `write`
  or `trigger`), with its `needs` as the reason, the credential the runtime
  requirements name for it (by name, never a value) and whether a caller's
  material is sent to it (`leaves`);
- each binary it runs, with its `purpose`;
- each folder it writes, with its `purpose`;
- each further network destination the architecture record's egress names.

A system the descriptor names and the runtime requirements do not, or the
other way round, refuses the package: the deployment manager refuses it too,
and a caller would be told one thing while the host placed another.

## What the programs reach

The declaration is what the owner agrees to and the programs are what runs, so
every program is read for what it reaches:

- an address written into a program where it is fetched or called. It is
  matched to a declared system by evidence only: the platform's own address
  for a system the package declares (the model services behind
  `text-reasoning`), a system whose stated reason names it, or the
  architecture record's egress. An address nothing matches refuses the
  package, and the refusal names it.
- a call to an address the program is handed. It is taken as the declared
  reach of the same program's written address (a model's door built from its
  host), or of a declared system whose reason is fetching what it is handed.
  Otherwise the package reaches whatever it is handed while saying it
  reaches nothing, and it is refused.
- an environment variable whose name says it holds a credential, which no
  system declares. That is a credential nobody agreed to place, and it refuses
  the package.
- a command it starts that the runtime requirements do not declare, and a
  browser that routes none of its requests (it loads every address the pages
  pull in).

Comments, tests, and names that are not places (XML namespaces, schema
addresses, example hosts) are left out. The programs are read as text and not
run, and the review says that an address built from parts at run time is not
seen.

## Spends

The owner's spending limit comes first: a line `spending limit: <amount> per
<day|month|job>` in the message, or the architecture record's limits. A package
whose owner set none is refused; the reviewer never supplies one.

Then each ceiling the runtime requirements declare on a spending system, with
the number the package suggests and the reason (the ceiling's own, or the
reason recorded for the system it bounds); each ceiling an offering states;
the trial ceiling; and the most time one job may take. A system that spends
with no ceiling is flagged. What the package charges callers is noted and is
not a spend.

## Never does

The package's own refusals, each split into the act and the reason after it,
and the bounds its grants set:

- a system granted read is never written; one granted trigger is started and
  answered, never read or changed;
- a caller's material goes only to the systems the descriptor says it leaves for;
- it reaches no address its declared systems do not cover;
- it holds no credential value;
- it starts no program it does not declare, when it declares none;
- it stops when it is stopped.

Each says what holds it: the platform, where the platform enforces it, or the
package's own programs, where nothing else does.

## No reason recorded

Every permission asked for with no recorded reason, flagged with where it is
asked and why. A reason is a few words that say what the access is for; an
empty string, a dash or a single word is not one. Any entry here refuses the
package, because the stage is not done until every permission has a reason.

## Parts

The code the package brings in and did not write: each lockfile, and each
dependency the runtime requirements pin by digest. It runs with everything the
agent is granted, so it is listed as accepted knowingly.

## What it looks for in the files

Everything the package carries is read for what the publisher refuses to
publish (`agents/publisher/references/what-it-will-not-publish.md`): a private
key, a service-account key, an AWS key, an NKey seed, a PKCS#12 keystore. A
match refuses the package and is named by file and line; its bytes go into no
review, record or reply. A link or a path that climbs out of the archive
refuses it too.

## The architecture record

When it is given, every system the package declares must be one the record
names, and a system it declares that the record does not is refused: nobody
designed the agent to reach it. A system the record names that the package
does not declare is noted. Its egress names further destinations the programs
may reach, and its limits may carry the owner's spending limit. When it is not
given, the review says so near the top and goes on against the package's own
declaration.

## Reasons weighed

One call to the text-reasoning service, under `rules.md`, judges whether each
recorded reason accounts for its access: `holds`, `thin` or `does-not-cover`,
with one sentence why. It never changes the verdict. Without a model the review
says nobody weighed them.
