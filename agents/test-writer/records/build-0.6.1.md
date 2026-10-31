# test-writer 0.6.1: a delivered piece is read by whole lines

Date: 2026-10-31.

## Why

Proof build ab_6d0a79ba51025b1beb (vowel-tally 0.1.0, test-writer 0.6.0 on
dev). The suite worked all 22 of its values twice and every one held (for
example "The quiet bear.": a 1, e 3, i 1, o 0, u 1, total 6), so debt 646's
fix did what it was for. Code still stopped, on a different defect in the
suite: "the delivered markdown tally carries the total and counts in order a,
e, i, o, u" cut the `## Counts` block out of the piece and compared
`countsBlock.indexOf(letter)` for each pair of vowels. The required heading
"## Counts" holds o and u before any i, so no piece that keeps the spec can
pass it. The reference code writer passed 25 of 26 and stopped on the
conflict (its record 01a19250-5d4d-7000-9cca-7bcc62d020d1/conflict.md).

## What changed

- write-suite.mjs: letterSearchFindings names, by file and line, a search
  with indexOf, lastIndexOf, includes or search for one letter: a one-letter
  literal, an element of a list of single letters, or a variable that runs over
  one. A one-character separator such as "\n" or "," is not a letter. It runs
  in the static check, so the suite goes back once with the finding. The
  instruction says to read a delivered piece by whole lines.
- rules.md and the reference say the same.

Over real suites it names both lines of that test in ab_6d0a79ba51025b1beb's
suite, and nothing in vowel-counter's (ab_fa800bf8ce54a325ee) or in the worked
example.

## Tests

test/whole-lines.test.mjs, 4 tests, written first and failing. 149 tests, 148
pass, 1 skipped.

## Who held each step

The harness (Claude Code) stood in for the test and code steps, the tests
first.
