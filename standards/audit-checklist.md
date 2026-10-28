---
schema: https://schemas.agentmesh.ai/audit-checklist/v1
name: Audit checklist
owner: agentmesh.ai
layer: publisher
approved_by: null
approved_at: null
---

# The audit checklist

This is the checklist the auditor runs over one built agent version, in the
Prove phase of the Agent Development Lifecycle
(https://agenticdevelopment.ai/stages.html). The auditor is given the
version's package digest and the agent's address, and hands back one signed
audit report for that version. The Deployment Manager refuses a prod deploy,
and the Catalog refuses a listing, without a current pass for that exact
digest.

The checklist is itself a standing asset (see [README.md](README.md)). Its
version is the `sha256:` digest of this file's bytes, and the audit report
cites it as `checklist_digest`. A person approves each version; until a
person has, `approved_by` above is empty and the auditor says so in the
report's "Not checked" section rather than treating the checklist as
approved.

## How a check is written

Each check is a YAML block followed by a plain explanation:

```yaml
id: <kebab-id>
says: <the rule in one sentence>
why: <reason>
kind: design-time | run-time | stage-record
check: <name of the registered test that runs it>
fixed-by: requirements | architecture | design | test | code | package | deploy | docs
level: info | warn | refuse
applies: <new agents from DATE; existing agents from DATE>
evidence: <what the report shows>
```

- **kind.** `design-time` is read from the package itself. `run-time` is
  read from the agent as it runs: its served Descriptor, its deploys, its run
  records. `stage-record` is a record a lifecycle stage left for this
  version.
- **check.** The name of the test the auditor registers to run the check.
  Where an existing test already holds the rule (the package maker's format,
  model and standing-asset rules, AgentMesh's `check-no-model-literals`
  gate, the registry's descriptor validation, signed delivery
  manifests), the explanation under the check names it, and the
  auditor's registered test runs it. A check whose test is not registered
  with the auditor is reported under "Not checked", with the reason, and is
  never skipped silently.
- **fixed-by.** The stage that fixes a finding. The report files each
  finding as a debt routed to that stage.
- **level.** What a finding does to a new agent's verdict: `refuse` makes it
  `fail`, `warn` makes it at most `pass_with_findings`, and `info` is shown in
  the report and does not count toward the verdict. An organization may raise
  any `info` check to `warn` or `refuse` in its own checklist, which is a
  standing asset (see [README.md](README.md)).
- **applies.** A new agent is one first released on or after the first
  date. An existing agent is one released before it: its findings are
  warnings until the second date, which the owner sets when the warnings
  become refusals for everyone. Until then the second date reads "not set".

## The Descriptor

```yaml
id: descriptor-stored-signed
says: The agent serves a bound Descriptor that the registry stores, signed by the agent's own key.
why: The Descriptor is what a buyer, a page and every gate reads; one the registry does not hold, or one whose signature does not verify, is a claim nobody can hold the agent to.
kind: run-time
check: descriptor-signed
fixed-by: deploy
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: the digest of the Descriptor served at the agent's address, the registry's stored digest, and whether the signature verifies under the subject key
```

It runs the registry's own validation
(`validateDescriptor` in AgentMesh `server-release/server/src/registry/descriptor-store.ts`).
The auditor fetches the Descriptor from the agent's descriptor door, asks
the registry for the one it stores, and runs the registry's own validation
over the bytes: bound (not a draft), the right format, signed by the subject
and not by another key. A Descriptor served but not stored, or stored but
different from the one served, is a finding.

```yaml
id: registered
says: The agent is registered on the mesh under its handle, and its handle resolves to the address the auditor was given.
why: The gates and the catalog name an agent by its handle; an agent that is not registered, or whose handle resolves elsewhere, is not the agent that was audited.
kind: run-time
check: registered
fixed-by: deploy
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: the handle, the address it resolves to, and the address given
```

```yaml
id: descriptor-floor
says: The Descriptor the agent serves holds at least the minimal Descriptor's members.
why: A Descriptor below the floor cannot be read by a buyer, a page or a gate, whatever else it says.
kind: run-time
check: descriptor-floor
fixed-by: package
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: each floor member, present or missing
```

The floor is Common Agent Section 4.9 (the minimal Descriptor's members,
Sections 6.2 and 6.6), the rule the mesh-adapter's `descriptor-floor` test
holds every node to.

```yaml
id: descriptor-matches-package
says: The Descriptor the agent serves is the one in the audited package, bound for this deploy.
why: An agent serving a Descriptor other than its package's makes claims nobody built or checked.
kind: run-time
check: descriptor-matches-package
fixed-by: deploy
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: the package's Descriptor digest and the served one's, and each member that differs other than those a deploy binds
```

```yaml
id: descriptor-person-members
says: The Descriptor carries the members a person reads, which are name, summary, will_not, and given_by on every input.
why: A page shows what the agent says about itself; where a member is absent the page must say the agent has not said, and a person deciding whether to use it learns nothing.
kind: design-time
check: descriptor-person-members
fixed-by: design
level: warn
applies: new agents from 2026-10-28; existing agents from not set
evidence: each of the four members, present or absent, and each input without given_by by its offering and name
```

These are the members Common Agent Section 6.13 proposes for people (`name`,
`summary`, `will_not` and an input's `given_by`). The package maker already
refuses a `given_by` outside `person`, `agent` and `either`; this check is
about presence. It warns rather than refuses while Section 6.13 is proposed.

## Formats

```yaml
id: specific-kinds
says: Every input and output declares a specific kind, never a bare application/json.
why: The next agent, the person reviewing and the App all go by the declared kind; a bare JSON kind says nothing about what the piece is, so a hand-off cannot be matched or checked.
kind: design-time
check: package-maker-format-rules
fixed-by: design
level: refuse
applies: new agents from 2026-10-27; existing agents from not set
evidence: each input or output declared application/json, by its job and name
```

The package maker's format rule 1 (`format_findings` in
agents/package-maker/build.py; agents/package-maker/README.md). It already
refuses a new agent's package and warns for an existing one.

```yaml
id: people-read-markdown
says: Words a person reads, or one agent hands another to read, are delivered as text/markdown; a page, picture, sound or film uses its own media type.
why: Markdown reads well as it is and renders well; plain text loses its structure, and JSON or an HTML page put in front of a person to read words is a format chosen for code.
kind: run-time
check: delivered-formats
fixed-by: design
level: warn
applies: new agents from 2026-10-28; existing agents from not set
evidence: each person-facing output with its declared kind, and for each delivered piece whether its bytes are what that kind says
```

The architecture standard, section 4, is the rule. The test writer's
delivered-formats check (`checkDelivered` in
agents/test-writer/references/delivered-formats.test.mjs) holds each delivered piece to its declared kind, so
a piece declared Markdown is Markdown; this check also reads the declaration,
and a person-facing output of words declared anything other than
`text/markdown` is a finding.

## Models

```yaml
id: no-model-names
says: No model is named in the agent's code or skills; a model is a bound system the install and the run config choose.
why: A model named in code breaks when that model is retired, and nothing an install sets can change it; Brand reader answered 404 when the model written into it went.
kind: design-time
check: no-model-literals
fixed-by: code
level: refuse
applies: new agents from 2026-10-27; existing agents from not set
evidence: each model name found, with its file and line
```

The test is AgentMesh's `tools/ci/check-no-model-literals.mjs`, the gate
that reads every package in the AgentMesh repository. The package maker's
format rule 3 (`model_findings` in agents/package-maker/build.py)
runs the same rule over one agent's folder as it is built, and the auditor
may run either over the package it is given.

## Offerings

```yaml
id: revisions-declared
says: Every offering a person can buy declares its revisions policy, saying how many changes are included, for how long, and the price of each further one.
why: A buyer who asks for a change needs to know before buying whether it is included and what it costs; an offering silent on revisions leaves that to argument.
kind: design-time
check: revisions-declared
fixed-by: design
level: warn
applies: new agents from 2026-10-28; existing agents from not set
evidence: each offered job with its revisions policy, or that it has none
```

The package maker checks the shape of a policy that is given
(`revisions_policy` in agents/package-maker/build.py) but does not require
one; this check is about presence.

## Inputs and settings

```yaml
id: options-are-settings
says: Inputs are only the material the job is about; an input that only shapes how the job runs is a run-config setting, and brand or palette material is a can_use standing asset.
why: A voice, a tone, a length or a palette declared as an input is drawn as a free-text box on a person's page, with no default and no choices; Explainer maker declared Voice, How it sounds, Target length and Palette so.
kind: design-time
check: package-maker-option-rules
fixed-by: design
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: each offered job's input that names an option or library material, by its job and name
```

An option is anything with a fixed set of values or a default: a voice, a
tone, a length, a style, a format choice. It belongs in `run_config.settings`
with a label, an about, a default and its allowed values, so a page draws a
choice. Brand, palette, style-guide and template material is a `can_use`
entry (see Standing assets). The package maker's option rules
(`option_findings` in agents/package-maker/build.py) read the offered jobs'
input names; the build record carries them under `option_rules`.

```yaml
id: settings-declared-fully
says: Every run-config setting declares a label, an about and a default, its allowed values whenever the value has a natural set of choices, a label for each allowed value, and for a number its min, max and step.
why: A setting without its choices and their labels is decided by whoever types into it; every option is decided at design time and never left open.
kind: design-time
check: package-maker-option-rules
fixed-by: design
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: each setting and the members it does not declare
```

The members are Common Agent Section 6.13's (`label`, `about`,
`value_labels`), proposed, and a numeric setting's range (`min`, `max`,
`step`). A setting whose name says voice, tone, length, format and the like,
or a rule, has a natural set of choices.

## Standing assets

```yaml
id: can-use-known-schema
says: Every can_use entry names a schema from the list of known standing-asset kinds.
why: A schema nobody publishes is a shape the organization cannot keep, approve or hand over, so the agent would read nothing it was given.
kind: design-time
check: can-use-declared
fixed-by: design
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: each can_use schema and whether it is on the list, with the list's digest
```

The list is `standards/standing-asset-schemas.json`. The package maker's
standing-asset rules (`standing_findings` in agents/package-maker/build.py)
hold this check and the next two as a package is built, and the build
record carries their findings under `standing_rules`.

```yaml
id: can-use-without
says: Every can_use entry says what the agent does when no asset of that kind is given.
why: Most jobs run without the organization's brand or style guide at hand; a person needs to know whether the agent stops, asks, or falls back to its own house style.
kind: design-time
check: can-use-declared
fixed-by: design
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: each can_use entry without a without member
```

```yaml
id: person-facing-declares-library
says: An agent whose output a person reads or watches (text/markdown, text/html, an image, video or audio) declares the standing assets it reads as can_use, or its architecture record says why it reads none.
why: Person-facing work that ignores the organization's brand and style comes back off-brand, and the person fixes it by hand every time.
kind: design-time
check: can-use-declared
fixed-by: architecture
level: warn
applies: new agents from 2026-10-28; existing agents from not set
evidence: the person-facing outputs, and either the can_use entries or the record's stated reason
```

The architecture record's "Standing assets" section decides, for each kind
of output, which standing assets apply with a reason, or "none, because…".
The Design declares exactly those as `can_use`. A record that says none, with
its reason, answers this check.

```yaml
id: reads-standing-assets
says: When a standing asset the agent declares is given, the person-facing output reads it, and the run record cites its schema, version_digest and layer.
why: A declaration the agent does not honor is a claim; the run record is how anyone can tell which version of the brand or style guide a piece was made under.
kind: run-time
check: standing-assets-cited
fixed-by: code
level: warn
applies: new agents from 2026-10-28; existing agents from not set
evidence: a run given each declared asset, the fields of its reads that changed the output, and the run record's citations
```

## Deploys

```yaml
id: present-dev-and-prod
says: The agent is deployed on dev at the audited version, and where it is on prod, prod runs the same version or the one before it while this version's prod deploy waits on this audit.
why: A version that runs on prod and not on dev, or that drifted between them, was never proved where it runs.
kind: run-time
check: versions-dev-prod
fixed-by: deploy
level: warn
applies: new agents from 2026-10-28; existing agents from not set
evidence: the version and package digest the agent serves on dev and on prod
```

## Stage records

The audit requires artifacts and checks, not a particular lifecycle. The
roles are open, and the artifacts before the package (the statement, the
architecture record, the design, the tests, the review findings and the
security statement) are optional: each is accepted as evidence when it is
present, signed by whoever made it and bound to the package digest, and its
check is `info`, shown in the report and not counted toward the verdict. No
check requires a signature from a particular holder: any signed artifact
bound to the digest counts.

What is required, for an agent the platform runs, is the package itself, its
signed build record and its deployment record, with a signed Descriptor and
registration for every agent (above), and its conformance verdict. The report
gives one line per artifact: present, signed and bound to the package
digest; or missing, unsigned, or stale (bound to another digest). A
hand-made package has no build record bound to its digest, which is why it
fails the audit and so both gates.

```yaml
id: stage-record-requirements
says: The statement for this version (what the person asked the agent to do, in their words) is present, signed by whoever made it, and bound to the package digest.
why: Every later stage answers the requirements; without them nothing says what the agent was built to do.
kind: stage-record
check: stage-record:requirements
fixed-by: requirements
level: info
applies: new agents from 2026-10-28; existing agents from not set
evidence: the requirements' digest, their signer, and the package digest they name
```

```yaml
id: stage-record-architecture
says: The architecture record for this version is present, signed by whoever made it, and bound to the package digest.
why: The record decides the systems, the bindings and the standing assets; without it nothing says those were decided rather than guessed.
kind: stage-record
check: stage-record:architecture
fixed-by: architecture
level: info
applies: new agents from 2026-10-28; existing agents from not set
evidence: the record's digest, its signer, and the package digest it names
```

```yaml
id: stage-record-design
says: The design (the agent's own files as they were delivered) for this version is present, signed by whoever made it, and bound to the package digest.
why: A design bound to the digest is evidence of what the package was built to be, and of the record it was written within.
kind: stage-record
check: stage-record:design
fixed-by: design
level: info
applies: new agents from 2026-10-28; existing agents from not set
evidence: the delivery's digest, its signer, and the package digest it names
```

```yaml
id: stage-record-test
says: The test suite for this version is present, signed by whoever made it, and bound to the package digest.
why: A suite bound to the digest, with its last result, is evidence the package was tested.
kind: stage-record
check: stage-record:test
fixed-by: test
level: info
applies: new agents from 2026-10-28; existing agents from not set
evidence: the suite's digest, its signer, the package digest it names, and its last result
```

```yaml
id: stage-record-code
says: Every script in the package is listed, with exactly its bytes, in a signed delivery manifest.
why: A script that no signed delivery lists has no record of where it came from.
kind: stage-record
check: stage-record:code
fixed-by: code
level: info
applies: new agents from 2026-10-28; existing agents from not set
evidence: each script with the manifest that traces it, or that none does
```

The trace is the package maker's `provenance.mjs`: a script is traced when a
signed delivery manifest lists a piece with exactly its bytes. Any signer
counts; an operator who wants one particular code writer's scripts only sets
that in its own builder (`REQUIRED_CODER`), not in this checklist.

```yaml
id: stage-record-review
says: The review findings for this version are present, signed by whoever made them, and bound to the package digest.
why: Findings bound to the digest are evidence that somebody other than the author read the code.
kind: stage-record
check: stage-record:review
fixed-by: code
level: info
applies: new agents from 2026-10-28; existing agents from not set
evidence: the review's digest, its signer, the package digest it names, and its open findings
```

```yaml
id: stage-record-security
says: The security statement for this version is present, signed by whoever made it, and bound to the package digest.
why: A security statement bound to the digest is evidence of what the agent may reach, hold and spend, and why; an outcome check may cite it.
kind: stage-record
check: stage-record:security
fixed-by: code
level: info
applies: new agents from 2026-10-28; existing agents from not set
evidence: the review's digest, its signer, the package digest it names, and its open findings
```

```yaml
id: stage-record-package
says: The build record for this version is present, signed by whoever built the package, and names this package digest.
why: The build record is what binds every other record to the bytes being deployed.
kind: stage-record
check: stage-record:build-record
fixed-by: package
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: the build record's signer, its package digest, and its format_rules and standing_rules
```

```yaml
id: stage-record-deploy
says: A deployment record on dev for this package digest is present and signed by whoever deployed it.
why: A version goes to prod only after it ran on dev.
kind: stage-record
check: stage-record:deployment-record
fixed-by: deploy
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: the dev deployment record's signer, its package digest and when it was made
```

```yaml
id: stage-record-conformance
says: For an agent the platform runs, a conformance verdict for this version is present, signed by whoever checked it, and names this package digest or the image its deployment record started.
why: The verdict is the proof that the deployed agent answers as its Descriptor says; without it the platform runs an agent nobody has checked against its own declaration.
kind: stage-record
check: stage-record:conformance
fixed-by: deploy
level: refuse
applies: new agents from 2026-10-28; existing agents from not set
evidence: the verdict, its signer, and the package digest or image it names
```

The conformance checker writes the verdict after a deploy, and the registry
keeps the newest one for the agent (`agent-eval-record-v1`). A verdict for an
earlier package or image is stale.

```yaml
id: stage-record-docs
says: The agent's documentation for this version is present and names this version.
why: A person deciding whether to use the agent reads its documentation; documentation for another version misleads them.
kind: stage-record
check: stage-record:docs
fixed-by: docs
level: warn
applies: new agents from 2026-10-28; existing agents from not set
evidence: where the documentation is and the version it names
```
