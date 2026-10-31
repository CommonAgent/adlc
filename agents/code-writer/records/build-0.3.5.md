# code-writer 0.3.5: a conflict reaches the build that asked

Date: 2026-10-31.

Technical debt 636. When the code writer stopped on a test that cannot pass
without breaking what the spec says, it wrote records/conflict.md and
delivered nothing, as its rules say. The host's delivery check then refused
a folder with no scripts, so the build saw only "no scripts were delivered"
(vowel-scale, ab_481ac696b24d8cf8fd) and the conflict's words never left the
code writer's host. Build an agent now offers "Send back to Test" at Code,
and needs those words to show the person and to send the test writer.

- pieces.mjs: a job that stopped on a conflict files records/conflict.md as
  the one piece, out/conflict.md (text/markdown), and no script. A job not
  done without a conflict still files nothing.
- verify.mjs: the host's check takes a conflict with no scripts, says it is
  one, and runs nothing; an empty conflict, or one with scripts beside it, is
  refused.
- report.mjs: the reply says conflict.md goes with it and that Send back to
  Test asks the test writer to revise the tests it names.
- rules.md and the write-the-scripts skill: on a conflict, write the account,
  report and run pieces.mjs.
- references/agents-md-template.md: rule 3 and a new section, "When a test
  is wrong", tell a coding agent holding Code on a pull request exactly what
  to do: write records/conflict.md naming the test file, the test's name, its
  line and the line of the agent's files it contradicts; commit it alone and
  push it to the branch; stop until the revised tests come back as a new
  commit that also updates build.lock.json and removes records/conflict.md.
- The descriptor declares the conflict as an output.

## Tests

test/conflict-delivery.test.mjs, 5 tests, written first and failing. 106
tests, 105 pass, 1 skipped.

## Who held the step

The harness (Claude Code), tests first, then the scripts and the texts.
