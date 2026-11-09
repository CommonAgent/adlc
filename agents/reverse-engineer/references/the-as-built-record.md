# The as-built record

The record the reverse engineer hands back, file by file. Every file is JSON,
written with two-space indents and a final newline. The parts are listed in
the order stages.json (1.4.0) gives them.

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
| `drafted` | whether a model drafted the behaviors, architecture and interfaces |
| `parts` | each part delivered: `{part, file, format, sha256}` |
| `dependencies` | drift, when no manifest changed: `{unchanged_since}` |
| `dependencies_changed` | drift, when one did: `{added, removed, changed}` |
| `schemas` | each schema file delivered, with its digest |
| `behaviors_index` | each behavior's id, name and the files its evidence names, for the next drift |
| `counts` | behaviors, interfaces, settings, components, tests, gaps, and claims held back |
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

`{format: "as-built-interfaces-v1", as_built, interfaces, schemas_found, schemas_derived}`.
Each interface: `{id, kind, name, does, evidence, schema?}`, where kind is
`http`, `command`, `message`, `file` or `function`, and `schema` names a file
under `schemas/`. A schema the code carried is copied under
`schemas/found/`; one derived from the code is written as
`schemas/<interface id>.openapi.json` (OpenAPI 3) or
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
- `test_command`: `{command, evidence}`, or `{none}` saying why there is none.
- `baseline`: `{ran: false, why}`, or the run: `command`, `exit_code`,
  `timed_out`, `time_limit_seconds`, `seconds`, `network` (cut off or not,
  in words), `passed`, `failed`, `skipped`, `read_from`, `output_tail`.
- `behaviors_without_tests` (adoption): the ids no test covers.
- `gaps`: each `{id, kind, part, about, why, evidence?}`, `G1`, `G2`, ...
