# spec-writer 0.7.0: write-a-process, a process document from a person's words

Date: 2026-11-01.

The owner approved "the ADLC builds processes" on 2026-11-01: a build's
artifact is in its standard's shape from Requirements on, and for a process
that is an Agent Processes 0.9.0 document, the statement and the design at
once. His decision: the solution planner is retired into the spec writer's
process offering. This version is that offering.

## What changed

- A second offering, `write-a-process`, with two steps, `draft-the-process`
  (the one model call) and `check-the-process` (no model). One command does
  the job: `scripts/process.mjs`.
- `scripts/process-draft.mjs`: the prompt, the reading of the model's answer,
  and the document written from it in code. Carried over from the planner
  (adlc agents/solution-planner 0.4.0, scripts/ask.mjs and
  skills/make-a-plan): no step names an agent (a handle the person did not
  give becomes `<phase>-holder`), the words between markers as content, and
  four refusals (messages to many who did not ask, deception or harassment,
  action on or signing in to an account the person does not own, spending
  money). Not carried over: the build-plan-v1 shape, its kinds and wiring
  (the document's handoffs and `carries:` say that now), and the estimate
  (the platform counts cost after Source).
- `scripts/process-check.mjs`: standards/process-check.mjs byte for byte,
  run over every document before it goes. What it finds goes back to the
  model once; what is still wrong is asked under `conformance` or `findings`.
- The four questions always asked: `name`, `owner`, `signs`, `outside`.
- The document's header: `id: <team>/<slug> v1`, `owner: whoever starts the
  run` (how the AgentMesh process runner reads an owner whose approvals go to
  the person who started the run), `effective:` the drafting day. The team is
  the blank `<team>`, which the process runner will not start a run against
  until it is filled.
- Records: `process-asked.json`, `process-draft.json`, `process-check.json`,
  with `calls.json` and `went-without.json`.

## Tests

`test/process-draft.test.mjs` (11) and `test/process-job.test.mjs` (11),
written first and committed before the scripts (the test step commit). The
package's suite: 237 tests, 236 pass, 1 skipped (as before).

## Who held the step

The harness (Claude Code) stood in for the test step and the code step,
inside the package's own tests, for the reason adlc #109 recorded: the test
writer writes a whole suite from a spec and takes no change to a package that
already carries one, and the code writer's check refuses a change to a few of
a package's scripts unless every script the package names is delivered.

## On dev

- Packed by the package maker on the dev fleet host from adlc 73bee86:
  sha256 65f15c01f1515ec90c79413e4b7028f056f597ec9b91fdbbadc3dd171668aaf2.
- Installed by the deployment manager from deploy request
  dr_EY6qXzx05KuREMP-Xrm-MEH6, approved for the platform account, with the
  settings 0.6.3 ran on (MODEL_PROTOCOL gemini, MODEL_NAME gemini-3.8-flash).
- Proof, one request as platform@agentmesh.ai, 2026-11-01 07:41 Mountain:
  "each morning, read three competitor blogs and send me a one-page summary
  for approval before it goes to the team". It wrote
  "competitor blog digest" (<team>/competitor-blog-digest v1): four steps
  (read-competitor-blogs, draft-summary at supervised, approve-summary at
  never, send-to-team), holders by role (blog-researcher, summary-writer,
  digest-distributor) and whoever starts the run at the gate, a way back
  keyed changes, a quality gate. The process check, run here over the
  delivered file, says it conforms to Agent Processes 0.9.0 and has no
  findings (sha256:a048e4dfc11c672f85fa218cf92114091ef2cf8b54a389956e83c649a3f0368b).
  Open: name, owner, signs, outside, the three blogs' addresses, the
  channel. It found one defect, fixed in 0.7.1: the roster named the agent
  as the signer of the supervised step.
