# code-writer 0.3.7: a hand-off in a folder of its own

Date: 2026-10-31.

Technical debts 653 and 632. Every hand-off was laid out at the root of the
repository it went to, so two builds handed off to the same repository wrote
the same paths (agent-descriptor.json, AGENTS.md, build.lock.json, the
standard tests). Once one was merged, the other's pull request could never be
merged: acronym-maker (ab_6494822a9f81a1fb90,
AgentMesh-Dev-Test/handoff-proof#6) reached "Ready for your OK" and the OK
failed, because word-reverser had been merged into the same root. And this
agent's local check, run in a clone of the second hand-off, read the earlier
agent's files and tests as the new one's (debt 632, palindrome-judge over
tally-words).

The services now put each hand-off in its own folder, agents/<name>/, and
the gate refuses any change outside it. The build folder this agent packs is
unchanged: its paths are the folder's own, and the services decide where in
the repository it goes.

- scripts/check.mjs: outsideChanges lists the files outside the build folder
  that differ from the hand-off commit (changed, removed or added, in the
  working tree or committed since, untracked files too, ignored ones left
  alone), from the top of the repository. The check adds them to the fence
  when it runs from a build folder's lock, so the local check and the gate
  agree. A build folder at the top of its repository has nothing outside it,
  so a root hand-off is judged as before. The fence's verdict no longer calls a
  file outside the folder one of this agent's pinned files.
- Debt 632 is gone with the layout: the check walks and runs only its own
  folder, and finds its own folder's lock, so an earlier hand-off at the root
  or in another folder is never in its fence or its suite.
- references/agents-md-template.md: a section saying where the folder is,
  that nothing outside it is the coding agent's to change, and not to merge
  the default branch in. Rule 1 and the check's list say the same.
- skills/check-the-work/SKILL.md says it.

## Tests

test/check-own-folder.test.mjs, 5 tests, written first and failing: in a
repository whose main holds an earlier hand-off at the root, the check run
from agents/adder/.adlc/ is done on its own suite alone; a file outside the
folder changed, removed or added breaks the fence by name; a committed change
outside is found too; the root layout and a host with no git have nothing
outside; AGENTS.md says the folder is the hand-off's own. 113 tests, 112
pass, 1 skipped.

## Who held the step

The harness (Claude Code), tests first, then the script.

## On dev

- Packed by the package maker on the dev fleet host from adlc 2a97a96:
  sha256 7a5f800e3371cb7f24c22d96911dc5331473350c61583984998e0f9eec8b8e7d.
- Installed by the deployment manager from deploy request
  dr_yriDYjP0VkU5aSjrv_g9D7Yk, approved by the platform account, with the
  instruction 0.3.6 ran on.
- Proof: build ab_a7f1203b882fa9e0d7 (letter-counter 0.1.0), driven from the
  ADLC console, handed off to AgentMesh-Dev-Test/handoff-proof#8, which already
  held word-reverser, palindrome-judge and tally-words at its root. Every file
  of the hand-off went under agents/letter-counter/. The local check, run from
  that folder on the stubs, ran only its own 31 tests with the fence whole.
  Claude Code, run locally and headless as the customer's coding agent, wrote
  both scripts in one round (e5c954e); the gate said Ready for your OK, the pull
  request merged beside the root-level agents, and the agent was packed,
  installed as letter-counter.platform@agentmesh.ai and conforms (5 passed, 0
  failed).
- acronym-maker (ab_6494822a9f81a1fb90, #6), stuck since word-reverser's merge,
  was moved into agents/acronym-maker/ on top of main (74969ab), passed the
  gate again and merged.
