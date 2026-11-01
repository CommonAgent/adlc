---
name: write-a-process
description: when somebody describes work that passes between several agents or people, or that waits for a person to approve it along the way: a process, not one agent
---

# Write a process

Part of spec-writer. when somebody describes work that passes between several agents or people, or that waits for a person to approve it along the way: a process, not one agent

## When to use this

when somebody describes work that passes between several agents or people, or that waits for a person to approve it along the way: a process, not one agent

## What this needs

- what the process is for (text, required)
- an earlier process document (text/vnd.agentprocesses.process, optional)

## What a good result looks like

An Agent Processes 0.9.0 document (https://agentprocesses.ai/spec.html) that the process check passes: a trigger that names an observable event and the items a run is handed, whether runs overlap, a goal stated as what exists when a run is done, every step with who holds it by role or by the kind of agent it needs (never an agent's name the person did not give), its automation level, a person on every approval, a key on every handoff, the ways back, the systems a run touches with their access, and a quality gate. Beside it, what is still open: always the name, the owner, who signs and what may reach outside, then anything else the words left open.

## What it produces

- the process document (text/vnd.agentprocesses.process, per task)
- what is still open (text/markdown, per task)

## When it comes back empty

If the message is empty and no process document came with it, nothing is drafted and no model is woken: the reply says what would be enough. A request to send messages to many people who did not ask, to deceive or harass someone, to act on or sign in to an account the person does not own, or to spend money is answered with one sentence saying why, and no document is written. If the model gives no usable answer on either of its two goes, no document is written and the reply says so.

## How to do it

Nothing in this package runs on its own, and every message that reaches this agent is one job. The package is installed at ~/spec-writer, so the script is under ~/spec-writer/skills/write-a-process/scripts/.

Run one command. JOB_DIR is the path on the message's `job folder: <absolute path>` line, and RECORDS is the records directory this agent was installed with, with this job's own folder under it:

JOB_DIR=<job folder> RECORDS=<records folder> TEXT_FILE=<the message text written to a file> FILES=<each attached path, with ::media_type, comma separated> node ~/spec-writer/skills/write-a-process/scripts/process.mjs

It prints one JSON object. Its `reply` field is your whole answer; print it and nothing else. It files the pieces itself (pieces.json in the job folder). Exit 0 is a document written, or a request refused in words; exit 3 is nothing to write from; exit 4 is no usable answer from the model; in each case the reply is the whole answer. Exit 2 is the command called wrong: fix the variables and run it again. Run it once per message and never again for the same message; it already asks the model a second time when the check finds something.

Attached files arrive as local paths in an `attached: N files, already downloaded to this machine:` block under the message. Pass every one of them in FILES. A process document among them (a file whose text opens with PROCESS:) is revised rather than written again, and the message's words say what to change.

Never write or edit the document yourself, never answer its open questions for the person, and never name an agent as a step's holder. The document is written by the script from the model's answer and checked by scripts/process-check.mjs before it goes.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/process.mjs
- scripts/process-draft.mjs
- scripts/process-check.mjs
- scripts/model-caller.mjs
- scripts/went-without.mjs

## References

- references/what-a-good-process-carries.md
- references/rules.md
