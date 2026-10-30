# code-writer 0.2.6: its copy of agent-folder.mjs carries protocols

Date: 2026-10-29.

## Why

agent-folder.mjs reads an agent's own files the way the builder does. It is kept once, in the spec writer, and copied byte for byte into each agent that reads an agent's files; package-maker's test_folder holds every copy to it. The builder now carries a model system's `protocols` from agent-runtime-requirements.json into the spec it builds (adlc #69), and spec-writer 0.6.0's master does the same.

## What changed

Only scripts/agent-folder.mjs, now the master's bytes, and the version.

## Tests

38 of 38 pass; package-maker's test_folder passes.

## Who held each step

The owner approved this release with the six model-system agents. The harness (Claude Code) laid the copy from spec-writer's master, which went through the lifecycle with spec-writer 0.6.0.

## On dev

- Packed by the package maker on the dev fleet host, deterministically: sha256 abba726a19d6919e89adf68ad3c070217150e734315d1fa074af18bd9f5fa853.
- Security review, under the owner's spending limit of 10 USD per day, by security-reviewer 0.2.0: refused, for the example package under skills/write-the-scripts/references/a-package-that-works/scripts/, which writes a storage address and reads FILES_KEY and DATABASE_KEY; 0.2.4 carries the same example (technical debt 574); released with that recorded as known (owner, 2026-10-30).
- Installed by the deployment manager on dev from deploy request dr_K3M5p2q7mi9A9K6Hz7z_7LkE, approved by the platform account. It has no model system; its harness keeps the model the platform set for it on dev.
- Proof: Given the text-counter spec and suite, it wrote scripts/count.mjs (25 of 27 tests pass) and stopped, as its rules say, naming the two tests that cannot pass without breaking the spec, with its account and conflict in its records.
