# What the house stack is

This file is about how a package is BUILT: the language, the shape of a
script, records, and how a script reaches a system. It is not about which
PRODUCT stands behind a system. That is the House Stack, AgentMesh's own
choice of product per system (Google Gemini for text reasoning, Hindsight for
agent memory, and so on), listed with the reasons and what a customer can
choose instead at https://dev.agentmesh.ai/house-stack.html. An organization's
own choices are Your Stack. A script never depends on either: it names the
system and reads what the installer bound.

Read off the nine packages that already run, not invented. Counted on
2026-09-13 across brand-reader, brief-writer, explainer-critic,
explainer-maker, process-runner, publisher, quiz-maker, spec-writer and
video-watcher: 74 scripts. This is the stack every script you write is in,
whatever language the prototype you were given is in. Reading a prototype in
another language for what it does and writing it again here is the whole of
the job, and it has a name: agentic transpiling.

## The language

Every script is a `.mjs` file: JavaScript as an ES module, run by node 22 or
later, and nothing else. No TypeScript to compile, no build step, no
`package.json`, no dependency outside node's own modules. `node:fs`,
`node:path`, `node:crypto`, `node:child_process`, `node:test`; a script that
needs more than those is asking for a spec change, and that is not yours to
make. There is no Python in a package and there will not be.

## The shape of a script

All 74 open with a comment block: what the script decides, why it is shaped
the way it is, and then a `needs:` line and the command line with its
variables, in this form:

    //   needs: node >= 22
    //   JOB_DIR=<job folder> RECORDS=<records folder> node pieces.mjs

68 of 74 export the functions that do the deciding, named for what they
decide (`typeOf`, `carriesASecret`, `nameFor`, `blanksOf`), taking plain
values and returning plain values. The suite imports them by these names,
and the names the suite imports are the interface you are meeting: you do not
rename them, and you do not add a function the suite did not name unless a
script needs it privately.

Anything that reaches the world is a function handed in, with a real default:
`fetchImpl = fetch`, `call`, `io = {}` with `io.read ?? readFileSync`. A test
hands in a fake; the main hands in nothing and gets the real one. This is why
no test touches a network and why a test that fails is a decision that failed.

The main is thin and guarded:

    const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
    if (thisFile && import.meta.url.endsWith(thisFile)) { ... }

It reads its variables from `process.env`, exits 2 with a line saying which
are required when one is missing (48 of 74 do this: "JOB_DIR and RECORDS are
required"), exits 3 with a `reply` when there is nothing to do, exits 1 on an
error with the message on stderr, and exits 0 when done. What it prints: 14
scripts print one JSON object; 60 print one sentence or nothing and write
their result to the files the variables name. The command line in the job's
instructions is the contract; the variables it names are the ones the main
reads, with exactly those names.

## Records and the job folder

A job writes what it did to `records/<job>/`, one JSON file per record the
spec declares under `records`, with `"<name>": "v1"` as the first key so a
reader can tell the shape. It writes them whether the job succeeded or not.

What it delivers goes under the job folder's `out/`, and `pieces.json` at
the job folder's root lists each delivered piece with `name`, `step` (the
job that made it), `path`, `media_type`, `about` (one plain sentence saying
what the piece is, for a reader who has only the file) and `produced_from`.
The adapter signs the manifest from that list. A job with no `pieces.json`
delivered nothing. Files are copied by their bytes, `writeFileSync(to,
readFileSync(from))`, never with `copyFileSync`, which carries a mode a
mounted job folder refuses.

## What it went without

When a job goes ahead without something it takes, it says so: `note(records,
{ wanted, did, why })` from `went-without.mjs`, the same file in every
package, byte for byte. `wanted` is the thing that was missing; `did` is a
verb phrase reading after "it", what was done instead; `why` only when it is
actually known. The reply reads the record with `paragraph(records)` and says
it near the top. A run that quietly went without something is worse than one
that stopped.

## Reaching a system the spec declares

A spec may say the agent reaches a system: `database`, `files`, and the
others the platform reserves. It names the system and never a product. The
account says which product stands behind that name, and the installer binds
an address and a key to the variables the spec's install entry names. Nothing
you write chooses a vendor, carries a vendor client, or contains an address.

There is one shared script per system name and you copy it as it stands, the
way you copy `pieces.mjs` and `went-without.mjs`:

- `store.mjs` for `database`. `put(table, id, row)`, `get(table, id)`,
  `list(table, where)`, `remove(table, id)`, `reachable()`. It reads
  `DATABASE_PRODUCT`, `DATABASE_ADDRESS`, `DATABASE_KEY` and, for Supabase,
  `SUPABASE_SCHEMA`.
- `files.mjs` for `files`. `put(name, bytes, contentType)`, `get(name)`,
  `remove(name)`. It reads `FILES_PRODUCT`, `FILES_ADDRESS`, `FILES_KEY` and
  `FILES_PREFIX`.

Agent memory (`agent-memory`) has no shared script. It is reached through
three Mesh Provided tools the agent's harness already has, `remember`,
`recall` and `reflect`, which the adapter signs with the agent's own key.
A script does not call the memory service and carries no address or key for
it; a job that should remember something says so in its instructions and the
harness uses the tools. Neither the House Stack's database nor its file
store exists yet, so a package declaring `database` or `files` runs only for
an organization that chose its own product; the script's refusal says so.

The spec's install entry for the system has to declare those variables, or
nothing fills them: the key's variable (`DATABASE_KEY`) as the credential's
`env`, and `DATABASE_PRODUCT` and `DATABASE_ADDRESS` under `settings`. The
platform fills a declared `<SYSTEM>_PRODUCT` and `<SYSTEM>_ADDRESS` from what
the account bound, and the installer refuses a variable nobody declared, so an
undeclared one is not quietly placed either way. A script that finds its
product variable empty refuses rather than guessing, and that refusal is the
sign the declaration is missing.

Three rules about them, and they are the reason the scripts exist:

1. **Every call answers, and none throws.** You get `{ ok: true, ... }` or
   `{ ok: false, said }`, where `said` is the product's own words. A step that
   could not write says so in its report and, where the job can go on without
   it, records it through `went-without.mjs`.
2. **Absent is an answer.** A row that is not there is `{ ok: true, row: null }`
   and an object that is not there is `{ ok: true, bytes: null }`. Do not treat
   either as a failure.
3. **A binding that cannot work refuses before it calls anything**, naming what
   is wrong: no product bound, a product this script does not speak, a bucket
   with no name. Pass that sentence on rather than rewriting it.

Your suite fakes them the way it fakes everything else: every function takes
`{ env, fetchImpl }` with real defaults, so a test hands in a fake `fetchImpl`
and no test touches a network. You do not write a second way to reach a
product, and you do not read a credential anywhere else in the package.

## Refusals are acts

A refusal in the spec is written as a gerund, then why, then what happens
instead, and the script that holds it refuses in those words. "Accepting a
credential value pasted into a message" is enforced by a check that finds
the value and leaves it out of every record and every line of the reply.
Nothing that looks like a credential is ever written anywhere.

## Prose

Comments say why, not what. Plain sentences, no metaphors, no vendor names.
American spelling. Never an em dash. A comment that restates the line below
it is deleted.

## What the suite pins, and so what you write to

Each refusal, as a case that tries it and is refused with the reply's
wording. The empty case: exit 3 with the reply the job's `empty` sentence
promises, no model called, no pieces filed. Each record written where
declared, whether the job succeeded or not. The job's `good` sentence, clause
by clause. The process contract: the exit-2 line. The spec itself: the
offering's steps are jobs, each job's `how` is what it claims. Read the suite
before writing a line; it is a more exact statement of the job than the spec.
