# security-reviewer 0.3.2: the hn-digest case is pinned

Date: 2026-11-11.

## Why

In build b_6e496a709479 (hn-digest) this agent refused the code, which read
settings nothing declared and carried the Hacker News address written into
it. With architecture standard 1.1.0 the architect's record names
`hacker-news`, bound to the service itself, and the spec writer's Design
declares it with its address as the setting `HACKER_NEWS_ADDRESS`. The
review was checked against that case and needs no change: the service is in
both the record and the declaration, the script's read of the setting is a
declared reach (case a), and the spending limit is read from the record.

## What changed (from 0.3.1)

- test/hn-digest.test.mjs: two tests, on the record and the two declaration
  files the solution architect and the spec writer make for the case (the
  spec writer's test/fixtures/hn-digest). A script that reads the address
  setting passes, with the record given, the reach declared and the ceiling
  of text-reasoning per day listed; a script that writes the address down is
  warned about, naming the file and the address.

No script changed. 125 tests, 124 pass, 1 skipped. Written by the harness
(Claude Code) directly; no model was run.
