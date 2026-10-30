---
name: hand-off-the-code
description: when the code step is to be held by a coding agent or a person other than this one, and needs a folder to write the scripts in
---

# Hand off the code

Part of code-writer. when the code step is to be held by a coding agent or a person other than this one, and needs a folder to write the scripts in

## When to use this

when the code step is to be held by a coding agent or a person other than this one, and needs a folder to write the scripts in

## What this needs

- the agent's files (document, required)
- the suite (document, required)
- the released package, as the prototype (document, optional)

## What a good result looks like

One gzip tar archive that unpacks to the build folder: the agent's files as they came; the suite under test/, byte for byte, binary fixtures included; every script the spec names under scripts/, the released script where the prototype carries one at that path and otherwise a stub exporting what the suite imports; every other file the released package carries at its own path, read-only; AGENTS.md with the house rules; CLAUDE.md pointing to it; .adlc/ with the check, so `node .adlc/check.mjs` runs the same check locally; and build.lock.json with the digest of every pinned file, the record the hand-back is checked against.

## What it produces

- the build folder (application/gzip, per task)

## When it comes back empty

If no agent's files or no suite arrived, nothing is laid out and no archive is made: the reply says what is missing. A prototype that is not a package puts its files under prototype/ only and every script is stubbed. No model is woken and nothing is charged.

## How to do it

Run `node scripts/handoff.mjs --job <job folder> --records <records folder> --work <work folder> --file <path>::<media type> ...`. It runs the three steps in order and prints one JSON object with a `reply` field. The agent's files may come loose; they are told apart by what is in them. A suite or a prototype that has folders comes as one gzip tar archive holding its own paths (test/... for the suite, the package's own layout for the prototype), because a loose file's folder is lost on the way; a released package's archive is taken as the prototype as it is. It calls no model and reaches no network: every step is a program. Archives are written and read by archive.mjs in node alone, with no tar binary.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/handoff.mjs
- scripts/archive.mjs
- scripts/workspace.mjs
- scripts/agent-folder.mjs
- scripts/check.mjs

## References

- references/agents-md-template.md
