# solution-architect 0.3.1: a spending limit the build settled is never said to be asked

Date: 2026-10-31.

## Why

The dev proof of 0.3.0 (build-0.3.0.md, On dev) delivered a finished record
with the build's spending limit, and its reply still said "took out a
spending limit the statement did not state, and asked for it". The model had
filled a limit in, code took it out to ask it, and then the build's settled
limit was used. Nothing was asked, so the reply said something untrue.

## What changed

name.mjs: where the build settled `limit-cost`, the note says the limit was
taken out "and used the one <who> settled".

## Tests

test/settled-answers.test.mjs gains one test, written first and failing.
129 tests, 128 pass, 1 skipped.

## Who held each step

The harness (Claude Code) stood in for the test and code steps, the test
first.
