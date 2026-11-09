# code-writer 0.4.0: the hand-off carries the spec

Date: 2026-11-09.

stages.json 1.6.0 gives the Code stage the spec (spec-v1,
standards/spec.schema.json), the agent's own files and the suite. Until now the
"spec" was the agent's own declaration files, so a build folder carried those
and the suite, and nothing else. On a round trip that rebuilt a news reader
from its as-built record, the record carried the runner's stop pattern, where
page metadata is read from, the refusal's words and the output's schema
exactly; a file like that, when it came with a hand-off, went under
prototype/ as a loose file, and AGENTS.md never said to read it.

- scripts/handoff.mjs: the spec comes as a `--file` like everything else and is
  found by content (`specAmong`): spec.json is the JSON whose format is
  spec-v1 (`isSpecV1Text`), spec.md its rendering for a person, a Markdown
  file named spec.md once the process runner's prefixes are off, or one
  carrying the product's name and every acceptance scenario's id
  (`looksLikeSpecMd`). Both are taken out of the loose files that would have
  been the prototype and laid at the build folder's top, byte for byte and
  read-only; the lock pins them like every file outside scripts/, so the
  fence (the local check, the gate and the archive's own lock check) keeps
  them unchanged. workspace.json records which came (`spec`), the reply and
  the piece's about say so, and the piece is produced from the spec too.
- references/agents-md-template.md: a part, "Read the spec first", between two
  marker lines. With the spec it is kept (`withSpecPart`), naming spec.md, or
  spec.json when only it came: the requirements, the exact words, patterns
  and numbers to write into the scripts as they stand, the interfaces that
  must be kept, the acceptance scenarios the tests are named by; then the
  agent's files and the suite; never change the spec; a test that cannot pass
  without breaking it is a conflict named by the requirement's or scenario's
  id. With no spec it is taken out whole, and AGENTS.md is the same as before.
- The descriptor: the hand-off takes the spec as an input of its own,
  optional. rules.md, the README and the hand-off-the-code,
  lay-out-the-build-folder and write-the-house-rules skills say the same.

Not changed: the write-the-scripts offering's own workspace (workspace.mjs,
from loose files) still lays a spec that comes loose under prototype/; one
that comes inside a build folder is laid out with it, pinned.

## Tests

test/handoff-spec.test.mjs, 6 tests, model-free, on a made-up spec
(test/fixtures/spec-v1/: a pattern, a limit, a wording, a refusal, a kept
function, a kept file with a schema) and its rendering: finding the spec by
content; the spec at the folder's top, pinned and never under prototype/;
AGENTS.md with both, and with spec.json alone; a hand-off with no spec as
before; the local check stopping on a changed spec.json by name, and an
archive whose spec differs from its lock refused; the spec passed with
`--file` to the command. 119 tests, 118 pass, 1 skipped.

## Who held the step

The harness (Claude Code), tests beside the script.
