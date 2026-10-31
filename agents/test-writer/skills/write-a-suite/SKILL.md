---
name: write-a-suite
description: when a spec exists and its scripts do not yet, and somebody wants the tests those scripts will have to pass
---

# Write a suite

Part of test-writer. when a spec exists and its scripts do not yet, and somebody wants the tests those scripts will have to pass

## When to use this

when a spec exists and its scripts do not yet, and somebody wants the tests those scripts will have to pass

## What this needs

- the spec (document, required)
- the suite it already has (text/javascript, optional)
- the files the change depends on (text/javascript, optional)
- what to add (text, optional)
- what the code step sent back (text, optional)

## What a good result looks like

A suite of test files that run under node's own runner and nothing else, one file per script or per package, each opening by saying what it pins and naming its tests as sentences, reaching every script the spec names; that fails against empty stand-ins for those scripts; and beside it, what no test could be written for and why.

## What it produces

- the suite (text/javascript, per task)
- what it could not test (text/markdown, per task)

## When it comes back empty

If no spec arrived, nothing is written and no model is woken: the reply says what a spec carries and asks for it. If the suite still passes against stand-ins after a second go, it is delivered with that said first, because a thin suite with its thin spot named is more use than none.

## How to do it

This job runs as one command, job.mjs, which the package names as the job's command: it finds the spec among the attached files by content, runs the four steps in order, files the pieces and prints the reply. No harness runs it and nothing is left to work out by hand. What follows says what that command does, step by step, so a reader can see it did the right thing.

When the message also carries test files (any attached file that imports node:test), they are the suite the package already has. job.mjs lays them out by their bytes beside the work folder, never on the job folder's mount, and passes them to the writing step as EXISTING with the message's own words as ASKED_TEXT: the writer then adds new files for what was asked and never rewrites a kept one, and only the new files are delivered. The files the change depends on are read as they are: any attached script that is not a test, and every shared copy the spec's build entry names that this package also carries (scripts/model-caller.mjs, scripts/went-without.mjs, scripts/agent-folder.mjs), go to the writer whole with the names each one exports, and the suite calls them as they are written. The check then refuses a test that imports a name such a file does not export. When the spec names more scripts than one answer holds, the writing step asks for the suite in parts of three scripts, each checked on its own.

When the message's first line begins "Revise the suite", the code step sent the suite back: a test it could not pass without breaking what the spec says, and a person who decided the test is wrong. job.mjs then needs the suite attached (it refuses in words without one) and passes REVISE=1 beside EXISTING and ASKED_TEXT. The writing step rewrites only the test files the message names, by file name or by a test's name, keeps every other file byte for byte, and refuses in words, with no model asked, when the message names none. Only the rewritten files are delivered, and the reply says which were revised and which kept.

Nothing in this package runs on its own, and nothing here is done by opening files and working out what to do next. Every message that reaches this agent is one job, and one command does the whole of it. The package is installed at ~/test-writer, so the scripts are always under ~/test-writer/skills/write-a-suite/scripts/.

Run these four commands in order, with these exact paths. JOB_DIR is the path on the message's `job folder: <absolute path>` line; SPEC is the folder job.mjs lays the attached agent's files out in (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and the SKILL.md files, found by content), or, where a spec.json came instead, its local path from the attachments block; WORK and RECORDS are the work and records directories this agent was installed with, each with this job's own folder under it.

1. SPEC=<the agent's folder, or the attached spec.json> RECORDS=<records folder> node ~/test-writer/skills/write-a-suite/scripts/declared.mjs

2. DECLARED=<records folder>/declared.json SPEC=<the agent's folder, or the attached spec.json> RECORDS=<records folder> WORK=<work folder> node ~/test-writer/skills/write-a-suite/scripts/write-suite.mjs

3. SUITE=<work folder> SPEC=<the agent's folder, or the attached spec.json> RECORDS=<records folder> node ~/test-writer/skills/write-a-suite/scripts/check-suite.mjs

4. RECORDS=<records folder> node ~/test-writer/skills/write-a-suite/scripts/reply.mjs

Then JOB_DIR=<job folder> RECORDS=<records folder> node ~/test-writer/skills/write-a-suite/scripts/pieces.mjs to file the pieces.

Each script prints one JSON object or one sentence. The last one's `reply` field is your whole answer; print it and nothing else. When the first exits 3, print its `reply` and stop: what arrived is not a spec, and no model was woken. When any of them exits 2 the command was called wrong; fix the variables and run it again.

Attached files arrive as local paths in an `attached: N files, already downloaded to this machine:` block the adapter writes under the message. The spec is the one whose JSON carries a name, a version and jobs with slugs; pass its path as SPEC.

Never write a test yourself. Never write a script. Never change what the writing step produced to make the check pass: the check's verdict goes in the reply as written.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/job.mjs
- scripts/declared.mjs
- scripts/write-suite.mjs
- scripts/model-caller.mjs
- scripts/check-suite.mjs
- scripts/reply.mjs
- scripts/went-without.mjs
- scripts/pieces.mjs
- scripts/agent-folder.mjs

## References

- references/what-a-good-suite-carries.md
- references/a-suite-that-works.test.mjs
- references/the-spec-it-tests.json
- references/delivered-formats.test.mjs
- references/records-per-job.test.mjs
- references/worked-values.test.mjs
- references/rules.md
