---
name: file-the-findings
description: Once every check is answered, before the report is written.
---

# File the findings

Part of agent-auditor. Once every check is answered, before the report is written.

## When to use this

Once every check is answered, before the report is written.

## What a good result looks like

One debt per finding, against the agent and owed to its owner, holding back promote when it refuses; any already filed for the same package reported by its number. When the audited package is the one dev serves now, the debts this auditor filed against a package it replaced are closed: resolved where the new package passes the check, dropped as superseded where the finding is owed again on the new package.

## When it comes back empty

With no finding, nothing is filed. Without the ledger's key or the platform's origin, nothing is filed and the report lists every finding.

## How to do it

`owedItems` and `fileOwed` in scripts/ledger.mjs: GET /v1/operator/debt for what is already against the agent, then POST /v1/operator/debt/items for each one not there. `closeReplaced` then lists them again and moves each still-owed item naming another package with POST /v1/operator/debt/<n>/transition. A 429 is waited out and asked again.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/ledger.mjs
