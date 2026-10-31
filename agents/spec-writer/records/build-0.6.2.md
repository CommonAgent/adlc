# spec-writer 0.6.2: run.reply is always one the package maker takes

Date: 2026-10-31.

Technical debt 652. spec-writer 0.6.1 drafted a job whose `run.reply` was
`"text:counts"` for build ab_481ac696b24d8cf8fd (vowel-scale 0.1.0, dev).
Nothing before the package step checks that line: after the build was sent
back to Test (debt 636), the test writer revised its suite, the code writer
passed it, the sandbox passed it, and then the package maker refused to pack
it ("job count-vowels: run.reply is 'stdout' or 'json:<member>'; bad:
'text:counts'"). There is no action that sends a build back from Package to
the spec, so it could only be stopped. Other builds from the same version
wrote `"json:reply"`.

Fixed the way debt 648 was (0.6.1, job_seconds):

- package-maker/build.py: RUN_REPLY_STDOUT = "stdout" and RUN_REPLY_MEMBER =
  "json:", and run_reply_ok, read by the run check; behaviour and words
  unchanged.
- scripts/run-reply.mjs: the same two words, held to build.py's by
  test/run-reply.test.mjs; runReplyProblems in the package maker's words,
  naming the job; fitRunReply corrects a value outside the rule. One that
  names a member after the wrong word (`text:counts`) replies with that member
  (`json:counts`); anything else (`text`, `json:`, a number, nothing) replies
  with what the command prints (`stdout`). The note says which job, what the
  draft said, and what it is now.
- draft.mjs fits every draft before the check, after job_seconds, and puts
  the note in the reply; check-spec reports a value outside the rule;
  builds.mjs, where the builder is not on the host, refuses one and keeps no
  files, so the spec stops before the person approves it.
- plugin.json, three SKILL.md files and rules.md list and say the same.

The route back from Package to the spec is not built here: agent-builds.ts
belongs to another change today, and with the draft corrected before the
person approves it, this spec never reaches Package carrying the line.

## Tests

test/run-reply.test.mjs, 6 tests, written first and failing. 208 tests, 207
pass, 1 skipped.

## Who held the step

The harness (Claude Code), tests first, then the script.
