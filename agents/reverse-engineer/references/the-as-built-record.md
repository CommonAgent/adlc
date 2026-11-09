# The as-built record

The record the reverse engineer hands back, file by file. Every file is JSON,
written with two-space indents and a final newline. The parts are listed in
the order stages.json (1.4.0) gives them.

## Changes in 0.2.0, all additive

Every change in 0.2.0 adds a field or a value. No field was renamed, retyped
or removed, so a reader of 0.1.0's files reads 0.2.0's unchanged and may
ignore what it does not know. For that reason no format id changed: each
file still says `as-built-*-v1`, and record.json's `made_by.version` says
which version wrote it.

- behaviors.json: each behavior adds `kind`, `anchor`, `quotes`, `rules` and
  `constants`.
- interfaces.json: adds `constants`, `flags`, `environment` and `settings`;
  the interfaces read by rule add `read_by_rule` and the fields of their kind
  (below); `schemas_derived` entries add `read_by_rule` and `drafted`.
- tests-and-gaps.json: `test_command` adds `found_by` and `not_run`; the gap
  kinds add `outside-the-codebase`. The gap fields are unchanged.
- record.json: `counts` adds `behavior_kinds`.
- The job's records: calls.json adds `passes`, and each call names its pass.

## What counts as one behavior

One behavior per anchor. The anchors are read by rule (scripts/surface.mjs):

- each exported function or class that another file of the codebase imports
  (a test counts);
- each export of the package's main module (package.json `main`);
- each file that starts as a command (a `#!` line, `require.main === module`,
  a comparison with `process.argv[1]`, package.json `bin`, or an Agent
  Package's run command).

A function used only inside its own file is part of the behavior of the
anchor that calls it, never a behavior of its own. The branches, defaults,
fallbacks, limits, quoted patterns and refusals of one anchor are fields of
its one behavior, never behaviors of their own. Where the code has no anchors
read by rule (another language, or one script), there is one behavior per
public function, command, route or message handler, by the same rule. Code no
anchor reaches is a gap of kind `unreachable`.

The record check holds back, as a gap, a behavior whose anchor is
`<file>#<name>` but not an anchor read by rule, and a second behavior for an
anchor another behavior already has. On adoption, an anchor no behavior
describes is a gap of kind `unclear`, and the behaviors are numbered in the
order of their anchors (by file, then line), so the same anchors get the same
ids from one run to the next.

## Behavior kinds

A fixed list, in order of precedence: when more than one fits, the first is
the kind. A behavior with any other kind, or none, is held back as a gap.

| Kind | The behavior |
|---|---|
| `entry` | starts a job: a command's main, a route or message handler, an offering's run; it reads the request and calls the rest |
| `fetch` | calls a system outside the codebase (a network address, a database, another agent, a model) and gives back what it answered |
| `write` | writes a file, a record or a message that outlives the call |
| `state` | reads what an earlier job or run left behind (a prior job folder, a cache, a revision) |
| `check` | decides whether to go on: recognizes a notice, validates input or settings, or refuses |
| `parse` | reads structured values out of text or data it is handed, with no outside call |
| `compute` | works out a value from values it is handed (a count, a price, a choice) |
| `compose` | makes the words or the document it gives back (a reply sentence, a report, a greeting) |

## record.json

The record that ties the parts to their source.

| Field | What it holds |
|---|---|
| `format` | `as-built-record-v1` |
| `as_built` | `true` |
| `repository` | the repository's address, as given |
| `commit` | the full commit digest |
| `commit_checked` | `true` when the folder was a git checkout at that commit with no tracked file changed; `false` when the folder had no history and the commit was taken as given |
| `folder` | the codebase's folder inside the repository, when it is not the top |
| `read_mode` | `read`, or `read and run` when the baseline ran |
| `trigger` | `adoption`, or `drift` when the last record was given |
| `since` | drift: `{commit, record_sha256}` of the last record |
| `changed_files` | drift: each file that changed, with `added`, `modified`, `deleted` or `renamed` |
| `drafted` | whether a model drafted any part (a pass that did not answer leaves its part as a `not-drafted` gap) |
| `parts` | each part delivered: `{part, file, format, sha256}` |
| `dependencies` | drift, when no manifest changed: `{unchanged_since}` |
| `dependencies_changed` | drift, when one did: `{added, removed, changed}` |
| `schemas` | each schema file delivered, with its digest |
| `behaviors_index` | each behavior's id, name and the files its evidence names, for the next drift |
| `counts` | behaviors, interfaces, settings, components, tests, gaps, claims held back, and (0.2.0) `behavior_kinds`: how many behaviors of each kind |
| `done` | `true`: every claim delivered was checked, every gap is listed |

## behaviors.json

`{format: "as-built-behaviors-v1", as_built, repository, commit, since?, behaviors}`.
Each behavior is in the feature list's shape (lifecycle API `Feature`):

| Field | What it holds |
|---|---|
| `id` | `B1`, `B2`, ... stable across drift: a changed or removed behavior keeps its id |
| `name` | a few words |
| `does` | one sentence, in the present tense, saying what the code does |
| `offering` | only when the code itself shows one (a command, a route) |
| `inputs`, `outputs`, `refusals`, `error_handling` | lists of words, from what the code shows |
| `kind` | 0.2.0: one of the behavior kinds above |
| `anchor` | 0.2.0: what it describes, `<file>#<export>`, or `<file>` for a command's main block |
| `quotes` | 0.2.0: `[{what, text, evidence, by_rule?}]`, the patterns and words other code depends on: regular expressions as written, slashes and flags included; format ids and magic strings; reply sentences and refusals, a template as written with its `${...}`; notices it recognizes. `text` is in the code at `evidence` byte for byte: the check searches the cited lines, then the cited file, sets `evidence` to the lines where it found the text, and drops a quote it does not find, as a gap. `by_rule: true` marks a regular expression attached by rule: one written in the behavior's cited lines, or one at the top of its file that those lines use by name |
| `rules` | 0.2.0: `[{kind, rule, quote?, evidence}]`, each rule on the behavior: `order` (what is tried first and what next: a fallback order, a precedence), `limit` (a cap, a timeout, a size, a count, retries), `header` (a request header or another fixed field sent), `default` (the value used when nothing says). A `quote`, when given, is checked byte for byte like a quote. A rule with another kind, words that judge or infer, a quote not found, or no evidence is a gap |
| `constants` | 0.2.0, by rule: `[{name, value, evidence}]`, the literal constants at the top of the file that the cited lines use by name, with their values (a name that says credential gets `withheld` instead of a value) |
| `evidence` | `[{file, line, end_line?}]`, a line at the commit; `{file, line, at}` names the last record's commit for a removed behavior; `{run: "baseline"}` the observed run |
| `change` | drift only: `new`, `changed` or `removed`; `was` names the id it had |
| `as_built` | `true` |

## architecture.json

The architecture record's shape (standards/architecture-standard.md, section 9),
marked as built: `record: architecture-record-v1`, `as_built: true`, and the
record's fields. What the code can show is filled in, each item with its
evidence: `kind`, `systems` (with the product the code names), `dependencies`,
`egress` (the networks reached), `formats`, `settings` (names only, `credential`
marked by the name), and four fields the stage adds for a record made from
code: `parts`, `entry_points`, `data_stores` and `starts_and_runs`. What the
code cannot say is left empty and named in `not_in_the_code`: the statement,
the environments and bindings, the limits and the decisions.

## interfaces.json

`{format: "as-built-interfaces-v1", as_built, interfaces, constants, flags, environment, settings, schemas_found, schemas_derived}`.

Each interface: `{id, kind, name, does, evidence, schema?}`, where kind is
`http`, `command`, `message`, `file` or `function`, and `schema` names a file
under `schemas/`. The interfaces read by rule come first, in a fixed order
(the files written, then the exported functions and classes, then the
commands), each with `read_by_rule: true`; a drafted interface that matches
one of them is laid onto it (its `does` and, for a function, `returns`), and
the other drafted ones follow.

- A file the code writes (0.2.0, kind `file`): `path` (from the literals of
  the path expression, following one const name; a default after `||` or `??`
  left out), `direction: "out"`, `content` (`json` or `text`), `written_as`
  (the path expression as written), and `appended` when it is appended to. A
  JSON one gets `schemas/<id>.schema.json`: the JSON Schema its value shows by
  rule (field names, types, `required` for the fields always written, `const`
  for a literal such as a format id, `enum` for a choice of literals, and
  `$comment: "value: <expression>"` where the code builds the value elsewhere),
  with the drafted schema filling only those `$comment` parts. A JSON file
  whose fields neither the rule nor the draft shows is a gap.
- An exported function or class (0.2.0, kind `function`): `module`, `export`,
  `params` (as written), `async`, `throws` (sync) or `rejects` (async), each
  `{error, evidence}` for a `throw new X` or `reject(new X)` in its own body,
  `rethrows` for a `throw e`, `imported_by` (the files that import it), and
  `returns` when the draft says it with evidence. Exports are listed for each
  module another file imports, the main module, and each command.
- A command (0.2.0, kind `command`): `command` (its file) and `flags` (every
  string that is a flag on its own, `--name`, in it and in the files it
  imports).
- `constants`: each exported constant or value of those modules, `{module,
  name, kind, value?, imported_by, evidence}`; a literal's value is given,
  except where the name says credential.
- `flags`: each flag, with every place it is written.
- `environment`: each environment variable the code reads, by name, with
  `credential` and evidence (the names architecture.json `settings` reads by
  rule).
- `settings`: each run-config setting an Agent Package declares
  (agent-descriptor.json `run_config.settings`), by name, never a value.

A drafted JSON Schema is checked before it is used: a field it names that is
not written in the code, and a `const` or `enum` value that is not a literal
in the code byte for byte, are taken out and listed as a gap; where the
code's object literal is closed, a drafted field it does not have is not
added. A schema the code carried is copied under `schemas/found/`; one derived
is written as `schemas/<interface id>.openapi.json` (OpenAPI 3) or
`schemas/<interface id>.schema.json` (JSON Schema).

## sbom.cdx.json

CycloneDX 1.5, JSON. `metadata.component` is the codebase; `metadata.properties`
name the repository, the commit and each file read. Each component has its
package URL as `bom-ref` and `purl`, its version, its hashes where the lockfile
gives an integrity, `cdx:npm:package:development` for a development
dependency, `scope: optional` for an optional one, `as-built:version-is-a-range`
where only a range is known, and `evidence.occurrences` naming the file it was
read from. `dependencies` gives what each one depends on. The serial number is
made from the repository, the commit and the files read, so the same inputs
give the same document.

## tests-and-gaps.json

`{format: "as-built-tests-and-gaps-v1", as_built, repository, commit, tests, test_command, baseline, gaps}`.

- `tests`: each test file with its cases (each with its line), the behaviors
  it covers (`covers`), and the evidence for what it covers.
- `test_command`: `{command, evidence, found_by?, not_run?}`, or `{none}`
  saying why there is none. The command is the test script package.json
  names. When package.json names none, or is not there, and the code has
  `*.test.mjs`, `*.test.js` or `*.test.cjs` files that import `node:test`
  (outside any `fixtures` folder), it is `node --test` over them, and
  `found_by` says so (0.2.0); `not_run` lists a test file left out because
  its path would need quoting.
- `baseline`: `{ran: false, why}`, or the run: `command`, `exit_code`,
  `timed_out`, `time_limit_seconds`, `seconds`, `network` (cut off or not,
  in words), `passed`, `failed`, `skipped`, `read_from`, `output_tail`.
- `behaviors_without_tests` (adoption): the ids no test covers.
- `gaps`: each `{id, kind, part, about, why, evidence?}`, `G1`, `G2`, ...
  The kinds: `unreachable`, `run-time-only`, `unclear`, `not-read`,
  `not-drafted`, `not-checked`, `claim-without-evidence`, `held-back`,
  `outside-the-change`, and (0.2.0) `outside-the-codebase`: an import that
  reaches a file outside the codebase's folder (such as `../../shared/x.mjs`),
  which the code depends on and a copy of the folder alone does not carry.

## The job's records

Beside the delivered parts, the job keeps under `records/<job>/`:
`draft.json` (the merged draft), `calls.json`, `went-without.json` and, when
the tests ran, `baseline.log`. calls.json is `{calls: "v1", model, service,
made, each, passes, files_sent}`: `each` has one entry per call, with the
pass it served and its tokens, and `passes` (0.2.0) one entry per pass, with
the files it was shown, whether it answered, and why not.
