# spec-writer 0.8.2: a job's command names its script the way the host runs it

Date: 2026-11-09.

## Why

In the second round trip on hn-reader the spec's command ran
`scripts/read-top-stories.mjs`, a bare path copied from the as-built record,
which names the codebase's own files. The host starts a command from its own
home folder, so the test writer's standard printed-reply check could not find
the script, and the coding harness stopped on a conflict it could not fix. The
original agent's command is
`{home}/{package}/skills/read-the-top-stories/scripts/read-top-stories.mjs`.
Asked in words with Send back to Requirements, the model left it as it was.

## What changed (from 0.8.1)

- scripts/given.mjs: `fitCommands` writes every bare `scripts/...` path in a
  job's command as `{home}/{package}/skills/<job>/scripts/...` after the last
  go, with a note. `scriptOfWord` reads either form as the script it names, so
  the scripts check of 0.8.1 also covers commands in the packaged form.
- scripts/check-spec.mjs: a bare script path in a command is a finding while
  the model still has the draft.
- scripts/draft.mjs: the command fit runs before the given's fit, and what the
  two fits settled is not reported again as a finding.
- Three fixtures that ran a script without listing it now list it.
- test/scripts-named.test.mjs: one more test. On the round trip's own sixth
  draft the fit writes the command as the host runs it.

267 tests, 266 pass, 1 skipped. Written by the harness (Claude Code) directly;
no model was run.
