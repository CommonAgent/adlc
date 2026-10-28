---
name: file-what-is-owed
description: after every dependent is answered, to file a dependency debt for each one that is not compatible
---

# File what is owed

Part of impact-analyst. after every dependent is answered, to file a dependency debt for each one that is not compatible

## When to use this

Once every dependent is answered, before the reply is written.

## What this needs

- each dependent, answered
- the ledger, bound by the host as the-ledger: `LEDGER_TOKEN` and `MESH_API_BASE`

## What a good result looks like

One dependency debt for each dependent answered breaking or change of behavior: against the changed agent, owed to the dependent's owner, caused by the change (both versions and the digest of the changed declaration), holding back promote and decommission. Items already in the ledger for the same change, owner and dependent are reported by number and not filed again. What happened to each is in filed.json and the reply.

## What it produces

- filed.json in the job's records: each item and its number, or why it was not filed

## When it comes back empty

With nothing owed, nothing is filed. Without the ledger's key or the platform's origin, or when the ledger will not list what is already there, nothing is filed, the report still lists what is owed, and the reply says why.

## How to do it

`owedItems` and `fileOwed` in scripts/ledger.mjs: GET /v1/operator/debt for what is already against the agent, then POST /v1/operator/debt/items for each one not there.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/ledger.mjs
- scripts/compare.mjs
- scripts/answer.mjs
- scripts/kinds.mjs
