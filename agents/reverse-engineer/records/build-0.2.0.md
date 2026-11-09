# reverse-engineer 0.2.0: an as-built record a rebuild can work from

Date: 2026-11-09. A round trip reverse engineered a real agent with 0.1.0,
rebuilt it from the as-built record, and ran the original's tests on the
rebuild: none passed. The record was accurate, but it left out what a
rebuild needs most: the output file's shape and format id, the exported
functions the tests import, the exact pattern and reply words other
components match, the order text sources are tried in and the limits. The
model had drafted the whole codebase in one short answer. The baseline never
ran, because the agent had no package.json. Two runs on the same code gave 10
and 5 behaviors of different sizes.

## What changed

- **What can be read by rule is read by rule** (scripts/surface.mjs, on a
  small lexer in scripts/js-source.mjs that keeps strings, templates, regular
  expressions and comments apart from code). For JavaScript and TypeScript:
  each module's exports, with parameters, async or not, what its own body
  throws or rejects with, and a literal constant's value; who imports each
  one; the files that start as commands and the flags they read; each file
  the code writes, with the JSON Schema its value shows (field names, types,
  the fields always written, constants such as a format id); the regular
  expressions as written; the literal constants; and every import that leaves
  the codebase's folder.
- **Interfaces.** The files written, the exported functions and classes and
  the commands are interfaces read by rule, each with its evidence, and
  interfaces.json adds the exported constants, every flag, the environment
  variables and the declared run-config settings. The model describes them
  (what a function returns, what a file is for) and fills only the parts of a
  schema the rule left unknown; a drafted field the code never writes, and a
  constant that is not a literal in the code, are taken out as gaps.
- **Behaviors.** Each behavior has a kind from a fixed list (entry, fetch,
  write, state, check, parse, compute, compose, in that order of precedence),
  an anchor, the patterns and words other components depend on as quotes, and
  its order, limit, header and default rules. Every quote is checked against
  the code byte for byte and dropped as a gap when it is not there. The
  regular expressions and constants a behavior's lines use are attached by
  rule.
- **Granularity.** One behavior per anchor: each exported function or class
  another file imports, each export of the main module, each command. The
  rule is in references/the-as-built-record.md, rules.md and the prompt. The
  record check holds back a behavior with another kind, a second behavior for
  the same anchor, and one anchored to a function the rule does not count;
  an anchor with no behavior is a gap, and behaviors are numbered in anchor
  order, so the same code gives the same behaviors and ids.
- **Drafting in passes.** On adoption: one pass for the architecture, the
  interfaces and the gaps; behavior passes of a few source files each (80,000
  characters at most, 12 passes at most, four at a time); and a pass for what
  each test covers. Each pass is recorded in calls.json. A pass that fails
  leaves its part as a gap and the others stand. Drift stays one pass.
- **Baseline.** With no package.json test script, the `node:test` files are
  run with `node --test`, and the record says how the command was found and
  that the code was read and run. An import that reaches outside the
  codebase's folder (such as `../../shared/x.mjs`) is a gap of the new kind
  `outside-the-codebase`.

## Formats

Every change is additive: new fields on behaviors, interfaces,
tests-and-gaps and record counts, a new gap kind, and passes in calls.json.
Nothing was renamed or removed, and the gap fields (`about`, `why`) are as
they were. No format id changed, because a reader of 0.1.0's files reads
these unchanged; references/the-as-built-record.md lists each addition. No
standard changed: stages.json already lets Reverse engineering hand back
schemas, APIs, commands and file formats in interfaces.

## Tests

63 pass (and one skipped that reads kept examples, of which there are none).
New: surface.test.mjs (the lexer and what is read by rule), behaviors.test.mjs
(kinds, anchors, quotes, rules, drafted schemas, behavior passes) and
news-agent.test.mjs, on a small fixture agent with no package.json: an output
file with a format id, an exported async function its test imports, a
stop-notice pattern, a fallback order, a cap, request headers and a test that
imports `../../shared`. The existing node-app and drift answers were brought
to the new granularity and kinds. No test calls a model.

## Who held each step

The harness (Claude Code) wrote the scripts, the tests and the docs, at the
owner's instruction; the spec writer, test writer and code writer were not
used.
