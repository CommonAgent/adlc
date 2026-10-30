# code-writer 0.3.1: one command, routed; the delivery check knows the build folder

Date: 2026-10-30.

## Why

0.3.0 on dev showed two gaps the local suite could not:

- The host keeps one command per agent and runs it for every ordinary message. A write-the-scripts message therefore ran the hand-off command, and the coding session never started: with 0.3.0 installed, code-writer could not write scripts on dev at all.
- The host's delivery check (verify.mjs) knew only the scripts delivery: it refused the hand-off's archive, and refused a write-the-scripts job whose only input is the build folder ("nothing under in/ is a spec").

A rollback to 0.2.6 was refused by the deployment manager ("the version must increase"), so this is the fix forward.

## What changed

- The hand-off run passes the message (`message_file`, `--message`) and names `escalate_when: json:escalate` (Common Agent 12.3). handoff.mjs hands off when the message's first line begins "Hand off the code"; any other message lays nothing out, files nothing and answers {"escalate": true}, and the host wakes the coding session for write-the-scripts.
- verify.mjs accepts a hand-off delivery (out/build-folder.tar.gz and no scripts) when the archive reads, holds the agent's files and a test, and matches its own lock, and refuses it naming each file otherwise. For a write-the-scripts job whose input is the build folder, it reads the agent's files, the suite and the package's other files from inside the archive, as bytes.

## Who held each step

- Spec: spec-writer 0.6.0 on dev made the three edits (the run's message file, `--message` and `escalate_when`; one sentence in each of two skills) correctly and rewrote the rest of the package around them, which it reported. The harness (Claude Code) applied only its three edits.
- Suite: test-writer 0.4.0 on dev wrote verify-build-folder.test.mjs, handoff-routing.test.mjs and verify-build-archive.test.mjs (14 tests), every import a real export. Four more files it wrote in the first round tested untouched scripts under names the suite already used, and were left out.
- Scripts: code-writer could not write on dev, because 0.3.0 was installed (the harness's mistake: it installed before the dev proof passed). The harness stood in, inside code-writer's rules, changing only handoff.mjs and verify.mjs against test-writer's tests.

## Tests

In the repository: 85 of 86 pass, 1 skipped. Blanked one at a time beside the package, the suite notices every script; the builder takes the package. Replaying the host locally with the text-counter files: a "Hand off the code" message runs the command and the delivery check accepts its archive (whose digest, 502b87f4…, is byte for byte the one dev made), and a "Write the scripts" message carrying only that archive answers escalate and leaves nothing behind.

## On dev

- Packed by the package maker on the dev fleet host, deterministically: sha256 db9cbf3c902140ac4a4df568ad1cf0f1f1035db3bcba60b02f0be7381f779cb8.
- Security review by security-reviewer 0.2.1, under the owner's limit of 10 USD per day: refused only for the reference example under skills/write-the-scripts/references/a-package-that-works (technical debt 574), as 0.2.6 and 0.3.0 were; released with that recorded as known.
- Installed by the deployment manager from deploy request dr_YURpAuzZsesfzVzZTI4rW_aw, reloaded in place on the platform node (no node restart; restarts stayed 168). Its harness keeps Claude Sonnet 5.5.
- Proof, step 1: "Hand off the code for text-counter 0.1.0", with the agent's files loose and the suite as an archive. The command built the folder (14 files, 12 pinned), the host's delivery check accepted it, and it reached the platform account as "the build folder", sha256 502b87f4c32bbb1580c1043ad932c2dc3ddd85ed5a866b7d835ee7a8f642aa32, the same bytes as the local run.
- Proof, step 2: "Write the scripts for text-counter 0.1.0" with only that archive attached. The command escalated, the coding session laid the folder out as its workspace, wrote scripts/count.mjs in three rounds (25 of 27 tests pass), and stopped on two tests that contradict the agent's files, naming each in its conflict note: one expects 17 words where the stated whitespace rule gives 18, and one reads the older spec.json shape instead of the descriptor (technical debt 600). Nothing was delivered, as its rules say. The reply the sender saw was the delivery check's "no scripts were delivered" rather than the conflict (technical debt 617, as with 0.2.6).
