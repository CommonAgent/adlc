# security-reviewer 0.2.1: three more ways a handed-address call is a declared reach

Date: 2026-10-30.

## Why

Reviewing the platform packages rebuilt on the model system, 0.2.0 refused three for a change the wave itself made. Their scripts no longer carry addresses, so a call to an address a program is handed could no longer be matched to the address it wrote down: narration reads its voice service's address from a declared setting, web-searcher builds its grounded model request with the shared caller's requestFor and sends it itself, and animation-writer fetches the caller's brand mark. The owner decided (2026-10-30) that such a call counts as a declared reach in 0.2.0's cases and in exactly three more, with nothing removed.

## What changed

- scripts/trace-programs.mjs keeps 0.2.0's matches (the declared model system read through MODEL_ENDPOINT; a declared service whose stated reason is fetching what it is handed; a program whose written addresses a declared system covers) and adds: (a) the program reads a declared service's address setting (its name ends in _ENDPOINT, _URL, _BASE, _HOST or _ADDRESS, or its purpose says it is where the service is); (b) it imports requestFor or urlFor from the shared caller and the package declares a system of kind model; (c) it is carried by a skill whose offering declares an input marked external: true (Common Agent 6.2, 12.6 rule 2), read exactly as the specification words it.
- A literal assigned to a setting-named variable is still a literal: it warns, and it is not case (a). Literal addresses still warn and an undeclared system still refuses, as in 0.2.0. The check is still a deterministic text read.
- scripts/read-package.mjs keeps each input's external member; scripts/review-package.mjs passes the offerings to the matcher.
- The Descriptor's refusal about an undeclared reach and the trace-the-programs SKILL.md say the three cases.

## Tests

111 of 112 pass, 1 skipped, with test/handed-addresses.test.mjs: each of the three cases passes a package, a handed-address fetch with none of them is refused naming the file and line, a literal URL in a setting-named variable still warns, and the same archive gives the same verdict twice. The Agent Roles security-reviewer harness 1.1.0 still reports all 12 checks passing. Over the 30 archives of the model-system wave, 0.2.1 differs from 0.2.0 only in narration 1.7.0, now passed; animation-writer stays refused, because a can_use standing asset is not an external input (technical debt 612, a question for the owner).

## Who held each step

- Spec: spec-writer 0.6.0 on dev drafted the change and ran out of time at 600 seconds, handing over its finished files; the harness (Claude Code) took only what was asked from them, held to checkDraft and the builder.
- Tests: test-writer 0.4.0 on dev wrote test/handed-addresses.test.mjs from the spec and the real files the change depends on.
- Code: code-writer on dev (Claude Sonnet 5.5) wrote the scripts in two rounds (jobs 01a18cb5-85d3 and 01a18cc2-7f4e; the second restored 0.2.0's two matches, at the owner's word). Each stopped, as its rules say, on one test that imports a sibling package its workspace does not hold; the harness copied its workspace scripts unchanged and ran the full suite in the repository.
- Review: code-critic 0.2.0 on dev reviewed the change (the package, the diff against 0.2.0 and the code writer's account): no findings.

## On dev

- Packed by the package maker on the dev fleet host: sha256 a756e06537ac5cf089bd77d556fc440ed4341e773c591ad72e6dcef60db64eac.
- Installed by the deployment manager on dev as an update over 0.2.0, from deploy request dr_vVx0pvrP46fApeAyONquicSV, approved by the platform account (2026-10-30). It reads MODEL_PROTOCOL=gemini, MODEL_NAME=gemini-3.8-flash, MODEL_ENDPOINT at the gateway and MODEL_KEY empty, as 0.2.0 did. The smoke check passed. The conformance check after the install was inconclusive: 5 checks passed, none failed and 6 were inconclusive.
- Proof: Installed, it reviewed again the three packages that 0.2.0 refused for a change the model-system wave made, under the owner's limit of 10 USD per day (recorded in jeffrschneider/AgentMesh#774). narration 1.7.0 now passes. animation-writer 1.8.0 and web-searcher 0.4.0 are still refused, for the reasons in technical debt 612 and 613.
