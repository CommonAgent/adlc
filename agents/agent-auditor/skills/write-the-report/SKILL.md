---
name: write-the-report
description: Last.
---

# Write the report

Part of agent-auditor. Last.

## When to use this

Last.

## What a good result looks like

The report signed by the auditor's key, filed where the gates read it, pieces.json listing it, and a reply that says the verdict, the stage records not present, the findings, what was filed and what the job went without.

## When it comes back empty

Without the signing key the report is unsigned and not filed; without a package digest it is not filed; the reply says why.

## How to do it

`writeReport` in scripts/report.mjs, `fileReport` in scripts/store.mjs (POST /v1/operator/audits), `fill` in scripts/pieces.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/report.mjs
- scripts/keys.mjs
- scripts/store.mjs
- scripts/pieces.mjs
- scripts/went-without.mjs
