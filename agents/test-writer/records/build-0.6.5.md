# test-writer 0.6.5: every suite runs each job's command as the host does

Date: 2026-10-31.

Technical debt 657. consonant-ledger (ab_c2add1d21b685b80aa) and
consonant-meter (ab_5f3651347f159dc723) on dev carried run.reply
`"json:consonant-count-report.md"` while their scripts printed
`{"code":0,"reply":"..."}`. The suites tested the scripts' functions and
never ran a command line, and the sandbox trial runs only the suite, so the
mismatch passed Test, Code and Package. On the host every job made its report
and still ended "cut short", and Conformance was inconclusive.

A fourth standard file, test/printed-reply.test.mjs, copied whole from
references/ into every suite like the other three. For each job that names a
command (agent-runtime-requirements.json `run`, or a spec.json's jobs) it
runs the command once as the host does: placeholders filled the host's way,
an empty message in the message file, no files, the model settings left out,
a script the packed layout puts under skills/<job>/scripts/ run from scripts/.
It reads the reply the host's way (one-message.mjs `replyOf`, then `answerOf`:
a named answer piece, the answer file, then the reply, trimmed) and fails when
that is empty, naming the job, its run.reply and what was printed, and saying
that the host would record the job as stopped and tell the sender the work was
cut short. Its tests run when the file is run, as node --test runs each suite
file; importing from it adds none. The model is told not to write it.

write-suite.mjs adds it (`REPLY_TEST`, `replyTestAt`, among `STANDARD_TESTS`
and the stand-in runs) and refuses to write a suite without its master copy;
plugin.json and both SKILL.md files list it; README.md and rules.md say why.

A blanked script prints nothing, so the check also notices a script going
missing. In the run beside the agent's own files it reaches a script (it
starts a program), so a failure there is not named as one no script can mend.

## Tests

test/printed-reply.test.mjs, 9 tests, written first and failing: its reading
agrees with one-message.mjs's `replyOf` and `answerOf` case by case, the
command is filled the host's way, it passes a script that prints the member
run.reply names, fails the consonant-ledger case and an empty script, and the
test writer carries and adds it. 175 tests, 174 pass, 1 skipped.

## Who held the step

The harness (Claude Code), tests first, then the script.
