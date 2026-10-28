# Agent auditor

This agent holds the audit role for the Prove phase of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

Skipping a lifecycle stage should gain nothing. Given an agent's handle and a
version or package digest, the auditor checks the version against the audit
checklist and hands back one signed audit report. The Deployment Manager
refuses a prod deploy, and the Catalog refuses a listing, without a current
pass for that exact package digest.

- **Stage records.** For each lifecycle stage it finds the record and checks
  that it is present, signed by whoever made it and bound to the package
  digest.
- **Rule checks.** It runs every checklist entry through its registered test.
  A check with no registered test is reported as not checked.
- **Findings.** It files each finding as a debt in the platform's ledger, and
  each debt names the stage that fixes it.
- **Info checks.** A check at `level: info` is shown in the report as evidence
  on file. It never counts toward the verdict and is never filed as a debt.

It calls no model, changes nothing it audits and approves nothing.

## What it is given

One offering, `audit-an-agent`. The message names the agent and the version:

```
agent: quiz-maker.platform@agentmesh.ai
version: 0.6.0                      (or package_digest: sha256:<64 hex>)
```

Without a version or a digest, it audits the version the agent serves on dev.
The attached files are known by what they hold:

| Input | Kind | |
|---|---|---|
| checklist | `text/markdown` | optional: a checklist to use instead of the one carried, `standards/audit-checklist.md` at the digest in `standards-pins.json` |
| stage records | `application/vnd.agentmesh.job-manifest+json` | optional: the signed delivery manifests the requirements, architecture, design, impact, test, code, review and security stages left; the platform keeps none of these by package |
| signed records | `application/vnd.agentmesh.signed-record+json` | optional: a build record, deployment record or conformance verdict, when the platform's own copy is not to be read |
| package | `application/gzip` | optional: the package, when it is not to be fetched from its deploy request |
| run records | `application/vnd.agentmesh.run-record+json` | optional: runs that were given a standing asset, citing `{schema, version_digest, layer}` |
| usability reports | `text/markdown` | optional: a usability report (agents/usability-tester), with the signed delivery manifest it came under, for the Usability stage's line |
| App walk records | `application/vnd.agentmesh.app-walk+json` | optional: the App walk's recorded verdict for the agent (`app_walk: v1`), for the `usable-in-app` check |

## What it reads

| Record | Where |
|---|---|
| the agent's key, handle and presence | `GET /a/<handle>` (public) |
| the stored, signed Descriptor | `GET /v1/agents/<key>/descriptor` (public) |
| the AgentDoc | `GET /a/<handle>/agentdoc.json` (public) |
| the conformance verdict | `GET /v1/agents/<key>/eval-record` (public) |
| the signed build and deployment records | `GET /v1/operator/audit/stage-records?agent=<key>&package=<name>`, with the audit key |
| the package | `GET /v1/deploy-requests/<id>/package.tar.gz` (public, by its request's id) |
| the version prod runs | the same public reads at `PROD_API_BASE` |

`references/how-each-stage-and-check-is-read.md` says what binds each record
and what each registered test runs. `references/stage-holders.json` says who
holds each stage.

## What it hands back

`out/audit-report.md` is the report. It is Markdown with a YAML header that the
gates read:

```
audit_report: v1
agent, version, package_digest
checklist, checklist_digest
verdict: pass | pass_with_findings | fail
audited_at, expires_at (thirty days on)
signed_by (the auditor's key), signature
```

The header is followed by four sections: `## Stage records`, `## Rule checks`,
`## Findings` and `## Not checked`.

The signature is Ed25519 by `signed_by`, over `agent-audit-report-v1`, a
newline, and the report without its `signature:` line. The auditor files the
report with `POST /v1/operator/audits`. A gate reads it with
`GET /v1/audits/<package digest>`, which answers `current_pass`. Each finding is
filed with `POST /v1/operator/debt/items`. When the audited package is the
one dev serves now, the auditor's still-owed debts that name a package it
replaced are closed with `POST /v1/operator/debt/<n>/transition`: resolved
where the new package passes the check, dropped as superseded where it does not
(the finding is then owed on the new package, as its own debt). What was filed
and closed, and where the report went, are in `records/<job>/filed.json`.

Every call to the platform that is answered 429, 502 or 503 is waited out and
asked again (`scripts/retry.mjs`): for as long as the platform asks, else 2,
4, 8 seconds and on, at most a minute at a time and eight times in all. A busy
minute is never read as something missing; a read that still fails after that
is said as failed.

The package's draft Descriptor is the file its `plugin.json` points at, else
`agent-descriptor.json`, else `descriptor.json` (a package built before
Common Agent 0.30.0-draft), as the deployment manager reads it.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- `the-platform`:
  - the audit key (`agent-audit-key`, scope `agent-audit`) in `AUDIT_TOKEN`;
  - the platform's origin in `MESH_API_BASE`;
  - prod's origin in `PROD_API_BASE`;
  - optionally `PACKAGE_MAKER`, the path to the package maker's `build.py` on a
    host with python3, so its own format and standing-asset rules run over the
    package.
- `the-ledger`: the ledger's key (`ledger-key`) in `LEDGER_TOKEN`.
- `the-signing-key`: the auditor's nkey seed (`agent-auditor-signing-seed`) in
  `AUDIT_SIGNING_SEED`.

Without the ledger key, the report lists the findings and files none. Without
the signing key, the report is unsigned and is not filed.

## Running it

```sh
node --test test/*.test.mjs                  # 33 tests
python3 ../package-maker/build.py . ./out    # an Agent Package
```

`test/run.test.mjs` runs the job as its runtime requirements start it, against
a platform served from a map. It covers these cases:
- a hand-made agent fails on its missing stage records;
- an agent that came through every stage passes them;
- each finding is filed once;
- an unregistered check is reported as not checked;
- the report verifies, and does not once edited.

`test/parts.test.mjs` holds the pinned standards to `standards/`, and the
copies of the rules it reuses to their sources:
- the test writer's delivered-formats check;
- AgentMesh's rule against model names, compared when `AGENTMESH_REPO` points
  at a checkout.

`records/` holds the build notes of each version.

## Replacing it

This is a reference implementation. Any agent that holds the audit role can
take its place.
