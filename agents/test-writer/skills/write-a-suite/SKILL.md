---
name: write-a-suite
description: when a spec exists and its scripts do not yet, and somebody wants the tests those scripts will have to pass
---

# Write a suite

Part of test-writer. when a spec exists and its scripts do not yet, and somebody wants the tests those scripts will have to pass

## When to use this

when a spec exists and its scripts do not yet, and somebody wants the tests those scripts will have to pass

## What this needs

- the spec (document, optional)
- the agent's own files (document, required)
- the suite it already has (text/javascript, optional)
- the original's own tests (text/javascript, optional)
- the files the change depends on (text/javascript, optional)
- what to add (text, optional)
- what the code step sent back (text, optional)

## What a good result looks like

A suite of test files that run under node's own runner and nothing else, one file per script or per package, each opening by saying what it pins and naming its tests as sentences, reaching every script the agent's files name; with a test for every acceptance scenario of the spec, named by its id ("[F1.A1] ..."), and every exact word, pattern and number a requirement verified by test fixes carried by a test of its feature; with test/kept-interfaces.test.mjs when the spec keeps an interface; that fails against empty stand-ins for those scripts; and beside it, what no test could be written for and why.

## What it produces

- the suite (text/javascript, per task)
- the record of the original's own tests (application/vnd.agentmesh.carried-tests+json, per task)
- what it could not test (text/markdown, per task)

## When it comes back empty

If neither the spec nor the agent's files arrived, nothing is written and no model is woken: the reply says what they carry and asks for them. A spec with no agent's files is refused the same way, since the files name the scripts the tests run. The agent's files with no spec are written from as before, and the reply says the job went without the spec. If the suite still passes against stand-ins after a second go, it is delivered with that said first, because a thin suite with its thin spot named is more use than none.

## How to do it

This job runs as one command, job.mjs, which the package names as the job's command: it finds the spec and the agent's own files among the attached files by content, runs the four steps in order, files the pieces and prints the reply.

The spec (spec-v1, standards/spec.schema.json) is what Requirements hands back since stages.json 1.6.0: each feature with its requirements and their exact words, patterns and numbers, acceptance scenarios in Gherkin, the interfaces that must be kept and the constraints. job.mjs finds it by its format ("format": "spec-v1"), under whatever name a hop gave it (with two, the one whose product version is the agent's own), lays it out by its bytes beside the work folder and passes it to the writing step as SPEC_V1. It is never taken for a suite or a file the change depends on. The agent's own files still come and are still the folder every step reads, for the command lines, the declared formats and the records. A spec with no agent's files is refused in words. No harness runs it and nothing is left to work out by hand. What follows says what that command does, step by step, so a reader can see it did the right thing.

When a carried manifest came (a JSON file whose carried_tests is "v1"), the original's own tests of a rebuild came with it: job.mjs matches each attached file to the manifest by its digest, places each test at test/<its file name> with only the import specifiers the manifest lists rewritten to ./support/<path from the repository's top>, each support file at test/support/<the same path> byte for byte, and their record at test/carried-tests.json (scripts/carried.mjs), and hands that folder to the writing step as CARRIED. None of those files is read as a suite to add to, a dependency or a spec. In a revision the record that came with the suite finds them the same way, so a carried test is never revised; "drop the original test <name>" in the person's words drops one, and the drop is recorded.

When what came with the message is a process document (text whose first lines open with PROCESS:, attached or pasted) and no agent's files or spec, the message is for the write-test-cases offering, and job.mjs runs test-cases.mjs instead of these steps: §21 test cases for the process, held to the coverage check (check-cases.mjs).

When the message also carries test files (any attached file that imports node:test), they are the suite the package already has. job.mjs lays them out by their bytes beside the work folder, never on the job folder's mount, and passes them to the writing step as EXISTING with the message's own words as ASKED_TEXT: the writer then adds new files for what was asked and never rewrites a kept one, and only the new files are delivered. The files the change depends on are read as they are: any attached script that is not a test, and every shared copy the spec's build entry names that this package also carries (scripts/model-caller.mjs, scripts/went-without.mjs, scripts/agent-folder.mjs), go to the writer whole with the names each one exports, and the suite calls them as they are written. The check then refuses a test that imports a name such a file does not export. When the spec names more scripts than one answer holds, the writing step asks for the suite in parts of three scripts, each checked on its own.

When the message's first line begins "Revise the suite", the code step sent the suite back: a test it could not pass without breaking what the spec says, and a person who decided the test is wrong. job.mjs then needs the suite attached (it refuses in words without one) and passes REVISE=1 beside EXISTING and ASKED_TEXT. The writing step rewrites only the test files the message names, by file name, by a test's name or by the spec's id for an acceptance scenario a test is named with ("F1.A2"), keeps every other file byte for byte, and refuses in words, with no model asked, when the message names none. Only the rewritten files are delivered, and the reply says which were revised and which kept. The process runner's form is a revision too: a work message whose last line begins "why this phase runs again: deviation [<key>]:" (new-agent v3's wrong-test). job.mjs then writes "Revise the suite." and the words of that line alone to a file beside the work folder and passes it as ASKED_TEXT, so only the files those words name are revised. Inside a named file only the tests the words name may change: a test is named by its own name, by a line the words cite, by a phrase they quote that appears in that test alone, or by the scenario id its name opens with, and a file named with no test named is named whole. Every other test in it is put back byte for byte whatever the answer did to it, a test the answer added is taken out, a constant or import a test not named may use is kept as it was, and the reply says what was put back (scripts/suite-rules.mjs). A revision delivers the named files changed in place and the standard checks; a file under a new name is a finding, is dropped and named, and an answer that changed no named file is refused.

Nothing in this package runs on its own, and nothing here is done by opening files and working out what to do next. Every message that reaches this agent is one job, and one command does the whole of it. The package is installed at ~/test-writer, so the scripts are always under ~/test-writer/skills/write-a-suite/scripts/.

Run these four commands in order, with these exact paths. JOB_DIR is the path on the message's `job folder: <absolute path>` line; SPEC is the folder job.mjs lays the attached agent's files out in (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and the SKILL.md files, found by content), or, where a spec.json came instead, its local path from the attachments block; WORK and RECORDS are the work and records directories this agent was installed with, each with this job's own folder under it.

1. SPEC=<the agent's folder, or the attached spec.json> RECORDS=<records folder> node ~/test-writer/skills/write-a-suite/scripts/declared.mjs

2. DECLARED=<records folder>/declared.json SPEC=<the agent's folder, or the attached spec.json> [SPEC_V1=<the attached spec-v1 file>] RECORDS=<records folder> WORK=<work folder> node ~/test-writer/skills/write-a-suite/scripts/write-suite.mjs

3. SUITE=<work folder> SPEC=<the agent's folder, or the attached spec.json> RECORDS=<records folder> node ~/test-writer/skills/write-a-suite/scripts/check-suite.mjs

4. RECORDS=<records folder> node ~/test-writer/skills/write-a-suite/scripts/reply.mjs

Then JOB_DIR=<job folder> RECORDS=<records folder> node ~/test-writer/skills/write-a-suite/scripts/pieces.mjs to file the pieces.

Each script prints one JSON object or one sentence. The last one's `reply` field is your whole answer; print it and nothing else. When the first exits 3, print its `reply` and stop: what arrived is not a spec, and no model was woken. When any of them exits 2 the command was called wrong; fix the variables and run it again.

Attached files arrive as local paths in an `attached: N files, already downloaded to this machine:` block the adapter writes under the message. The agent's own files are laid out as the folder passed as SPEC (or, for an older agent, the spec.json whose JSON carries a name, a version and jobs with slugs); the spec, the JSON whose format is spec-v1, is passed to step 2 as SPEC_V1=<its path>.

Never write a test yourself. Never write a script. Never change what the writing step produced to make the check pass: the check's verdict goes in the reply as written.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/job.mjs
- scripts/declared.mjs
- scripts/write-suite.mjs
- scripts/suite-rules.mjs
- scripts/spec-rules.mjs
- scripts/kept-interfaces.mjs
- scripts/carried.mjs
- scripts/model-caller.mjs
- scripts/check-suite.mjs
- scripts/reply.mjs
- scripts/went-without.mjs
- scripts/pieces.mjs
- scripts/agent-folder.mjs
- scripts/test-cases.mjs
- scripts/check-cases.mjs
- scripts/process-check.mjs

## References

- references/what-a-good-suite-carries.md
- references/a-suite-that-works.test.mjs
- references/the-spec-it-tests.json
- references/delivered-formats.test.mjs
- references/records-per-job.test.mjs
- references/worked-values.test.mjs
- references/printed-reply.test.mjs
- references/kept-interfaces.test.mjs
- references/rules.md
