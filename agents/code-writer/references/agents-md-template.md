# Writing the scripts for {{name}} {{version}}

This folder is a build folder from an Agent Development Lifecycle. The steps before the code are done: the agent is declared (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and each skills/<slug>/SKILL.md) and its test suite is written (test/). Your job, whoever you are (a coding agent or a person), is to write the scripts under scripts/ so that the suite passes. The steps after the code (review, security review, packing and deploy) take your work back through the same checks you can run here.

## The scripts to write

{{scripts}}

Each one is already there: the released script where there is one, otherwise a stub that exports what the suite imports and throws until it is written. Keep the file names and the exported names.

## The rules

1. Write only under scripts/. Everything else here is pinned by digest in build.lock.json.
2. Never change a test, the agent's files, or any other pinned file. You may add a new test file under test/; it is run with the rest. Changing or removing an existing test, or the agent's files, sends the work back to the spec and test steps, so say what you think is wrong instead of changing it.
3. If a test cannot pass without breaking what the agent's files say, stop. Write records/conflict.md naming the test file, the test's name as it is written, the line of the test, and the line of the agent's files it contradicts, then commit and push it to this branch, with nothing else changed in that commit. Which of the two is wrong is a person's call, made in AgentMesh with Send back to Test, and the tests you named come back revised on this branch; see "When a test is wrong" below.
4. Node 22 or later, ES modules (.mjs), nothing outside node: no npm packages, no other language.
5. A model is reached only through the shared caller (scripts/model-caller.mjs, where the agent has one) and its four settings, read from the environment on every run: MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY (may be empty) and MODEL_PROTOCOL (anthropic-messages, openai-chat or gemini). Never sign in any other way: no metadata server, no credential file, no variable the agent's files do not declare.
6. Write no address into a script. A system's address is one of its declared settings, read from the environment; an address a caller hands in is used as given.
7. No credential values anywhere, and nothing that looks like one.
8. Never reach a network or a real system from a test run: the suite hands in every function that would.
9. Every job is handed the same records folder, the agent's own (RECORDS, or `--records`), kept from one job to the next. A record agent-descriptor.json keeps per job, one whose `file` pattern starts with the job's folder such as `*/went-without.json`, goes under a folder named after the job folder, `join(RECORDS, basename(JOB_DIR))` (with `--job`, the job folder you are given), and never straight into the records folder, where the next job overwrites it. A plain `file` such as `names.json` is one record the jobs share. test/records-per-job.test.mjs runs two jobs with one records folder and names a record in the wrong place.

## When a test is wrong

A test that cannot pass without breaking what the agent's files say is not yours to fix, and not yours to weaken. Do this, and only this:

1. Write `records/conflict.md` in plain words: the test file (for example `test/count.test.mjs`), the test's name exactly as it is written, the line of the test, what it expects, and the line of the agent's files it contradicts and what that line says instead. One conflict per test; list every test you found.
2. Commit that file alone and push it to this branch. records/ is not pinned, so the fence allows it.
3. Stop. Do not change the test, do not change a script to fit it, and do not push anything else until the tests come back.

The gate reads `records/conflict.md` on the pushed commit, runs nothing, and says on this pull request that the coding step stopped on a conflict, with your words. The owner then decides in AgentMesh. When the test is wrong they press Send back to Test, and the test writer revises the tests you named. The revised tests come back as a new commit on this branch, which also updates build.lock.json and removes records/conflict.md, with a comment saying what changed. Pull it and carry on writing the scripts against the suite as it now stands.

## The check

Run `node .adlc/check.mjs` from this folder as often as you like. It says, in order:
- whether anything pinned changed (and names it);
- each failing test by name;
- on a pass, whether the suite notices each script going missing, and whether the package builds where the builder is installed.

Exit 0 is done. When it is, hand the work back: open the pull request, or send the folder back, as you were asked.
