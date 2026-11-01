---
name: write-test-cases
description: when a process document exists and somebody wants the test cases a test run of it will follow, with every approval and every way back exercised
---

# Write test cases

Part of test-writer. when a process document exists and somebody wants the test cases a test run of it will follow, with every approval and every way back exercised

## When to use this

when a process document exists and somebody wants the test cases a test run of it will follow, with every approval and every way back exercised

## What this needs

- the process document (text/vnd.agentprocesses.process, required)

## What a good result looks like

One file per case in the form Agent Processes 0.9.0 section 21 gives (TEST: and the case's name, for: the document's id, digest: its digest, then carried:, answer:, stand-in: and expect: lines), named for what each exercises and pinned to the document's exact digest, which together answer every phase a person signs (automation: never or supervised) approve, changes and reject at least once, and take every way back at least once, by a changes: answer at the phase it leaves, naming its key in square brackets. Every case carries every item the trigger requires, and stands in for every phase that sends, publishes, pays or signs outside the organization. Beside them, what the test cases cover: which case gives each answer and takes each way back, and what no case covers.

## What it produces

- the test cases (text/vnd.agentprocesses.test-case, per task)
- what the test cases cover (text/markdown, per task)

## When it comes back empty

If nothing that came with the message is a process document (text that opens with PROCESS: and lists phases), nothing is written and no model is woken: the reply says what to attach. If the model gives no usable answer on either of its two goes, no cases are written. Cases that are still short of the rule after the second go are delivered with the shortfall said first, never as a suite that covers it.

## How to do it

Nothing in this package runs on its own. The package names one command for a message, the job command (run), and it sends a process document here by its content: an attached file whose first lines open with PROCESS:, or a document pasted into the message, and no agent's files or spec. It then runs scripts/test-cases.mjs, which writes the cases, runs the coverage check (scripts/check-cases.mjs), files the pieces and prints the reply. No harness is woken for it.

By hand: PROCESS=<document> RECORDS=<records folder> WORK=<work folder> JOB_DIR=<job folder> node ~/test-writer/skills/write-test-cases/scripts/test-cases.mjs, and the `reply` of the JSON object it prints is the whole answer. The coverage check alone: node ~/test-writer/skills/write-test-cases/scripts/check-cases.mjs --process <document> <folder of *.test.txt>.

Never write or edit a case yourself, and never change a case so the check passes: a shortfall is said, and what to do about it is the person's decision.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/job.mjs
- scripts/agent-folder.mjs
- scripts/test-cases.mjs
- scripts/check-cases.mjs
- scripts/process-check.mjs
- scripts/model-caller.mjs
- scripts/went-without.mjs

## References

- references/rules.md
