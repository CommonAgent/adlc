# Reverse engineer

This agent holds the [reverse engineer](https://agentroles.ai/reverse-engineer.html)
role for the Reverse engineering stage (00) of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

Code that already exists comes into the lifecycle with no statement of the job
behind it, and nobody can decide which of its behaviors to keep until somebody
has said what they are. Given a codebase at a named commit, the reverse
engineer writes down what is there: what the code does, how it is built, what
it reaches, what it depends on and what its tests cover. It hands back the
as-built record. Every claim in it names a file and line at the commit (or the
observed run), and every gap is marked. It never says whether the code is
right, writes no tests and changes nothing in the codebase. The person decides
at Requirements, where each behavior is approved, flagged as a bug for the
backlog, or dropped.

It runs when needed: on adoption, when a codebase is taken on, and on drift,
when the code changed outside the lifecycle. Given the last as-built record, it
covers only what changed since that record's commit.

## What it is given

One offering, `reverse-engineer`.

| Input | Kind | |
|---|---|---|
| codebase | `application/gzip` | required: the codebase's folder as a gzip tar archive, with its `.git` folder so the commit can be checked and drift read. Run as a command, `--codebase <folder>` names the folder instead |
| repository | `url` | required: a `repository: <its address>` line in the message (or `--repository`). Words that tie the record to its source; never fetched |
| commit | `identifier` | required: a `commit: <digest>` line (or `--commit`) |
| last as-built record | `application/vnd.agentmesh.as-built-record+json` | optional: the last record's `record.json`. With it the job is drift |
| last behaviors | `application/vnd.agentmesh.as-built-behaviors+json` | optional: the last record's `behaviors.json`, so changed behaviors keep their ids |

Two settings, in the Descriptor's `run_config`: `may_run` (`no` or `yes`,
default `no`), whether it may run the project's own tests once, and
`baseline_seconds` (30 to 600, default 300), the run's time limit. A
`may run: yes` line, or `--may-run yes`, says the same.

## What it hands back

Under `out/as-built/`, one file per part, and `pieces.json`:

- `record.json`: the repository, the commit digest, whether the commit was
  checked, the read mode (`read` or `read and run`), the trigger (`adoption`
  or `drift`), each part with its digest, and an index of the behaviors for
  the next drift;
- `behaviors.json`: each behavior in the feature list's shape (id, name,
  does, and offering when the code shows one), with its inputs, outputs,
  refusals and error handling, its kind from a fixed list, its anchor (one
  behavior per exported function another file imports, or per command), the
  patterns and words other code depends on quoted byte for byte, its order,
  limit, header and default rules, the constants it uses, its evidence, and
  `as_built: true`;
- `architecture.json`: the architecture as built, in the architecture
  record's shape ([standards/architecture-standard.md](../../standards/architecture-standard.md),
  section 9), marked as built, with the parts, entry points, data stores and
  how the code starts; settings and credentials by name only;
- `interfaces.json`, and any OpenAPI or JSON Schema found or derived, under
  `schemas/`: read by rule, each file the code writes with the JSON Schema
  its value shows (a format id as a constant), each exported function with
  its parameters, whether it is async and what it throws or rejects with,
  each command with its flags, and the exported constants, the environment
  variables and the declared settings by name; the model's descriptions laid
  onto them;
- `sbom.cdx.json`: a CycloneDX 1.5 bill of materials, made by rule from
  `package-lock.json` (or `npm-shrinkwrap.json`), a `package.json` with no
  lockfile, `requirements.txt`, `go.mod` and `Cargo.lock`, never by the model;
- `tests-and-gaps.json`: the test files with their cases and what each
  covers, the project's test command, one baseline run's results (or why it
  did not run), and every gap with its kind.

[references/the-as-built-record.md](references/the-as-built-record.md) gives
every field. [rules.md](rules.md) gives every rule.

## How it works

Six steps, one command (`scripts/describe.mjs`):

1. **Read the codebase.** In a git checkout, the named commit must be the one
   checked out with no tracked file changed, and only the files git tracks are
   read. A folder with no history is read whole and the commit is marked as
   taken as given. The environment variables the code reads, its entry points,
   how it starts, its test files and test command, and the schemas it carries
   are read off by rule, each with its file and line, and so is the surface
   of its JavaScript (`scripts/surface.mjs`, on a small lexer in
   `scripts/js-source.mjs`): exports and who imports them, commands and their
   flags, files written and the shape of each JSON one, regular expressions,
   constants, and imports that leave the codebase's folder (each a gap).
2. **List the dependencies.** The CycloneDX bill of materials, by rule. The
   same files give the same bytes.
3. **Run the baseline**, only when the job may run things: the project's own
   test script (package.json), or `node --test` over its `node:test` files
   when package.json names none or is not there, once, in a child process with a time limit,
   handed only the variables it needs by exact name and a home of its own, so
   no credential of this agent reaches the code. Where the host can (unshare
   on Linux) the run has no network; where it cannot, the record says so.
4. **Draft from the code.** On adoption, in bounded passes, each recorded in
   calls.json: one for the architecture, the interfaces and the gaps (every
   file that fits the reading budget); behavior passes, each shown a few
   source files whole and asked for one behavior per anchor in them, up to
   four at a time; and one for what each test covers. Every pass sees the
   code with each line numbered and the facts already read. On drift one
   pass is shown only the changed files, the diff and the last record's
   behaviors.
5. **Check the evidence.** Every cited file and line is checked against the
   code at the commit. A claim with no evidence that checks, a claim that
   judges or infers, and on drift a claim about lines that did not change are
   held back and listed as gaps, each with the reason. Each behavior is held
   to the fixed kinds and to one behavior per anchor, each quote is found in
   the code byte for byte or dropped, each rule needs its kind and evidence,
   and each drafted schema keeps only the fields and constants the code has.
6. **Write the record.**

The model is reached through the shared caller (`scripts/model-caller.mjs`,
copied byte for byte from `agents/package-maker/shared/`), with the four model
settings the install places: `MODEL_NAME`, `MODEL_ENDPOINT`, `MODEL_KEY` and
`MODEL_PROTOCOL`. Without them, the parts read by rule are still delivered and
the drafted parts are listed as gaps.

## Running it

```sh
MODEL_NAME=<model> MODEL_ENDPOINT=<endpoint> MODEL_KEY=<key> MODEL_PROTOCOL=<protocol> \
node scripts/describe.mjs --job ./job --records ./records --work ./work \
  --codebase <folder> --repository <its address> --commit <digest> [--may-run yes] \
  [--previous <last record.json>]
```

It prints one JSON object with a `reply` field. Exit codes: 0 the record was
written; 2 usage; 3 the job stops and the reply says what is needed; 1 failed.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- git, to check the commit and list the tracked files, and for drift.
- A model endpoint, through the four model settings, for the drafted parts.
- A shell, and the project's own toolchain, to run its tests when allowed.

## Tests

```sh
node --test test/*.test.mjs                                   # 63 tests, and one skipped that reads kept examples
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

The fixture codebases are under `test/fixtures/`: a small Node project with a
package-lock and a test script (`node-app`), one with no tests and no lockfile
(`no-tests`), a drift case whose two commits the suite makes (`drift/v1`,
`drift/v2`), and a small agent with no package.json (`news-agent`): an output
file with a format id, an exported async function its test imports, a
stop-notice pattern, a fallback order, a cap, request headers and a test that
imports `../../shared`. The model is stood in by the answers under `test/fixtures/answers/`,
which mix claims that check with ones that cite missing files, lines past the
end, nothing, or a judgment. `describe.test.mjs` is the role's own check
(section 40.4); `drift.test.mjs` the drift case; `evidence.test.mjs`,
`sbom.test.mjs` and `baseline.test.mjs` each step's rules; `surface.test.mjs`
what is read by rule; `behaviors.test.mjs` the kinds, anchors, quotes, rules
and drafted schemas; `news-agent.test.mjs` the interfaces, quotes, passes,
baseline and granularity on the news agent; `run.test.mjs`
starts the job as the runtime requirements say, from a package laid out the way
the builder lays it out, against a model stand-in on the machine.

`records/` holds the build notes of each version.

## Not done yet

- The baseline runs the test script package.json names, or `node --test`
  over `node:test` files; another project's tests (pytest, go test, Jest
  with no test script) are found and listed but not run, and that is a gap.
- The surface read by rule covers JavaScript and TypeScript only. In another
  language the exports, commands, files written and patterns come from the
  model's draft alone, still evidence-checked and quote-checked.
- A function's throws are read from its own body, not from what it calls.
- The running form of a codebase (a deployed service to observe) is not read;
  behavior seen only at run time is a gap.
- The bill of materials does not read yarn.lock, pnpm-lock.yaml or the Python
  lockfiles; each one found is a gap.

## Replacing it

This is a reference implementation. Any agent that holds the reverse engineer
role can take its place.
