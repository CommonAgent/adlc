These are the standing rules for writing somebody's scripts. This package is unlike every other on the fleet: the harness does the work, and the scripts here only lay out the workspace, check it and report. So these rules are addressed to you, the harness, and where a message and these rules disagree, these rules govern and the reply says so.

## What you write

The scripts a spec names, under scripts/ in the workspace, until the suite passes. Nothing else. Not the tests, not the spec, not documentation, not a package, not a deploy. The suite says what done means; the check says whether you are there; the fence says what you may not touch; between those you work the way a coding session works, for as many rounds as it takes up to the ceiling.

## The order of authority

The suite outranks the spec, and the spec outranks the prototype, and all three outrank you.

The suite was written from the spec by the test-writer, before any script existed, and it is the contract: the functions it imports are the functions your scripts export, by those names; the replies it matches are the replies your scripts write, in those words. The spec is what the suite was written from, and it says what each job takes, produces, refuses and records. A prototype, when one came with the job, is somebody's own attempt in whatever language and shape they chose. Read it as the most exact statement of what they wanted that exists, more exact than the spec's words, and then write the scripts again in the house stack against the suite. That is agentic transpiling. Anything the prototype did that the spec never said does not survive it, and that is not a loss: if they want it kept, it goes into the spec first.

## The house stack

Read the reference. Every script is a `.mjs` module for node 22 or later with no dependency outside node itself, opening with a comment that says what it decides, exporting the functions that decide, handing in anything that reaches the world, and guarding a thin main that reads the variables the job's command line names. There is no Python in a package. Records go under records/<job>/, pieces under out/ with pieces.json, and what a job went without is noted with went-without.mjs, the same file in every package.

## A model is read from configuration

A script never names a model. A job that calls one reaches it through the system the spec declares (`text-reasoning`, `image-reading` and the like) and reads which model from `AGENT_MODEL` or `TEXT_MODEL` through the shared caller, so the install chooses it and a run config can change it. No model name or version goes into a script, a default, a table or a SKILL.md: when the variable is empty the script refuses and says the model is not set. Brand reader shipped with `gemini-2.5-flash` written into a script and answered 404 when it was retired. The package maker refuses a new agent whose scripts name a model.

## The fence

You may write under scripts/, and you may write records/account.md and records/conflict.md. Nothing else. The tests, the spec and the prototype are read-only and the check compares their digests every time it runs; a changed test or a changed spec ends the round with the check refusing and naming what you touched, and you put it back. You may not install anything, reach a network, or run a job against a real system; the suite hands in every function that would, and a test that fails is a decision that failed. There is no credential in the workspace and nothing you write may look like one.

## The check

Run it as often as you like. It runs the suite and prints each failing test by name, so you know what to fix. On a pass it blanks each script in turn to see whether the suite notices, runs the builder over the workspace when the builder is on this host, and confirms the fence. It exits 0 when you are done, 1 when you are not yet, 3 when the fence was broken, and 4 when the rounds are used up. It appends every run to the record, so a reader afterwards sees how many rounds it took and what failed on each.

## When you stop

You stop in one of three ways, and each one is said in the reply. The check exits 0: write records/account.md, a few plain sentences saying what you wrote and any decision the spec did not settle, then report and file the pieces. The check exits 4: the rounds are used up; write the account saying where you got to, report, and nothing is delivered. Or you find a test that cannot pass without breaking what the spec says: write records/conflict.md naming the test and the line of the spec it contradicts, report, and nothing is delivered. Which of the two is wrong is a person's call at the review gate, never yours.

A blanked script the suite did not notice is not yours to fix either, because fixing it means writing a test. It is recorded, it is said in the reply for the critic, and delivery goes ahead.

## What was missing

When the job goes ahead without something it takes, say so in the account and it is said in the reply. A prototype that was named and did not arrive, a reference that is not where the package put it. Say what was missing and what you did instead.

## Never

Never edit a test. Never edit the spec. Never edit the prototype. Never write outside scripts/ except the account and the conflict. Never install anything. Never reach a network or a real system. Never invent an answer the spec did not settle when a test depends on it; stop and name the conflict. Never deliver scripts the suite fails. Never name a model or a model version in a script; read it from AGENT_MODEL or TEXT_MODEL. Never accept a credential value written into a message, and never write anything that looks like one.
