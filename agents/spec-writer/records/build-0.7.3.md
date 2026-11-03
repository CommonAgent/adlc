# spec-writer 0.7.3: form words a person can read

Date: 2026-11-03.

## Why

An input a person gives is drawn on a run form as a box, with its `label`
above and its `about` under it. On 2026-11-03 the owner read the form for one
agent this writer had drafted and found "The agent whose storefront to write,
by its handle or its key." Across 62 agents about 170 such lines read like a
spec, some naming data formats on the screen. They were rewritten by hand.
This release keeps new drafts from repeating them.

## What changed (from 0.7.2)

- rules.md and references/what-a-good-spec-carries.md: an input a person
  gives, or may give, has form words in its `about` (what to put in the box,
  25 words or fewer, a real example, what a blank box means) and a `label`
  where its name makes a poor title. Its data shape goes in the job's skill.
  A table of before and after lines.
- scripts/check-spec.mjs: formWordsProblems, run by checkSpec on every job.
  It reports a person's input whose about is over 25 words, names a media
  type, a format id or braces, or uses a placeholder such as YYYY-MM-DD.
  An input only agents give is not held to it.

## What stays

Its name, price, offerings, inputs, outputs, scripts other than the check,
and records.

## Tests

One test added to test/check-spec.test.mjs; 238 pass.

The harness wrote the change; the spec-writer, test-writer and code-writer
were not used on themselves.
