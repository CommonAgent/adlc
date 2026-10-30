# security-reviewer 0.2.0: the model through the four settings, the model system a declared reach, and address warnings

Date: 2026-10-29.

## Why

Common Agent 0.39.0 section 12.4.1 (https://commonagent.net/spec.html#s12-4-1) made the model a system of kind `model`, reached through four settings read on every run, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY (which may be empty) and MODEL_PROTOCOL, with no credential taken from the machine and no address in a script (12.6 rule 2, the address check of 12.10). This agent called Google Vertex AI and the Gemini API at addresses written in its scripts, with a token from the metadata server, and so broke that rule.

## What changed

- The model system is `{"name": "text-reasoning", "kind": "model", "protocols": ["anthropic-messages", "openai-chat", "gemini"]}`: no credential, variable or setting of its own, and all three formats the shared caller speaks, so whoever runs it can point it at their own model gateway (owner, 2026-10-29). On dev it keeps the model it ran before, gemini-3.8-flash, now on the gemini protocol through the model gateway in its job's container (owner, 2026-10-29: the model and the plumbing do not change at the same time).
- The scripts reach the model only through `scripts/model-caller.mjs`, the shared caller kept once in `agents/package-maker/shared/` and copied byte for byte (as merged in #70). No script reads AGENT_MODEL, TEXT_API_KEY, a GOOGLE_* variable or VERTEX_WHERE, names the metadata server, or carries an address.
- A run with MODEL_NAME, MODEL_ENDPOINT or MODEL_PROTOCOL missing, a protocol the system does not declare, or declared protocols that cannot be read, is refused in words before anything is sent.
- plugin.json lists `scripts/model-caller.mjs` in each skill that calls the model; each SKILL.md and the README say how the model is reached.
- weigh.mjs keeps askJson; model-record.mjs is passed to the caller as its exchange, and a record's service is now the protocol name. Its own caller.mjs (624 lines), modelAvailable and the path for Gemini on Vertex without a key are gone. Its three entries come off checks/known-addresses.json.
- A declared kind-model system and its four MODEL_* settings are a declared reach; MODEL_KEY is never an undeclared credential.
- Every 12.10 address literal and the metadata host a traced program or run command carries is listed as a warning, by a text pass before the model is asked, the same every run, in the review's front matter as `warnings` and in its body, naming the file, the line and the address. A warning never refuses alone (owner, 2026-10-29); a program reaching a system the declaration does not name is still refused, naming the file, the line and the address.
- The Agent Roles security-reviewer conformance harness 1.1.0 (https://agentroles.ai/checks/security-reviewer/) reports "Conforms: all 12 checks pass." The released 0.1.2 code scores 9 of 12 on it.

## Tests

104 of 105 pass, 1 skipped.

## Review

code-critic 0.1.2 delivered only its house-rule check (nothing found): its model call failed to fetch. The owner accepted that, with a second review once code-critic 0.2.0 is on dev.

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
