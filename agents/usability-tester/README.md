# Usability tester

This agent holds the usability tester role for the Usability stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html). The
stage sits in the Prove phase, after Conformance, and it is optional.

Conformance asks whether an agent keeps its declared promises. This stage
asks whether a person can call the agent, understand it, use what it returns
and get the job done. Agents have passed every other check and still stopped
people at their page: twelve boxes of JSON, a free-text voice field, job
names refused, results nobody could read.

The tester has no page of its own. It reads the agent's Descriptor the way a
page reads it, and runs the agent through the same calls the platform's agent
page makes. So what it finds is what a person meets on any page drawn from
the Descriptor. It calls no model, changes nothing it tests and pays for
nothing.

## What it is given

One offering, `test-usability`. The message names the agent:

```
agent: quiz-maker.platform@agentmesh.ai
offering: make-a-quiz          (optional: one offering only)
change: Use two questions.     (optional: the change to ask for)
```

| Input | Kind | |
|---|---|---|
| agent | `text` | the agent's handle |
| judgment | `text` | optional: a person's own judgment, `understood: yes|no`, `could use: yes|no`, `did the job: yes|no`, `note: <words>` |
| examples | `application/vnd.agentmesh.usability-examples+json` | optional: examples for offerings whose Descriptor declares none, `{"<offering id>": {inputs, good_result}}` |
| example files | `document` | optional: the agent's package, or the files an example names in it |

Two settings shape a run: `wait_minutes` (2 to 30, 15 by default) and
`ask_for_a_change` (yes or no, yes by default).

## What it does

1. **Reads the Descriptor** from the platform (`GET /a/<handle>`, then
   `GET /v1/agents/<key>/descriptor`).
2. **Checks it** for what a page draws for a person: a `summary`, an
   `example` for every offering a person starts (Common Agent 6.13.8,
   proposed), a control for every input a person gives, options as settings
   with choices and defaults, and a `presentation` for every output.
3. **Runs each example** as a signed-in account: a fresh test account made for
   the job, or the install's own. It fills the form the way a page fills it,
   presses Run (`POST /v1/accounts/<id>/try`), follows the job record, answers
   once if the agent asks, and reads every piece against its declared kind and
   presentation.
4. **Asks for one change** (`POST /v1/accounts/<id>/jobs/<job>/revise`) and
   checks that a new version comes back. A change with a price is not asked.
5. **Writes the usability report.**

`references/what-a-person-meets.md` says how each answer is read.

## What it hands back

`out/usability-report.md`, Markdown with a YAML header an auditor reads:

```
usability_report: v1
agent, version, package_digest, descriptor_digest
verdict: usable | usable_with_findings | not_usable
tested_at, tested_by
offerings_a_person_starts, offerings_run, findings, descriptor_findings, agent_findings
person_judgment: none | added
```

The package digest is the one the tested agent's own delivery manifest
names. The report comes back under the tester's signed job manifest, which
lists its digest, so the Agent Auditor can read it as the Usability stage's
record (check `usability-report`, level `info` in the default checklist).

The body gives, for each offering a person starts, four answers: whether the
form can be filled from the Descriptor, whether a real run delivers in its
declared form, whether the result can be read, and whether a change returns a
new version. Each finding is labelled `descriptor` (fixed by design) or
`agent` (fixed by code). A person adds their judgment by asking for a change
with the judgment lines; nothing is run again.

## What the install binds

| System | Credential | Settings |
|---|---|---|
| `the-platform` | `agentmesh-operator-key-test` as `TEST_ACCOUNT_KEY`: the platform's test-account key, which makes test accounts under its test domain and does nothing else | `MESH_API_BASE`, the platform's origin; `TEST_ACCOUNT_DOMAIN`, `agentmesh.test` by default |

On a platform without test accounts, the scripts take a signed-in account's
`TESTER_SESSION` and `TESTER_ACCOUNT` instead.

## Running it by hand

```sh
MESH_API_BASE=https://api.dev.agentmesh.ai TEST_ACCOUNT_KEY=... \
  node scripts/test-usability.mjs --job <job folder> --records <records folder> \
  --text-file <job folder>/message.txt [--file examples.json::application/vnd.agentmesh.usability-examples+json]
```

## Tests

```sh
node --test test/*.test.mjs
```
