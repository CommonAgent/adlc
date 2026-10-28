---
name: audit-an-agent
description: When a built agent version is to go to prod or into the catalog, or when a sweep audits every agent: the gates need a current, signed audit of that exact package digest. This is the Audit role of the Prove phase of the Agent Development Lifecycle.
---

# Audit an agent version

Part of agent-auditor. When a built agent version is to go to prod or into the catalog, or when a sweep audits every agent: the gates need a current, signed audit of that exact package digest. This is the Audit role of the Prove phase of the Agent Development Lifecycle.

## When to use this

When a built agent version is to go to prod or into the catalog, or when a sweep audits every agent: the gates need a current, signed audit of that exact package digest. This is the Audit role of the Prove phase of the Agent Development Lifecycle.

## What this needs

- agent (text, required)
- version (text, optional)
- checklist (text/markdown, optional)
- stage records (application/vnd.agentmesh.job-manifest+json, optional)
- signed records (application/vnd.agentmesh.signed-record+json, optional)
- package (application/gzip, optional)
- run records (application/vnd.agentmesh.run-record+json, optional)

## What a good result looks like

One signed audit report with the YAML header the gates read, then one line per lifecycle stage, every checklist entry with pass, fail or not checked and its evidence, each finding with its place, rule, consequence, level and the stage that fixes it and its debt number, and everything not checked with the reason. Each finding is filed in the ledger once. The report is filed where the gates read it by package digest.

## What it produces

- audit report (text/markdown, per task)

## When it comes back empty

Without an agent named it writes no report and replies with how to ask (exit 3). An agent with no package on record is still audited: its report says so, fails the stage records, and is delivered with the job but not filed, because the platform keeps reports by package digest. Asked to approve, it says it does not.

## How to do it

Run `node scripts/audit.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <message file> [--file <path>::<media type>]...`. It runs the five steps in order and prints one JSON object with a `reply` field. It reads the platform at MESH_API_BASE (and PROD_API_BASE), the deploy queue with AUDIT_TOKEN, files debts with LEDGER_TOKEN, signs with AUDIT_SIGNING_SEED. It calls no model. Read rules.md and references/how-each-stage-and-check-is-read.md.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/audit.mjs
- scripts/read-request.mjs
- scripts/checklist.mjs
- scripts/gather.mjs
- scripts/platform.mjs
- scripts/tar.mjs
- scripts/keys.mjs
- scripts/stages.mjs
- scripts/checks.mjs
- scripts/models.mjs
- scripts/formats.mjs
- scripts/package-maker.mjs
- scripts/ledger.mjs
- scripts/report.mjs
- scripts/store.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs

## References

- references/audit-checklist.md
- references/standing-asset-schemas.json
- references/stage-holders.json
- references/how-each-stage-and-check-is-read.md
- references/rules.md
