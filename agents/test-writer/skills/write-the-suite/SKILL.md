---
name: write-the-suite
description: once the declaration is recorded, to write the tests
---

# Write the suite

Part of test-writer. once the declaration is recorded, to write the tests

## When to use this

once the declaration is recorded, to write the tests

## What a good result looks like

Test files that open by saying what they pin, name their tests as sentences, reach every script the spec names, depend on nothing outside node, and fail against empty stand-ins for those scripts, with the standard format check test/delivered-formats.test.mjs among them and called by every test that fills a job folder; beside them, what could not be tested and why.

## When it comes back empty

If the service will not answer, or answers with no test file, nothing is written and the reply says which. A suite that still fails its own check after a second go is delivered as it is, with the finding said.

## How to do it

Nothing in this folder is run on its own; the offering names the one command that does the whole job, and this skill only explains what that command does for this step.

write-suite.mjs builds one request carrying, in this order: the instruction, the spec, the command lines the harness runs, the reference, one whole suite that holds a package which runs today, the spec that suite tests, and the files the change depends on, whole, each with the names it exports (the attached ones, and every shared copy the spec names that this package carries). It sends that to the text-reasoning model, through the four settings the install places, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, read on every run through the shared model caller (scripts/model-caller.mjs) (the package names no model and no address, and with a setting missing the job is refused in words), and reads the files out of the answer. Two checks before the suite is taken. Static: every file opens with a comment, names its tests as sentences, reaches the scripts and uses node:test alone; every script the spec names is reached by some file; no file imports a name that a file the change depends on does not export; there are at least two tests per script; and, when the spec declares outputs, some test calls checkDelivered from ./delivered-formats.test.mjs, the standard format check, which the model is told never to write. Then the suite, with that check copied in from references/delivered-formats.test.mjs,  is run against empty stand-ins for every script and must fail. Where either check finds something the same request goes once more with the findings appended, and never a third time. It writes the files under the work folder, the format check among them unless the suite being added to has it, and records/<job>/suite.json (which lists the check as generated), records/<job>/calls.json.

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
