# code-critic 0.4.0: every setting a script reads is declared

Date: 2026-11-09.

## Why

A round trip rebuilt a Hacker News reader from its as-built record. The
rebuild read the Hacker News address from `HACKER_NEWS_API`, which none of
its files declared, so once deployed it reached nothing. This critic, 0.3.1,
reviewed that change and found nothing: it checked only a variable whose
name looks like a credential. Round trip report, recommendation 8.

## What changed (from 0.3.1)

- scripts/house-rules.mjs: a sixth house rule, `undeclared-setting`, run with
  no model on every review (`undeclaredSettingFindings`). Each variable a
  script reads (`process.env.X`, `process.env["X"]`, `env.X` in a function
  handed process.env, names taken apart from either, Python's `os.environ`
  and `os.getenv`) that nothing declares is a finding with its file, its
  line and its name. Declared means a system's `env` or `settings` in
  agent-runtime-requirements.json, the model system's settings when one is
  declared, a run config setting in agent-descriptor.json, a spec.json handed
  over with the package, a `NAME=` on a command line in a SKILL.md, a name a
  script of the package hands a program it starts, or a name the host places
  (`HOST_PLACED`, with where each is set, and AGENT_DIRECTORY_, BINARY_ and
  CEILING_ for each declared directory, binary and system). The entry point
  of a script that no run command and no SKILL.md starts is left out, since
  it runs only when somebody starts that script as a step. A credential no
  system binds stays a `claims-match-code` finding.
- references/the-house-rules.md, rules.md, README, the check-the-house-rules
  and review-a-change skills, the descriptor's step line and the model's
  rule list in scripts/review.mjs: the sixth rule.

On the rebuild's package the rule finds `HACKER_NEWS_API` at the line that
reads it, and ten more findings for five variables nothing places (`JOB_DIR`,
`RECORDS`, `WORK_DIR`, `RUN_CONTEXT`, `MESSAGE`).

## What stays

Its name, price, offerings, inputs, outputs, records, the model call and the
other house rules.

## Tests

`test/undeclared-settings.test.mjs` (9), small synthetic packages, no model.
The package's suite: 100 tests, 99 pass, 1 skipped (as before).

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason 0.3.0 records.
