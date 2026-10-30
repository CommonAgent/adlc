# solution-architect 0.2.0: the model through the four settings

Date: 2026-10-29.

## Why

Common Agent 0.39.0 section 12.4.1 (https://commonagent.net/spec.html#s12-4-1) made the model a system of kind `model`, reached through four settings read on every run, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY (which may be empty) and MODEL_PROTOCOL, with no credential taken from the machine and no address in a script (12.6 rule 2, the address check of 12.10). This agent called Google Vertex AI and the Gemini API at addresses written in its scripts, with a token from the metadata server, and so broke that rule.

## What changed

- The model system is `{"name": "text-reasoning", "kind": "model", "protocols": ["anthropic-messages", "openai-chat", "gemini"]}`: no credential, variable or setting of its own, and all three formats the shared caller speaks, so whoever runs it can point it at their own model gateway (owner, 2026-10-29). On dev it keeps the model it ran before, gemini-3.8-flash, now on the gemini protocol through the model gateway in its job's container (owner, 2026-10-29: the model and the plumbing do not change at the same time).
- The scripts reach the model only through `scripts/model-caller.mjs`, the shared caller kept once in `agents/package-maker/shared/` and copied byte for byte (as merged in #70). No script reads AGENT_MODEL, TEXT_API_KEY, a GOOGLE_* variable or VERTEX_WHERE, names the metadata server, or carries an address.
- A run with MODEL_NAME, MODEL_ENDPOINT or MODEL_PROTOCOL missing, a protocol the system does not declare, or declared protocols that cannot be read, is refused in words before anything is sent.
- plugin.json lists `scripts/model-caller.mjs` in each skill that calls the model; each SKILL.md and the README say how the model is reached.
- name.mjs asks through the shared caller for JSON, with replayCaller unchanged and no TEXT_API_KEY; bind.mjs says the install places the model in the four settings. caller.mjs is gone; its two entries come off checks/known-addresses.json.

## Tests

108 of 109 pass, 1 skipped.

## Review

code-critic 0.1.2: F1 (json passed to callerFor, which ignores it) answered by a reason: every ask passes it, where it takes effect. F2 (declared protocols read as empty when the runtime requirements cannot be read, so the check was skipped) answered by a change, made in every agent that reads them. A note outside the change (check-record.mjs writes two undeclared records) is technical debt 572.

## Who held each step

The released lifecycle agents on dev built this version, as the platform
account, through the lifecycle's own steps, and the harness (Claude Code)
stood in where an agent's one shot did not deliver, inside that agent's own
rules and checks:

- Spec: spec-writer 0.5.4 was sent the change in words with this agent's own
  files and ran out of time at its 600-second limit, delivering nothing. The
  harness stood in and held the files to spec-writer's own check (checkDraft:
  no new findings) and the builder. The owner approved the spec.
- Tests: test-writer 0.3.1 wrote the added tests from the approved files and
  the suite this agent already had, and they failed against empty stand-ins
  as its check requires. It only adds, so the harness retired the files that
  tested only the old model route, and stood in for the test writer to repair
  tests that contradicted the approved spec or the shared caller's real
  interface, held to test-writer's check-suite.
- Code: code-writer 0.2.4 was sent the spec, the suite and the released
  scripts as the prototype, and delivered nothing its own check accepted.
  The harness stood in for the code step under the code writer's rules:
  scripts only, the shared caller copied unchanged, no test or declaration
  touched; the suite, the builder and a pass blanking each changed script as
  the check.
- Review: code-critic 0.1.2 reviewed the change; the owner answered its
  findings.

## On dev

- Packed by the package maker on the dev fleet host, deterministically: sha256 cfe1a4f4eb973c8d6f9f2d2f27b214533a89d2e7b32ef3527b9a3f0034ee37a2.
- Security review, under the owner's spending limit of 10 USD per day, by security-reviewer 0.2.0: passed.
- Installed by the deployment manager on dev from deploy request dr_KN1OjfOPzMGCLyky6jXD-y-T, approved by the platform account. Its worker job reads MODEL_PROTOCOL=gemini, MODEL_NAME=gemini-3.8-flash, MODEL_ENDPOINT at the job's own gateway and MODEL_KEY empty: the model it ran before, now through the model system.
- Proof: Asked for the architecture record of an agent that turns a meeting transcript into three action items, it delivered the record and what is still open: 40 gateway calls to gemini-3.8-flash (its harness's included), $0.30.
