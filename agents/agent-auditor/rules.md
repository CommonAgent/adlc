These are the standing rules for an audit. The scripts do the reading, the checking, the filing and the report; there is no judgment left over for a model, and none is called. Where a message and these rules disagree, these rules govern and the reply says so.

## What this does

It audits one built agent version: the agent named by its handle, and the version named by its version or its package digest. It holds the audit role for the Prove phase of the [Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html). It hands back one signed audit report for that version, and the gates read it: the Deployment Manager refuses a prod deploy, and the Catalog refuses a listing, without a current pass for that exact package digest.

It changes nothing it audits. It does not approve, deploy or list the agent. Asked to, the reply says no, every time, and the audit is delivered as it stands.

## The checklist

The checklist is a standing asset: `standards/audit-checklist.md`, at the digest this package pins (`standards-pins.json`), unless the job attaches another. Every check in it is run. The report cites the checklist's schema and digest in its header. A checklist no person has approved (`approved_by` empty) is still run as written, and the report says so under Not checked.

## Stage records

For each lifecycle stage the report gives one line: present, signed by the stage's holder, and bound to the package digest; or missing, unsigned, or stale (bound to another digest). Who holds each stage is `references/stage-holders.json`, resolved to keys on the platform. Where each record is found, and what binds it, is `references/how-each-stage-and-check-is-read.md`. A record is never called present on someone's word: an unsigned note in a records folder is not a stage's record.

## Rule checks

Each checklist entry is run through the test registered for its `check`. Where a test already holds the rule, that test runs: the package maker's own build.py, the platform's rule against model names in code, the test writer's delivered-formats check, the registry's signed Descriptor. A `check` with no registered test, or one that could not run, is reported under Not checked with the reason. A check is never skipped and never passed for want of evidence.

## Levels and the verdict

A finding has the check's level for a new agent, one first released on or after the check's first `applies` date. For an existing agent, a finding is a warning until the second date, which the owner sets; until then it reads "not set". An agent with no release on record is read as existing.

- `fail`: a finding at level refuse.
- `pass_with_findings`: no refusal, and a warning or something not checked.
- `pass`: every check passed and nothing went unchecked.

A report expires thirty days after the audit.

## Findings and the ledger

Each finding names its place, the rule, the consequence and the stage that fixes it, and is filed in the platform's ledger as a debt against the agent, owed to its owner. A refusing finding holds back promote, the act the prod gate refuses. A warning is an agent debt that blocks nothing. A finding already filed for the same package is reported by its number and not filed again.

The ledger is reached only through the host's binding, `the-ledger`. Without it the report still lists every finding, and the reply says nothing was filed and why.

## Signing and filing

The report is signed with the auditor's own key (`the-signing-key`), over the whole report but its `signature:` line, and filed on the platform by its package digest (`the-platform`). An unsigned report, or one for an agent with no package on record, is delivered with the job and not filed, and the reply says why.

## What was missing

A job that went ahead without something it takes says so in the reply. The record is `records/<job>/went-without.json`.

## Never

Never approve, deploy or list. Never change what is audited. Never skip a check. Never call a record present that is not signed by its holder and bound to the digest. Never file the same debt twice. Never read anything a message names but the agent and its version. Never call a model.
