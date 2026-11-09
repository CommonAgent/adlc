# reverse-engineer 0.3.0: every fact a rebuild needs, checked by code

Date: 2026-11-09. A round trip on a real agent (a Hacker News reader) with
0.2.0: the rebuild lost things the record never captured. The reply sentence
the agent prints, the extra page metadata sources in its code (JSON-LD
@graph, citation_* and dc.* tags), the label a person reads in its
descriptor, two exported constants (recorded as constants but not as
interfaces), which command flags are required, and the only values a field
may take (text_from is "article", "post" or "comments"). Nothing checked the
record for completeness.

Two rules shaped the change. Code copies facts and the model only describes
them. Each output is checked by code. The record now carries every fact a
rebuild needs, found by code, each pointing at a file and line, and checks
that it does.

## What changed

- **Constants as interfaces.** Each exported constant is an interface of kind
  `constant`, with its value as JSON where the literal can be read
  (js-source.mjs `literalValue`: strings, numbers, lists and objects of them,
  templates of constants, arithmetic on number constants, `new Set([...])`,
  names of consts). A value worked out by code is `null` with a gap.
- **Declarations as interfaces.** Every name and value the agent declares in
  agent-descriptor.json, agent-runtime-requirements.json, plugin.json and its
  SKILL.md front matter is an interface of kind `declaration`, with its
  value, `declared_in` (such as `agent-descriptor.json
  offerings[0].outputs[1].name`) and its line (scripts/declarations.mjs).
- **Required flags.** Each command interface says which flags it cannot run
  without and which it can, each with its evidence, read by rule from the
  argument loop and the `if` that refuses without one (scripts/flags.mjs).
  What the rule cannot settle the draft is asked, evidence-checked; what
  neither settles is a gap.
- **Allowed values.** A file interface's schema carries `enum` on each field
  the code only writes from fixed literals, and the interface gains `values`
  by JSON pointer and `values_evidence`. The values are read from the object
  literals shaped like the one the field is in, following a const, a ternary,
  or a `let` that is only ever given literals.
- **strings.json**, a new part (`as-built-strings-v1`): every string a person
  reads, every key other code or data depends on (no space, a letter, one of
  `_ . : @`, no `/`: `citation_title`, `dc.title`, `og:title`, `@graph`) and
  every regular expression in the scripts, exactly as written, by the lexer,
  no model.
- **The original tests, carried.** Each test file and each file in a test
  folder, byte for byte, under tests/; each file a test imports from outside
  the codebase, and every file those import in turn inside the repository,
  at the record's commit under support/ (scripts/carried.mjs). The new
  command-line option `--repository-root <folder>` names the repository's
  top; without it the top of the git checkout is used. tests-and-gaps.json
  gains `carried` and `support`.
- **The completeness check** (record.mjs `completeness`): every export, file
  written, command's required flags, declaration and string is in the
  record; record.json says so under `counts.completeness`, and each thing
  missing is a gap of the new kind `incomplete`.
- Two fixes found on the way: a line break inside a template no longer ends
  a statement (a multi-line template constant was read short), and two
  places that write the same file give one schema that allows both.

## Formats

Every change is additive: new interface kinds and fields, a new part, new
fields on tests-and-gaps and record, a new gap kind, new files in the
record's folder. Nothing was renamed or removed, and every format id stays
`v1`; references/the-as-built-record.md lists each addition. The interfaces
follow standards/spec.schema.json 1.1.0 (constant, declaration,
required_flags, values), which a spec writer turns the record into.

## On the round-trip agent

Run locally with no model over the original agent, the completeness check
found nothing missing: 29 exports, 3 files written, 1 command, 86
declarations and 144 strings, all held. The strings are 13 words, 35
templates, 51 keys (the page metadata sources among them: `@graph`,
`citation_title`, `dc.title`, `og:title`, `article:published_time` and the
rest) and 45 patterns. Its one command has no required flag
(each of its five flags is optional, with the line that shows it). Its test
imports a file from beyond the copied repository's top, so that import is a
gap and nothing is carried for it. With a stand-in draft that names the
stories' fields, text_from gets the values null, "article", "post" and
"comments", read by rule.

## Tests

71 pass (and one skipped that reads kept examples, of which there are none).
New: complete.test.mjs, on a fixture repository (test/fixtures/repo-agent)
with an agent folder and a shared helper outside it whose imports go three
levels down to a package. The existing tests now expect the strings part,
the carried pieces, and the exports of every module. No test calls a model.

## Who held each step

The harness (Claude Code) wrote the scripts, the tests and the docs, at the
owner's instruction; the spec writer, test writer and code writer were not
used.
