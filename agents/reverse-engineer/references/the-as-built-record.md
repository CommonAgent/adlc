# The as-built record

The record the reverse engineer hands back, file by file. Every file is JSON,
written with two-space indents and a final newline. The parts are listed in
the order stages.json (1.4.0) gives them, and strings.json (0.3.0) after them.

## Changes in 0.3.0, all additive

A round trip on a real agent showed what a rebuild still lost: the reply
sentence it prints, extra page metadata sources in its code, the label a
person reads in its descriptor, two exported constants recorded only as
constants, which command flags are required, and the only values a field
may take. 0.3.0 makes the record carry every fact a rebuild needs, found by
code, each pointing at a file and line, and checks that it does.

Every change adds a file, a field or a value. No field was renamed, retyped
or removed, and every format id stays `v1` (`as-built-record-v1`,
`as-built-interfaces-v1`, `as-built-tests-and-gaps-v1` and the rest), so a
reader of 0.2.0's files reads 0.3.0's unchanged and may ignore what it does
not know. The new part is new, so it starts at `as-built-strings-v1`.

- interfaces.json:
  - interfaces of kind `constant`: one for every exported constant,
    `{id, kind: "constant", name, does, module, export, value, imported_by,
    evidence, read_by_rule: true}`, with `withheld`, `pattern`,
    `value_made_as` or `from` where they apply (below);
  - interfaces of kind `declaration`: one for every name and value the agent
    declares to the platform in its own files, `{id, kind: "declaration",
    name, does, declared_in, value, evidence, read_by_rule: true}` (below);
  - a command interface adds `required_flags`, `required_flags_by`,
    `required_flags_evidence`, `optional_flags` and, while some are not
    settled, `flags_unsettled`;
  - a file interface adds `values` and `values_evidence`, and its schema
    carries `enum` (or `const`) on each field the code only writes from a
    fixed set of literals;
  - function interfaces are now made for the exports of every module of the
    code, not only the ones something imports (the anchors are unchanged);
    a function re-exported from another module adds `from`.
- strings.json: a new part, `as-built-strings-v1`.
- tests-and-gaps.json: adds `carried` and `support`; the gap kinds add
  `incomplete`. The gap fields are unchanged.
- record.json: `parts` adds the strings part, `carried_files` is added, and
  `counts` adds `strings`, `carried` and `completeness`.
- The record's folder adds `tests/` and `support/`, the carried files.
- The command line adds `--repository-root <folder>`.

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
| `counts` | behaviors, interfaces, settings, components, tests, gaps, claims held back, and (0.2.0) `behavior_kinds`: how many behaviors of each kind; (0.3.0) `strings` (how many strings.json holds), `carried` (how many files are carried) and `completeness` (below) |
| `carried_files` | 0.3.0: each carried file, `{file, sha256}`, `file` being its path in the record's folder (`tests/...` or `support/...`) |
| `done` | `true`: every claim delivered was checked, every gap is listed |

### The completeness check (0.3.0)

record.mjs reads the code again, by code, and checks the record against it.
`counts.completeness` holds one entry per check, each `{found, covered,
missing}`, and `missing`, the sum:

- `exports`: every export of every module of the code (function, class and
  constant) has an interface in interfaces.json;
- `files_written`: every file the code writes has a file interface;
- `commands_required_flags`: every command has a command interface whose
  required flags are settled (no `flags_unsettled`);
- `declarations`: every declaration in the agent's own files has a
  declaration interface;
- `strings`: strings.json holds every string, key and pattern the scanner finds.

Zero missing is the goal. Each thing missing is a gap of kind `incomplete`,
part `completeness`, saying what is missing and why. On drift the check
covers only what changed.

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
`http`, `command`, `message`, `file`, `function`, and (0.3.0) `constant` or
`declaration`, and `schema` names a file under `schemas/`. The interfaces
read by rule come first, in a fixed order (the files written, then the
exported functions and classes, then the commands, then the constants, then
the declarations), each with `read_by_rule: true`; a drafted interface that
matches one of them is laid onto it (its `does` and, for a function,
`returns`; for a command, the required flags the rule left unsettled), and
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
  whose fields neither the rule nor the draft shows is a gap. 0.3.0: a field
  the code only writes from a fixed set of literals carries `enum` (or
  `const` for one), and the interface adds `values`, `{"/json/pointer":
  [allowed values]}` (`*` stands for the items of a list, as in
  `/stories/*/text_from`), and `values_evidence`, the same pointers to the
  lines that write them. The values are read by rule from the object literals
  of the writing file and the files it imports that are shaped like the
  object the field is in (they share at least half its fields): a literal, a
  ternary of literals, a const, or a `let` that is only ever given literals
  (through an `if` and a destructuring such as `[text, from] = [x, "post"]`
  too). When every such literal gives the field a literal, those are its
  values. A drafted `enum` the rule cannot read stands, already checked as
  literals in the code; where the rule reads other values, the rule's stand
  and the drafted ones it does not read are a gap. A field that is a constant
  (`const`, such as a format id) is listed in `values` with its one value.
- An exported function or class (0.2.0, kind `function`): `module`, `export`,
  `params` (as written), `async`, `throws` (sync) or `rejects` (async), each
  `{error, evidence}` for a `throw new X` or `reject(new X)` in its own body,
  `rethrows` for a `throw e`, `imported_by` (the files that import it), and
  `returns` when the draft says it with evidence. Exports are listed for
  every module of the code (0.3.0; 0.2.0 listed them for each module another
  file imports, the main module, and each command). A re-export takes what
  the module it names exports, with `from`.
- A command (0.2.0, kind `command`): `command` (its file) and `flags` (every
  string that is a flag on its own, `--name`, in it and in the files it
  imports). 0.3.0 adds, read by rule (scripts/flags.mjs):
  - `required_flags`: the flags it cannot run without: an `if` whose
    condition has `!args.<field>` as one of its `||` parts, the field being
    the one the flag's branch of the argument loop sets, and whose branch
    refuses (throws, exits, sets an exit code, returns `ok: false` or a
    non-zero `code`);
  - `optional_flags`: `[{flag, why, evidence}]`, the others the code shows it
    can do without: the field starts with a value, is a list the flag adds
    to, falls back (`||`, `??`, `? :`, `&&`), is tested by an `if` that does
    not refuse, the flag is read and passed over, or the code never reads
    the flag from its arguments (a word it passes on, such as to git);
  - `required_flags_evidence`: `[{flag, evidence, drafted?}]`;
  - `required_flags_by`: `rule`, `draft` or `rule and draft`;
  - `flags_unsettled`: `[{flag, why}]`, present only while some flag is
    neither. The draft is then asked, `"required_flags": {"flags": [...],
    "evidence": [...]}`; with evidence that checks, the drafted flags the
    command reads become required and the other unsettled ones optional, and
    `flags_unsettled` goes. A drafted flag the command does not read, or one
    the rule read as optional, is a gap and does not count. A command whose
    flags stay unsettled is an `incomplete` gap.
- A constant (0.3.0, kind `constant`): `module`, `export`, `value` (its
  value as JSON, read by rule from the literal: strings, numbers, booleans,
  null, lists and objects of them, templates whose parts are constants,
  arithmetic on number constants such as `2 * 1024 * 1024`, and names of
  consts with such values; `new Set([...])` gives the list, with
  `value_made_as: "new Set"`), `imported_by`, and `pattern: true` for a
  regular expression (its value is its text, slashes and flags included).
  Where the value is worked out by code, `value` is `null` and a gap of kind
  `unclear` says why. A name that says credential gets `value: null` and
  `withheld` instead, and no gap.
- A declaration (0.3.0, kind `declaration`): each name and value the agent
  declares to the platform in its own files at the codebase's top
  (agent-descriptor.json, agent-runtime-requirements.json, plugin.json) and
  in the front matter of each `skills/<name>/SKILL.md`: `name`, `declared_in`
  (the file and the place in it, `agent-descriptor.json
  offerings[0].outputs[1].name`, or `skills/x/SKILL.md front matter name`),
  `value` (as JSON) and `evidence` (the line). A list of things that each
  have an `id`, a `name` with no space, or a `file` (offerings, inputs,
  outputs, steps, settings, records), and an object keyed by names with a
  dash or a dot (run commands, skills), give one declaration per thing,
  named by what it is (`offering read-the-top-stories`, `output stories of
  read-the-top-stories`, `step read-the-stories of read-the-top-stories`,
  `setting count`, `run read-the-top-stories`), and one per field of it
  (`label of setting count`, `kind of output stories of
  read-the-top-stories`, `command of run read-the-top-stories`). A field
  whose value holds no object inside an object is one declaration with its
  value whole (a list of words, `how`, a `range`).
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

`{format: "as-built-tests-and-gaps-v1", as_built, repository, commit, tests, test_command, baseline, carried, support, gaps}`.

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
- `carried` (0.3.0): the original tests, copied byte for byte into the
  record's folder, never edited: `[{file, at, imports}]`. `file` is the test
  file's path in the codebase and `at` its copy, `tests/<that path>`. Every
  test file is carried, and every other file in a test folder (`test`,
  `tests`, `__tests__`, `spec`), the fixtures the tests read. `imports` lists
  each import of the file that leaves the codebase's folder: `{from, support}`,
  `from` being the import as written and `support` where its copy is, or
  `{from, support: null, why}` when it could not be copied (a gap says the
  same).
- `support` (0.3.0): each file a carried test imports from outside the
  codebase's folder, and each file those import in turn, as far as their
  relative imports go inside the repository: `[{file, at, imported_by,
  imports}]`. `file` is its path from the repository's top and `at` its
  copy, `support/<that path>`, so a test placed at `tests/<its path>` beside
  the codebase finds it where it did. `imports` lists the support file's own
  imports: `{from, support}` for one copied, `{from, codebase}` for one that
  lands back in the codebase, `{from, package}` for a package (not node's
  own, which are not listed), and `{from, support: null, why}` for one that
  could not be read. The repository's top is the folder `--repository-root`
  names, or else the top of the git checkout the codebase is in; in a
  checkout each file is read at the record's commit (`git show`). A file
  outside the repository, a file that cannot be read, a package a support
  file imports, and a repository whose top is not known are gaps of kind
  `outside-the-codebase`; a support file read from a folder with no history
  is a gap of kind `not-checked`.
- `gaps`: each `{id, kind, part, about, why, evidence?}`, `G1`, `G2`, ...
  The kinds: `unreachable`, `run-time-only`, `unclear`, `not-read`,
  `not-drafted`, `not-checked`, `claim-without-evidence`, `held-back`,
  `outside-the-change`, (0.2.0) `outside-the-codebase`: an import that
  reaches a file outside the codebase's folder (such as `../../shared/x.mjs`),
  which the code depends on and a copy of the folder alone does not carry,
  and (0.3.0) `incomplete`: something a rebuild needs that the completeness
  check found the record does not hold.

## strings.json (0.3.0)

`{format: "as-built-strings-v1", as_built, repository, commit, since?, strings}`.

Every string a person reads, every key and every regular expression in the
code's scripts (not its tests), found by code (scripts/surface.mjs `stringsOf`, on
the lexer in scripts/js-source.mjs), never by the model. Each is `{file,
line, end_line?, kind, text}`:

- `words`: a string literal that has a letter and a space, or is a whole
  sentence (a capital first and a stop last, such as `Done.`);
- `template`: a template literal that does, read with its `${...}` parts
  left out (so `${a}/${b}` is not one);
- `key`: a string literal with no space, at least three characters, a
  letter, and one of `_ . : @`, and no `/` (so not a path, an address or a
  media type): the names other code or data depends on, such as
  `citation_title`, `dc.title`, `og:title`, `@graph`,
  `article:published_time`;
- `pattern`: a regular expression literal.

`text` is exactly as in the source: between the quotes or backticks as
written, escapes and `${...}` kept, and a pattern with its slashes and flags.
An import path is not listed, and neither is a bare word with none of
`_ . : @`, such as a field name. `end_line` is there for a template that runs over more than one line.
The behaviors still quote the words they depend on; strings.json is the
whole inventory. On drift it holds the strings on changed lines.

## The carried files (0.3.0)

`tests/<path>` and `support/<path>` in the record's folder, beside the
parts, each listed in pieces.json (`carried test (tests/...)`, `carried
support file (support/...)`, kind `application/octet-stream`) and in
record.json `carried_files` with its digest. On drift only the test files
that changed are carried.

## The job's records

Beside the delivered parts, the job keeps under `records/<job>/`:
`draft.json` (the merged draft), `calls.json`, `went-without.json` and, when
the tests ran, `baseline.log`. calls.json is `{calls: "v1", model, service,
made, each, passes, files_sent}`: `each` has one entry per call, with the
pass it served and its tokens, and `passes` (0.2.0) one entry per pass, with
the files it was shown, whether it answered, and why not.
