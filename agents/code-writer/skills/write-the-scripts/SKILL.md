---
name: write-the-scripts
description: when a spec and its suite exist and the scripts do not, or exist only as a prototype in whatever language and shape somebody chose
---

# Write the scripts

Part of code-writer. when a spec and its suite exist and the scripts do not, or exist only as a prototype in whatever language and shape somebody chose

## When to use this

when a spec and its suite exist and the scripts do not, or exist only as a prototype in whatever language and shape somebody chose

## What this needs

- the spec (document, required)
- the suite (text/javascript, required unless the build folder came, which carries it)
- a prototype, in any language (document, optional)

## What a good result looks like

Every script the spec names, under scripts/, in the house stack, passing every test in the suite, with each script's absence noticed by the suite, the builder taking the package where the builder is on the host, and beside them the writer's account and the record of every round.

## What it produces

- the scripts (text/javascript, per task)
- the account (text/markdown, per task)
- the run record (application/vnd.agentmesh.code-runs+json, per task)

## When it comes back empty

If no suite arrived, nothing is written: the reply says the test-writer writes the suite from the spec first. If the rounds are used up with the suite still failing, or a test cannot pass without breaking what the spec says, nothing is delivered and the reply says which, with the last failures or the conflict by name.

## How to do it

This job is unlike every other package on this fleet. You do the work. The scripts here only lay out the workspace, check it and report; between those, you work the way a coding session works, for as many rounds as it takes up to the ceiling. The package is installed at ~/code-writer, so the scripts are under ~/code-writer/skills/write-the-scripts/scripts/ and the references under ~/code-writer/skills/write-the-scripts/references/.

JOB_DIR is the path on the message's `job folder: <absolute path>` line. Attached files arrive as local paths in an `attached: N files, already downloaded to this machine:` block under the message, each with its media type in brackets. Pass every one of them in FILES, as they are listed; workspace.mjs tells them apart by what is in them (the build folder archive, the spec, the test files and their helpers, and the prototype, which is everything else), takes the process runner's prefixes off their names, and reads each by its bytes. When one of them is the build folder (a gzip tar archive carrying build.lock.json), workspace.mjs unpacks it itself and checks every pinned file against build.lock.json before anything else, and the build folder is the workspace. Never copy, move, tar or sort the attached files yourself: the job folder is a mounted folder where tar and cp -p fail on timestamps. WORK and RECORDS are the work and records directories this agent was installed with, each with this job's own folder under it. WORKSPACE is <work folder>/workspace.

1. WORKSPACE=<workspace> FILES=<each attached path, with ::media_type, comma separated> RECORDS=<records folder> node ~/code-writer/skills/write-the-scripts/scripts/workspace.mjs

When it exits 3 there is no spec or no suite, or a pinned file in the build folder differs from its lock: print its `reply` and stop. Otherwise read, in this order: rules.md and the reference under references/, which say what the house stack is; the suite under <workspace>/test/, which is the contract; the declaration, <workspace>/agent-descriptor.json, agent-runtime-requirements.json and each skills/<slug>/SKILL.md (or <workspace>/spec.json where the agent's files did not come); the released package's own files at their paths and the prototype under <workspace>/prototype/ if there is one, as the most exact statement of what was wanted; and references/a-package-that-works, a whole package in the stack with its own files, scripts and suite.

2. Write the scripts under <workspace>/scripts/. Every script the spec names is already there, as the released script or as a stub exporting what the suite imports; replace or change each one, keeping the names. Then run WORKSPACE=<workspace> RECORDS=<records folder> node ~/code-writer/skills/write-the-scripts/scripts/check.mjs, as often as you like. It prints each failing test by name. Exit 1 means not yet: read the failures, fix the scripts, run it again. Exit 3 means you changed something you may not: it names what; put it back and run it again (a changed or removed pinned test or agent file is the spec and test steps' to change, never yours). Exit 4 means the rounds are used up: stop, as below. Exit 0 means you are done.

You may write only under <workspace>/scripts/, and the two files <records folder>/account.md and <records folder>/conflict.md. Never edit anything under test/, never edit the agent's files (agent-descriptor.json, agent-runtime-requirements.json, plugin.json, skills/) or spec.json, never edit anything pinned or under prototype/. Never install anything, never reach a network, never run a job against a real system: the suite hands in every function that would. Nothing in the workspace is a credential and nothing you write may look like one.

3. When the check exits 0, write <records folder>/account.md: a few plain sentences saying what you wrote and any decision the spec did not settle, and anything the job went without. Then RECORDS=<records folder> node ~/code-writer/skills/write-the-scripts/scripts/report.mjs, and JOB_DIR=<job folder> RECORDS=<records folder> node ~/code-writer/skills/write-the-scripts/scripts/pieces.mjs. Read the report from the command's own output; never redirect it to /tmp or anywhere outside the workspace and the records folder, because those are the only places you may write and a file elsewhere cannot be read back. The report's `reply` field is your whole answer; print it and nothing else.

When the check exits 4, write the account saying where you got to and run report.mjs; nothing is delivered and its reply says so. When you find a test that cannot pass without breaking what the spec says, write <records folder>/conflict.md naming the test and the line of the spec it contradicts, run report.mjs, and stop: which of the two is wrong is a person's call, never yours. In both cases do not run pieces.mjs.

Never write a test. Never change a test to make a script pass. Never deliver scripts the suite fails.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/workspace.mjs
- scripts/check.mjs
- scripts/report.mjs
- scripts/pieces.mjs
- scripts/verify.mjs
- scripts/went-without.mjs
- scripts/agent-folder.mjs
- scripts/archive.mjs

## References

- references/what-the-house-stack-is.md
- references/a-package-that-works
- references/rules.md
