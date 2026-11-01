---
name: write-the-suite
description: once the declaration is recorded, to write the tests
---

# Write the suite

Part of test-writer. once the declaration is recorded, to write the tests

## When to use this

once the declaration is recorded, to write the tests

## What a good result looks like

Test files that open by saying what they pin, name their tests as sentences, reach every script the spec names, depend on nothing outside node, and fail against empty stand-ins for those scripts, with the standard format check test/delivered-formats.test.mjs among them and called by every test that fills a job folder, and the standard records check test/records-per-job.test.mjs among them and called by a test that runs two jobs with one records folder when the spec keeps a record per job, and the standard worked-values check test/worked-values.test.mjs among them, with every expected value a rule in the spec decides worked twice, as a literal and as a computation over the same input, and the two agreeing, and the standard printed-reply check test/printed-reply.test.mjs among them, which runs each job's command as the host does with an empty message and fails when what it prints does not give the reply run.reply names (technical debt 657); beside them, what could not be tested and why.

## When it comes back empty

If the service will not answer, or answers with no test file, nothing is written and the reply says which. A suite that still fails its own check after a second go is delivered as it is, with the finding said.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

write-suite.mjs builds one request carrying, in this order: the instruction, the spec, the agent's own files as they stand (agent-descriptor.json, agent-runtime-requirements.json and plugin.json, whole, with the word that a test on the declaration asserts only what they carry), the command lines the harness runs, the reference, one whole suite that holds a package which runs today, the spec that suite tests, and the files the change depends on, whole, each with the names it exports (the attached ones, and every shared copy the spec names that this package carries). It sends that to the text-reasoning model, through the four settings the install places, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, read on every run through the shared model caller (scripts/model-caller.mjs) (the package names no model and no address, and with a setting missing the job is refused in words), and reads the files out of the answer. Two checks before the suite is taken. Static: every file opens with a comment, names its tests as sentences, reaches the scripts and uses node:test alone; every script the spec names is reached by some file; no file imports a name that a file the change depends on does not export; there are at least two tests per script; and, when the spec declares outputs, some test calls checkDelivered from ./delivered-formats.test.mjs, the standard format check, which the model is told never to write; and, when the spec keeps a record per job (a file pattern that starts with the job's folder, such as */went-without.json), some test calls checkRecordsPerJob from ./records-per-job.test.mjs after two jobs that shared one records folder, the standard records check, which the model is likewise told never to write; and some test works a value with worked(value, () => computation, what) from ./worked-values.test.mjs, the standard worked-values check, as a constant at the top of its file and never inside a test, with a computation that is more than a literal, unless the model's notes say on a line starting "No worked values:" why no expected value is decided by a rule. Then the suite, with the four checks copied in from references/, is run against empty stand-ins for every script and must fail; and it is run once more against the agent's own files with every script stood in by a module that exports the names the suite imports and does nothing, where a test that touches no script must pass, since no script can change what it reads, and where every worked value is checked against its own computation and each that disagrees is named with both values (technical debt 646). Where either check finds something the same request goes once more with the findings appended, and never a third time. It writes the files under the work folder, the four checks among them unless the suite being added to has the same bytes, and records/<job>/suite.json (which lists them as generated), records/<job>/calls.json.

Given EXISTING, a folder holding the suite the package already has, the request carries that suite whole after the worked example and says to add only new files; a file answered under a kept name is a finding, reach and count are judged over the suite as it will stand, and the new files alone must fail against stand-ins. The kept files are written into the work folder beside the new ones so the check runs the whole suite, and suite.json lists them as kept. Given ASKED_TEXT, the message's words go in before the spec. A spec naming more than three scripts is asked for in parts of three, each told its own scripts and the names earlier parts took, each checked on its own with the same two goes; a part cut at the output limit is asked again one script at a time; and the whole suite is run against stand-ins once more at the end.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/write-suite.mjs
- scripts/model-caller.mjs
- scripts/check-suite.mjs
- scripts/declared.mjs
- scripts/went-without.mjs
- scripts/agent-folder.mjs

## References

- references/what-a-good-suite-carries.md
- references/a-suite-that-works.test.mjs
- references/the-spec-it-tests.json
- references/delivered-formats.test.mjs
- references/records-per-job.test.mjs
- references/worked-values.test.mjs
- references/printed-reply.test.mjs
