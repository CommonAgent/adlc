# spec-writer 0.6.3: run.reply names a member the job prints

Date: 2026-10-31.

Technical debt 657. spec-writer 0.6.2 drafted consonant-ledger
(ab_c2add1d21b685b80aa) and consonant-meter (ab_5f3651347f159dc723) on dev
with run.reply `"json:consonant-count-report.md"`. That is in the package
maker's form, so 0.6.2's check (debt 652) let it through, but it is the name
of the report the job files, not a member of what its command prints. The code
writer's scripts printed `{"code":0,"reply":"..."}`. On the host each job
exited 0 with its report made, the host's reading of `json:<member>` gave an
empty reply, and the host recorded the job as stopped and told the sender
"I could not finish this job. The work was cut short before the end".
Conformance came back inconclusive.

How the host decides (agents/image/one-message.mjs, the same in the fleet's
supervisor.mjs): `replyOf` reads `json:<member>` as that member of the one
JSON object the whole output is (a string as it is, missing or null as
nothing, anything else as text; output that is not one object gives nothing).
`answerOf` puts a named answer piece and the answer file before it and trims.
An empty answer is `stopped` when pieces were filed (the "cut short" words)
and `no answer` when none were, whatever the exit code.

The fix:

- scripts/run-reply.mjs: `PRINTED_MEMBER` (`reply`, the member every house
  script prints), `printedMembers(job)` (`reply`, plus any plain name the
  job's instructions put in backticks; a file name never is one), and
  `runReplyUnprinted(spec)`, a finding naming the job. `fitRunReply` now also
  writes a `json:<member>` the command does not print as `json:reply`, and the
  note says which job, what the draft said, what it is now, and why. A member
  after the wrong word (`text:counts`) is kept only when the job prints it;
  otherwise it is `json:reply` too.
- check-spec.mjs reports `runReplyUnprinted` beside the package maker's rule.
- draft.mjs's instruction tells the model to write `json:reply` or `stdout`.
- rules.md says the same.

The other end is test-writer 0.6.5's standard printed-reply check, which runs
each job's command as the host does, so a script and a run.reply that disagree
fail at Test or Code rather than at Conformance.

## Tests

test/run-reply-printed.test.mjs, 7 tests, written first and failing. The 0.6.2
fixture in test/run-reply.test.mjs now carries instructions saying the
command prints `counts`, so its cases mean what they meant, and
`json:counts.total` (not a plain member name) left its list of values kept as
they are. 215 tests, 214 pass, 1 skipped.

## Who held the step

The harness (Claude Code), tests first, then the script.

## On dev

- Packed by the package maker on the dev fleet host from adlc 0d5180a:
  sha256 9a07eaea3fa11c1052cbe1bc9f9e421486aad010f5a5447249169e0ecabdb144.
- Installed by the deployment manager from deploy request
  dr_f_TLzFfQXy_nvafkJZBd7f4B, approved for the platform account, with the
  settings 0.6.2 ran on (MODEL_PROTOCOL gemini, MODEL_NAME gemini-3.8-flash).
