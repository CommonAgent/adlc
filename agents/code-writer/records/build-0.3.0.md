# code-writer 0.3.0: hand off the code step as a build folder

Date: 2026-10-30.

## Why

The owner decided that any coding agent may hold the code step: our code-writer, or the customer's own (Claude Code, Codex, Copilot's agent, Cursor) or a person. The lifecycle hands the code step out as a build folder and takes it back through the same checks (AgentMesh docs/byo-coding-agent-plan.md). Separately, code-writer had delivered nothing on almost every build since 2026-10-09: attached files arrive flat, so a package's sample/ files, fixtures and released scripts were not where the suite looks; every script was stubbed; and suite files were read as text, corrupting binary fixtures (debts 503 and 552).

## What changed

- A new offering, hand-off-the-code (free, no model): writes the build folder (the agent's files, the suite byte for byte, the released scripts in place, the released package's other files at their paths, AGENTS.md from references/agents-md-template.md, CLAUDE.md, .adlc/ with the check, and build.lock.json pinning every file outside scripts/) and packs it as one deterministic gzip tar (scripts/handoff.mjs, scripts/archive.mjs).
- write-the-scripts takes that archive as its first input, refuses one whose pinned files differ from its lock or that carries an unpinned file outside scripts/, and uses it as the workspace.
- The workspace reads and writes bytes, and lays out a released package's own files at their paths, read-only and pinned.
- The fence allows a new file under test/, and says a changed or removed pinned test or agent file goes back to the spec and test steps.
- `node .adlc/check.mjs` in a build folder checks against the folder's lock and runs the suite, the blanking and the builder where present.

## Who held each step

- Spec: spec-writer 0.6.0 on dev (Claude Sonnet) drafted it in about five minutes. The harness (Claude Code) restored what the draft lost against the request (the descriptor's name and can_use, the runtime's verify, plugin.json's rules.md path, the existing skills' "How to do it" text) and wrote the AGENTS.md template. The owner's "build it" on the plan is the spec gate.
- Suite: test-writer 0.4.0 on dev wrote seven files, 34 tests, in about seven minutes. The harness amended one test that flattened paths into names.
- Scripts: code-writer 0.2.6 on dev (Claude Sonnet 5.5) wrote archive.mjs and handoff.mjs and changed workspace.mjs and check.mjs, in two rounds (the second answered review findings F1, F2 and F6). Neither round delivered: two kept agent-files tests need python3 and the sibling package-maker folder, and its released workspace laid the AGENTS.md template out empty (the flattening this version fixes). The harness took its scripts unchanged both times. Its accounts are build-0.3.0-account.md and build-0.3.0-account-round2.md.
- Review: code-critic 0.2.0 on dev. Its first review was cut at the shared caller's fixed 32000-token answer budget (now a setting, adlc #85); a narrower review of the four scripts found six points: F1, F2 and F6 answered by code-writer's changes, F3, F4 and F5 by reason (review-0.3.0.md).

## Tests

In the repository: 71 of 72 pass, 1 skipped (no saved example deliveries). Blanked one at a time beside the package, the suite notices every script; the builder takes the package. A real hand-off of code-writer itself (agent files loose, the suite and the package as archives) gives a 90-file build folder whose `node .adlc/check.mjs` runs the suite from inside the folder.
