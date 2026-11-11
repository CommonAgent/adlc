# spec-writer 0.10.2: an offering's inputs and outputs reach the spec and the files

Date: 2026-11-11.

## Why

In build b_393a1f45c7a4 (hn-digest) Jeff answered at Requirements: "The
input is named topic: plain text, one subject such as databases. The output
is named digest: Markdown text in the job reply, a header 'Topic digest,
<read_at>', then '## Stories' with one list item per story". The words named
nothing the spec had, so `namedTargets` opened no part of it and no edit to
its pieces could land. The approved spec had no inputs and no outputs, the
Design wrote `"inputs": []` and `"outputs": []` on the offering and asked
nothing, and the code critic refused the script, which delivered a digest no
output declared.

## What changed (from 0.10.1)

- standards/spec.schema.json 1.2.0 (additive): a feature's Data may say
  whether it is `required` and who gives it (`given_by`). spec-v1 already had
  the place for an offering's pieces, a feature's `inputs` and `outputs`;
  these two facts had none. standards-pins.json re-pins it.
- scripts/spec.mjs: the spec step is told to write each feature's inputs and
  outputs, each with its name, kind, shape in words and, for an input,
  whether it is required and who gives it, and in a revision to set the
  feature's pieces where the words name a piece.
- scripts/revise.mjs: words that name an input or an output the spec does
  not have ("the input is named topic") open the pieces of every feature,
  and nothing else of them.
- scripts/structure.mjs: the Design declares each piece the spec carries
  with its about, `required` and `given_by`, and the about is the spec's,
  which the model does not write again (unless it is Markdown whose about
  sketches no convention). An offering the spec gives no output, or never
  says the input of, is asked (`outputs-<offering>`, `inputs-<offering>`);
  an inputs list the spec states empty says the job takes nothing.
- scripts/draft.mjs: those questions go in blanks, so in still-open.md, and
  an earlier draft's words are not carried over what the spec fixes.
- references/what-a-good-spec-carries.md, the write-a-spec and
  draft-the-spec skills and README.md say the same.
- test/pieces-from-words.test.mjs: four tests on the case. Three tests in
  test/structure.test.mjs now expect a piece's about to be the spec's.

326 tests, 325 pass, 1 skipped. The standards' 168 pass. Written by the
harness (Claude Code) directly; no model was run.
