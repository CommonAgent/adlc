# agent-auditor 0.1.0: the reference agent for the Audit role

Date: 2026-10-28.

## Why

This is the lifecycle plan's item 4b. No agent reaches prod or the catalog
without a current audit pass, so skipping a lifecycle stage gains nothing.
The auditor makes the pass: one signed report per agent version, read by the
Deployment Manager and the Catalog through AgentMesh's
`GET /v1/audits/<package digest>` (AgentMesh PR #698).

## What it is

- It checks the stage records: present, signed by the stage's holder and
  bound to the package digest.
- It runs every check in `standards/audit-checklist.md`, pinned at
  sha256:58246dcb…5781, through a registered test. All 24 checks are
  registered.
- It files each finding as a debt in the ledger.
- It hands back the report TERMS.md describes, signed by the auditor's key and
  filed where the gates read it.

## Decisions made where TERMS.md was silent

- **The kind of debt.** The ledger has two kinds, and technical debt is the
  platform team's own list. So every finding is a `dependency` item against
  the agent, owed to its owner.
  - A finding at level refuse holds back `promote`.
  - A warning, the "agent debt", blocks nothing.
- **Signing.** The report's `signature` header line is Ed25519 by `signed_by`,
  over `agent-audit-report-v1`, a newline, and the report without that line.
  PLAN item 3 lists the signature in the header.
- **Expiry.** A report expires thirty days after the audit.
- **Not checked.** Anything not checked keeps the verdict at
  `pass_with_findings` at best. So does a checklist that no person has
  approved.
- **First release.** An agent's first release is the earliest of its deploy
  queue and its listing on dev and prod. An agent with none on record is read
  as existing.
- **Agents with no package.** An agent with no package on record (Help) is
  audited and fails. Its report is delivered with the job and not filed,
  because the store keys reports by package digest.

## Proof on dev

On 2026-10-28, against dev:

| Agent | Verdict | Why |
|---|---|---|
| Quiz maker 0.6.0 | pass_with_findings | an existing agent, so its findings are warnings |
| Brand reader 0.3.3 | pass_with_findings | the same |
| Help | pass_with_findings | not filed: it has no package on record |
| Solution architect 0.1.4 | fail | first released 2026-10-28, a new agent, with no pre-package stage records |

Every hand-made agent fails its stage records for Requirements,
Architecture, Design, Test, Code, Review and Security review. The reports, the
debts (#492 to #550) and the gate reads are in the lifecycle plan's item 4b
folder.

## Tests

25 tests, in `test/run.test.mjs` and `test/parts.test.mjs`. The package
builds with the package maker on main, with no format or standing-asset
findings.

## Who held each step

The harness wrote the spec, the tests and the scripts for this first version,
at the lifecycle plan's instruction. No Builder held a stage. By its own
checklist this version therefore has no stage records before the package, and
its first audit will say so.
