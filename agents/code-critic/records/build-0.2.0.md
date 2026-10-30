# code-critic 0.2.0: the model through the four settings, and every address in a script listed as a warning

Date: 2026-10-29.

## Why

Common Agent 0.39.0 section 12.4.1 (https://commonagent.net/spec.html#s12-4-1) made the model a system of kind `model`, reached through four settings read on every run, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY (which may be empty) and MODEL_PROTOCOL, with no credential taken from the machine and no address in a script (12.6 rule 2, the address check of 12.10). This agent called Google Vertex AI and the Gemini API at addresses written in its scripts, with a token from the metadata server, and so broke that rule.

## What changed

- The model system is `{"name": "text-reasoning", "kind": "model", "protocols": ["anthropic-messages", "openai-chat", "gemini"]}`: no credential, variable or setting of its own, and all three formats the shared caller speaks, so whoever runs it can point it at their own model gateway (owner, 2026-10-29). On dev it keeps the model it ran before, gemini-3.8-flash, now on the gemini protocol through the model gateway in its job's container (owner, 2026-10-29: the model and the plumbing do not change at the same time).
- The scripts reach the model only through `scripts/model-caller.mjs`, the shared caller kept once in `agents/package-maker/shared/` and copied byte for byte (as merged in #70). No script reads AGENT_MODEL, TEXT_API_KEY, a GOOGLE_* variable or VERTEX_WHERE, names the metadata server, or carries an address.
- A run with MODEL_NAME, MODEL_ENDPOINT or MODEL_PROTOCOL missing, a protocol the system does not declare, or declared protocols that cannot be read, is refused in words before anything is sent.
- plugin.json lists `scripts/model-caller.mjs` in each skill that calls the model; each SKILL.md and the README say how the model is reached.
- The house rules list every address literal a reviewed script carries as a warning: 12.10's literals and the metadata host name, in files under `skills/<slug>/scripts/`, files a run command names, and every script a skill's build entry lists. They are found by a program before the model is asked, the same on every run; a reason, a comment or the message never removes one, a model provider's own address is listed like any other, and warnings are a section of their own that does not count among the open findings (owner, 2026-10-29: warn, not refuse). On the Agent Roles conformance fixtures it warns for write-forecast.mjs:20 https://api.anthropic.com/v1/messages and read-forecast.mjs:26 https://ledger.agentroles.ai/forecasts, and nothing for the declared model package, identically on repeat runs.
- A declared kind-model system read through the four settings is not a finding; a model system naming a credential, a variable or settings is, and so is a script reaching a model without the shared caller.
- review.mjs uses callModel, cannotCall and modelSettings; caller.mjs is gone. Its two entries come off checks/known-addresses.json.
- agent-folder.mjs is the spec writer's new master copy (it carries protocols).

## Tests

84 of 85 pass, 1 skipped. Retired: test/caller.test.mjs.

## Review

code-critic 0.1.2 delivered only its house-rule check (nothing found): the model's answer was cut at its output limit. The owner accepted that, with a second review once this version is on dev.

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

- Packed by the package maker on the dev fleet host, deterministically: sha256 c6bc76ddb6a1f091ecf8b4da40926725f6c410bf3d4b19c78f724b0c4270e973.
- Security review, under the owner's spending limit of 10 USD per day, by security-reviewer 0.2.0: passed.
- Installed by the deployment manager on dev from deploy request dr__L463hoMuop6JU62uybkskb3, approved by the platform account. Its worker job reads MODEL_PROTOCOL=gemini, MODEL_NAME=gemini-3.8-flash, MODEL_ENDPOINT at the job's own gateway and MODEL_KEY empty: the model it ran before, now through the model system.
- Proof: It gave the second look the owner asked for at the three changes 0.1.2 could only check by its house rules (test-writer, code-critic, security-reviewer): each one model call to gemini-3.8-flash (one cut at its limit and said so), about $0.21 each. Its findings were answered by reasons (access as released; agent-folder.mjs is the spec writer's copy, laid separately; the metadata host and provider key names are escaped patterns and data to recognize), and one note went to technical debt 601 (the findings convention does not yet name its Warnings section).
