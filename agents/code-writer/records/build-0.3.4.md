# code-writer 0.3.4: how a per-job record is written

Date: 2026-10-31.

Technical debt 639. Three agents built on dev wrote their went-without record straight into the records folder they were handed, so each job overwrote the last, while their descriptors promise one per job at `*/went-without.json`. Neither the code writer's reference nor the hand-off's AGENTS.md said that the records folder is the agent's, shared by every job; the reference said only "records/<job>/", and its example package (publisher) reads names.json from the folder above, as if handed a job's own folder.

- references/what-the-house-stack-is.md: the records folder is the agent's own and kept across jobs; a `file` pattern reads against it, so `*/went-without.json` is one per job and `names.json` one standing record; a script writes per-job records under `join(RECORDS, basename(JOB_DIR))`, never straight into the records folder; the example package's records/.. layout is not to be copied.
- rules.md: the same, short, for the code writer's own harness.
- references/agents-md-template.md: rule 9, the same, for a customer's coding agent holding Code through a hand-off.

Each names the suite's test/records-per-job.test.mjs, which test-writer 0.5.0 adds to every suite.

## Tests

test/records-per-job.test.mjs, 10 tests, written first (9 failing); 100 of 101 pass, 1 skipped.

## On dev

- Packed by the package maker on the dev fleet host from adlc 5362251: sha256 5bf504ccc49a2c6adec63fa626cad5bcef618019e1a0d41043aa3d10bc93e6b5.
- Installed by the deployment manager from deploy request dr_Iy8O_QGD3BKFn-ITZ6-bWNdh, approved by the platform account, with the instruction 0.3.3 ran on. No security review was run for this version: the change is words.
- Proof: in build ab_fa800bf8ce54a325ee (vowel-counter 0.1.0) the reference code writer wrote `note(join(records, basename(resolve(job))), ...)` with the comment "the job's own folder inside the shared records folder", and the suite's records tests passed in both rounds. It stopped on a conflict (records/conflict.md in its job record 01a19232-c7ec-7000-b398-b3184f079055): four tests pinned vowel counts a hand count does not give, and two held a counted piece to a heading the spec gives only to the empty case. Neither is about records; both are filed as technical debt.

## Who held the step

The harness (Claude Code), tests first, then the three texts.
