# spec-writer 0.6.0: the model through the four settings, and specs that declare a model the same way

Date: 2026-10-29.

## Why

Common Agent 0.39.0 section 12.4.1 (https://commonagent.net/spec.html#s12-4-1) made the model a system of kind `model`, reached through four settings read on every run, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY (which may be empty) and MODEL_PROTOCOL, with no credential taken from the machine and no address in a script (12.6 rule 2, the address check of 12.10). This agent called Google Vertex AI and the Gemini API at addresses written in its scripts, with a token from the metadata server, and so broke that rule.

## What changed

- The model system is `{"name": "text-reasoning", "kind": "model", "protocols": ["anthropic-messages", "openai-chat", "gemini"]}`: no credential, variable or setting of its own, and all three formats the shared caller speaks, so whoever runs it can point it at their own model gateway (owner, 2026-10-29). On dev it keeps the model it ran before, gemini-3.8-flash, now on the gemini protocol through the model gateway in its job's container (owner, 2026-10-29: the model and the plumbing do not change at the same time).
- The scripts reach the model only through `scripts/model-caller.mjs`, the shared caller kept once in `agents/package-maker/shared/` and copied byte for byte (as merged in #70). No script reads AGENT_MODEL, TEXT_API_KEY, a GOOGLE_* variable or VERTEX_WHERE, names the metadata server, or carries an address.
- A run with MODEL_NAME, MODEL_ENDPOINT or MODEL_PROTOCOL missing, a protocol the system does not declare, or declared protocols that cannot be read, is refused in words before anything is sent.
- plugin.json lists `scripts/model-caller.mjs` in each skill that calls the model; each SKILL.md and the README say how the model is reached.
- draft.mjs sends plain text through the shared caller with the step's remaining seconds as the time limit, and needs no TEXT_API_KEY.
- The specs it drafts declare a model as one system of kind model listing all three formats (unless a job relies on something one cannot carry, which the spec then says), with no credential, variable or setting; its check holds a draft to that, and its rules and reference say a public address is a setting, never a constant in a script.
- files.mjs reads plugin.json's $schema from references/plugin-manifest-schema.json, so no script carries it, and writes a model system's protocols; agent-folder.mjs, the master copy, carries protocols (the copies in code-critic, test-writer, code-writer and package-maker follow). Its three entries come off checks/known-addresses.json.

## Tests

195 of 196 pass, 1 skipped. Retired: test/draft-service.test.mjs.

## Review

code-critic 0.1.2: F1 (only one protocol declared) overtaken by the owner's decision to list all three; F2 (exit 1 on a missing setting) and F3 ($schema rather than $id) answered by reasons: the job is refused in words as the spec says, and the reference file holds exactly the manifest's $schema value.

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

- Packed by the package maker on the dev fleet host, deterministically: sha256 21ca9262898a593c8074d247015e04e56f78c69dd08b846518386a2ae9de55e1.
- Security review, under the owner's spending limit of 10 USD per day, by security-reviewer 0.2.0: passed.
- Installed by the deployment manager on dev from deploy request dr_Vsr938ystJIkeXXASqHbSyV3, approved by the platform account. Its worker job reads MODEL_PROTOCOL=gemini, MODEL_NAME=gemini-3.8-flash, MODEL_ENDPOINT at the job's own gateway and MODEL_KEY empty: the model it ran before, now through the model system.
- Proof: Asked for the spec of a new agent (text-counter), it delivered the agent's own files with nothing left open: 43 gateway calls to gemini-3.8-flash (its harness's included), $0.46.
