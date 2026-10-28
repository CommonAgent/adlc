# doc-writer 0.1.1: files named by the name they were sent under

Date: 2026-10-27.

## Why

Found proving 0.1.0 on dev against quiz-maker. A host stages an attached
file as `<n>-<8 characters>-<name>` (the fleet supervisor's index in front of
the adapter's own prefix), so `quiz.json` reached the job as
`6-WTvYlXog-quiz.json`. 0.1.0 named every source by that staged name and
matched records to jobs and to declared record patterns by it, so the
quiz-maker job's own `quiz.json` was not recognised as a `make-a-quiz`
record and the documentation said the job had no example.

## What changed

- `givenName` in scripts/given.mjs reads the name a file was sent under from
  a staged name, taking off every `<n>-<8 characters>-` prefix as the code
  writer's bareName and the code critic's plainName do (a process run adds
  one per hop). The documentation names, matches and lists each file by it,
  and given.json keeps the staged name beside it as `staged_as`.
- The documentation's `written_by` says 0.1.1.

## Tests

42 pass: two new run tests start the job with staged names, one prefix and
two, and check the example, the declared-record line, the Sources line and
the inventory,
and one new parts test holds `written_by` to the package version.

## Who held each step

The harness (Claude Code) wrote the change and the tests on the owner's
approval relayed by the coordinator; packaging, the deploy request and the
install go through the package maker, the platform account's deploy queue and
the deployment manager, on dev first.
