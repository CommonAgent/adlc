# test-writer 0.6.3: a value a rule decides is never pinned as a bare number

Date: 2026-10-31.

## Why

Technical debt 646, a gap in 0.6.0's fix. Proof build ab_481ac696b24d8cf8fd
(vowel-scale 0.1.0, test-writer 0.6.2 and spec-writer 0.6.1 on dev): the
spec came through with job_seconds 60 (debt 648's fix), and the suite worked
23 values twice, every one agreeing. One test wrote its counts straight into
its assertions instead: `assert.equal(result.counts.a, 3)`,
`assert.equal(result.counts.e, 1)`, `assert.equal(result.total, 4)` for
"Café façade rôle naïve", where the spec's rule gives a 4, e 3, total 7. The
static check asked only for some worked value in the suite, so that test was
never cross-checked, and the reference code writer stopped on it as a
conflict with 28 of 30 passing (its record
01a19292-22f3-7000-ab9d-f914a9961386/conflict.md, which says the literal was
not given to worked()).

## What changed

- write-suite.mjs: bareLiteralFindings names, one finding per file with its
  lines, each assert.equal, strictEqual, deepEqual or deepStrictEqual whose
  expected value is a number or an object or list holding one, and each
  assert.match whose pattern has a number written in it. What was got is left
  alone when its name says it is an exit status, a count of calls or attempts,
  or a length. It is held whenever the worked-values check goes into the
  suite, in a part too. The instruction says to assert against the worked
  constant.
- rules.md and the reference say the same.

Over the three dev suites it names the failing test's lines in
ab_481ac696b24d8cf8fd's, and in the other two only lines that pin counts
(`counts.a, 0`, `/^- a: 2$/m`, `/11/`).

## Tests

test/bare-literals.test.mjs, 5 tests, written first and failing. The
worked-values test's fixture asserts an empty sentence's count with
`assert.ok(!countVowels(""))`, as a bare 0 is now a finding. 158 tests, 157
pass, 1 skipped.

## Who held each step

The harness (Claude Code) stood in for the test and code steps, the tests
first.

## On dev

- Packed by the package maker on the dev fleet host from adlc efdb8ce: sha256
  99eaef5b01a55496c89ca5caa4abfd45c18908659f34f4b6071dc211910d3901.
- Installed by the deployment manager from deploy request
  dr_sxf3xaJuZm2pOeRNr0fQXeuG, approved by the platform account, same settings.
- Not yet proven by a build: platform@agentmesh.ai reached the dev limit of 12
  new agents for the day before the next build could start.
